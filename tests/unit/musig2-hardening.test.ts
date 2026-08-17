import assert from 'assert';
import * as secp from '@noble/secp256k1';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { finalizeMuSig2Psbt } from '../../blue_modules/musig2/finalize';
import { concatBytes, getPlainPublicKey, keyAgg } from '../../blue_modules/musig2/key-aggregation';
import {
  addMuSig2ParticipantsToInput,
  addMuSig2PartialSignatureToInput,
  addMuSig2PublicNonceToInput,
  mergeMuSig2Round1Psbt,
  PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS,
  PSBT_IN_MUSIG2_PUB_NONCE,
} from '../../blue_modules/musig2/psbt';
import { getMuSig2Round2SignerPsbt, mergeMuSig2Round2Psbt } from '../../blue_modules/musig2/round2';
import { createMuSig2KeyPathSigningContext } from '../../blue_modules/musig2/signing-context';
import { nonceGen, partialSign } from '../../blue_modules/musig2/session';

const bip32 = BIP32Factory(ecc);
const BIP328_CHAIN_CODE = Uint8Array.from([
  0x86, 0x80, 0x87, 0xca, 0x02, 0xa6, 0xf9, 0x74,
  0xc4, 0x59, 0x89, 0x24, 0xc3, 0x6b, 0x57, 0x76,
  0x2d, 0x32, 0xcb, 0x45, 0x71, 0x71, 0x67, 0xe3,
  0x00, 0x62, 0x2c, 0x71, 0x67, 0xe3, 0x89, 0x65,
]);

const SECRET_KEYS = [11n, 29n, 47n].map(value => secp.etc.numberToBytesBE(value));
const PARTICIPANT_KEYS = SECRET_KEYS.slice(0, 2).map(secretKey => secp.getPublicKey(secretKey, true));
const OUTSIDER_KEY = secp.getPublicKey(SECRET_KEYS[2], true);
const ROOT_AGGREGATE_KEY = getPlainPublicKey(keyAgg(PARTICIPANT_KEYS));

type PreparedSession = {
  round2Psbt: Psbt;
  signingAggregateKey: Uint8Array;
  partials: Uint8Array[];
};

function createRound1Base(iteration: number, outputValue = 90_000n, inputValue = 100_000n) {
  const aggregateNode = bip32.fromPublicKey(ROOT_AGGREGATE_KEY, BIP328_CHAIN_CODE);
  const internalKey = aggregateNode.derive(0).derive(iteration % 8).publicKey.slice(1);
  const tapTweak = bitcoin.crypto.taggedHash('TapTweak', internalKey);
  const tweaked = ecc.xOnlyPointAddTweak(internalKey, tapTweak);
  assert.ok(tweaked);

  const signingAggregateKey = new Uint8Array(33);
  signingAggregateKey[0] = tweaked.parity === 1 ? 0x03 : 0x02;
  signingAggregateKey.set(tweaked.xOnlyPubkey, 1);

  const psbt = new Psbt();
  const txidByte = ((iteration % 250) + 1).toString(16).padStart(2, '0');
  psbt.addInput({
    hash: txidByte.repeat(32),
    index: 0,
    witnessUtxo: {
      script: concatBytes(Uint8Array.of(0x51, 0x20), tweaked.xOnlyPubkey),
      value: inputValue,
    },
    tapInternalKey: internalKey,
    tapBip32Derivation: [
      {
        pubkey: internalKey,
        masterFingerprint: bitcoin.crypto.hash160(ROOT_AGGREGATE_KEY).slice(0, 4),
        path: `m/0/${iteration % 8}`,
        leafHashes: [],
      },
    ],
  });
  psbt.addOutput({ script: Uint8Array.of(0x6a), value: outputValue });
  addMuSig2ParticipantsToInput(psbt, 0, ROOT_AGGREGATE_KEY, PARTICIPANT_KEYS);
  return { psbt, signingAggregateKey, xOnlySigningKey: tweaked.xOnlyPubkey };
}

function prepareSession(iteration = 0, outputValue = 90_000n, inputValue = 100_000n): PreparedSession {
  const { psbt: base, signingAggregateKey, xOnlySigningKey } = createRound1Base(iteration, outputValue, inputValue);
  const noncePairs = PARTICIPANT_KEYS.map((publicKey, signerIndex) =>
    nonceGen({
      random32: new Uint8Array(32).fill(iteration * 2 + signerIndex + 1),
      secretKey: SECRET_KEYS[signerIndex],
      publicKey,
      aggregatePublicKey: xOnlySigningKey,
    }),
  );

  const response1 = base.clone();
  addMuSig2PublicNonceToInput(response1, 0, PARTICIPANT_KEYS[0], signingAggregateKey, noncePairs[0].publicNonce);
  const first = mergeMuSig2Round1Psbt(base, response1);

  const response2 = base.clone();
  addMuSig2PublicNonceToInput(response2, 0, PARTICIPANT_KEYS[1], signingAggregateKey, noncePairs[1].publicNonce);
  const second = mergeMuSig2Round1Psbt(first.psbt, response2);
  assert.strictEqual(second.complete, true);

  const context = createMuSig2KeyPathSigningContext(second.psbt, 0);
  const partials = noncePairs.map((nonce, signerIndex) => partialSign(nonce.secretNonce, SECRET_KEYS[signerIndex], context.session));
  return { round2Psbt: second.psbt, signingAggregateKey, partials };
}

function addSignerPartial(psbt: Psbt, fixture: PreparedSession, signerIndex: 0 | 1, partial = fixture.partials[signerIndex]) {
  addMuSig2PartialSignatureToInput(
    psbt,
    0,
    PARTICIPANT_KEYS[signerIndex],
    fixture.signingAggregateKey,
    partial,
  );
  return psbt;
}

function completeRound2(fixture: PreparedSession): Psbt {
  const response1 = addSignerPartial(getMuSig2Round2SignerPsbt(fixture.round2Psbt), fixture, 0);
  const first = mergeMuSig2Round2Psbt(fixture.round2Psbt, response1);
  const response2 = addSignerPartial(getMuSig2Round2SignerPsbt(first.psbt), fixture, 1);
  const second = mergeMuSig2Round2Psbt(first.psbt, response2);
  assert.strictEqual(second.complete, true);
  return second.psbt;
}

describe('MuSig2 signing-session hardening', () => {
  it('repeats the complete disposable Round 1 -> Round 2 -> Taproot finalization flow', () => {
    for (let iteration = 0; iteration < 16; iteration++) {
      const fixture = prepareSession(iteration, 90_000n - BigInt(iteration));
      const signed = completeRound2(fixture);
      const result = finalizeMuSig2Psbt(signed);
      const transaction = bitcoin.Transaction.fromHex(result.rawTransactionHex);

      assert.strictEqual(result.verifiedPartialSignatures, 2);
      assert.strictEqual(result.finalSignatures.length, 1);
      assert.strictEqual(transaction.ins[0].witness.length, 1);
      assert.deepStrictEqual(transaction.ins[0].witness[0], result.finalSignatures[0]);
    }
  });

  it('rejects a witness-UTXO amount mutation after partial signatures were produced', () => {
    const fixture = prepareSession(1);
    const mutatedBase = fixture.round2Psbt.clone();
    mutatedBase.data.inputs[0].witnessUtxo!.value += 1n;
    const response = addSignerPartial(getMuSig2Round2SignerPsbt(mutatedBase), fixture, 0);

    assert.throws(() => mergeMuSig2Round2Psbt(mutatedBase, response), /failed cryptographic verification/);
  });

  it('rejects an unsigned transaction output mutation', () => {
    const original = prepareSession(2, 90_000n);
    const changed = prepareSession(2, 89_999n);
    const response = addSignerPartial(getMuSig2Round2SignerPsbt(original.round2Psbt), original, 0);

    assert.throws(() => mergeMuSig2Round2Psbt(changed.round2Psbt, response), /different unsigned transaction/);
  });

  it('rejects a valid-point public nonce mutation against an existing partial signature', () => {
    const fixture = prepareSession(3);
    const mutated = fixture.round2Psbt.clone();
    const nonceField = mutated.data.inputs[0].unknownKeyVals!.find(item => item.key[0] === PSBT_IN_MUSIG2_PUB_NONCE);
    assert.ok(nonceField);
    nonceField!.value = nonceGen({
      random32: new Uint8Array(32).fill(99),
      secretKey: SECRET_KEYS[0],
      publicKey: PARTICIPANT_KEYS[0],
      aggregatePublicKey: fixture.signingAggregateKey.slice(1),
    }).publicNonce;
    const response = addSignerPartial(getMuSig2Round2SignerPsbt(mutated), fixture, 0);

    assert.throws(() => mergeMuSig2Round2Psbt(mutated, response), /failed cryptographic verification/);
  });

  it('rejects participant-set mutation', () => {
    const fixture = prepareSession(4);
    const mutated = fixture.round2Psbt.clone();
    const participantField = mutated.data.inputs[0].unknownKeyVals!.find(item => item.key[0] === PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS);
    assert.ok(participantField);
    participantField!.value = concatBytes(OUTSIDER_KEY, PARTICIPANT_KEYS[1]);

    assert.throws(() => createMuSig2KeyPathSigningContext(mutated, 0), /aggregate public key does not match the participant list/);
  });

  it('rejects partial-signature bit mutation before coordinator acceptance', () => {
    const fixture = prepareSession(5);
    const corrupted = new Uint8Array(fixture.partials[0]);
    corrupted[31] ^= 1;
    const response = addSignerPartial(getMuSig2Round2SignerPsbt(fixture.round2Psbt), fixture, 0, corrupted);

    assert.throws(() => mergeMuSig2Round2Psbt(fixture.round2Psbt, response), /failed cryptographic verification/);
  });

  it('rejects sighash-type mutation after the signer created its partial signature', () => {
    const fixture = prepareSession(6);
    const mutated = fixture.round2Psbt.clone();
    mutated.data.inputs[0].sighashType = bitcoin.Transaction.SIGHASH_ALL;
    const response = addSignerPartial(getMuSig2Round2SignerPsbt(mutated), fixture, 0);

    assert.throws(() => mergeMuSig2Round2Psbt(mutated, response), /failed cryptographic verification/);
  });

  it('rejects Taproot tweak mutation', () => {
    const fixture = prepareSession(7);
    const mutated = fixture.round2Psbt.clone();
    mutated.data.inputs[0].tapMerkleRoot = new Uint8Array(32).fill(7);
    const response = addSignerPartial(getMuSig2Round2SignerPsbt(mutated), fixture, 0);

    assert.throws(
      () => mergeMuSig2Round2Psbt(mutated, response),
      /signing key does not match the Taproot witness UTXO|wrong signing key/,
    );
  });
});
