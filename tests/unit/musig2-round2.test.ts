import assert from 'assert';
import * as secp from '@noble/secp256k1';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { concatBytes, getPlainPublicKey, keyAgg } from '../../blue_modules/musig2/key-aggregation';
import {
  addMuSig2ParticipantsToInput,
  addMuSig2PartialSignatureToInput,
  addMuSig2PublicNonceToInput,
  PSBT_IN_MUSIG2_PARTIAL_SIG,
} from '../../blue_modules/musig2/psbt';
import {
  getMuSig2PartialSignatureProgress,
  getMuSig2PartialSignatures,
  getMuSig2Round2SignerPsbt,
  mergeMuSig2Round2Psbt,
  verifyMuSig2PartialSignatures,
} from '../../blue_modules/musig2/round2';
import { createMuSig2KeyPathSigningContext } from '../../blue_modules/musig2/signing-context';
import { nonceGen, partialSign } from '../../blue_modules/musig2/session';

const bip32 = BIP32Factory(ecc);
const BIP328_CHAIN_CODE = Uint8Array.from([
  0x86, 0x80, 0x87, 0xca, 0x02, 0xa6, 0xf9, 0x74,
  0xc4, 0x59, 0x89, 0x24, 0xc3, 0x6b, 0x57, 0x76,
  0x2d, 0x32, 0xcb, 0x45, 0x71, 0x71, 0x67, 0xe3,
  0x00, 0x62, 0x2c, 0x71, 0x67, 0xe3, 0x89, 0x65,
]);

const SECRET_KEYS = [1n, 2n, 3n].map(value => secp.etc.numberToBytesBE(value));
const PARTICIPANT_KEYS = SECRET_KEYS.slice(0, 2).map(secretKey => secp.getPublicKey(secretKey, true));
const OUTSIDER_KEY = secp.getPublicKey(SECRET_KEYS[2], true);
const ROOT_AGGREGATE_KEY = getPlainPublicKey(keyAgg(PARTICIPANT_KEYS));

type Round2Fixture = {
  psbt: Psbt;
  signingAggregateKey: Uint8Array;
  partials: Uint8Array[];
};

function makeRound2Fixture(outputValue = 99_800n, nonceOffset = 0): Round2Fixture {
  const aggregateNode = bip32.fromPublicKey(ROOT_AGGREGATE_KEY, BIP328_CHAIN_CODE);
  const internalKey = aggregateNode.derive(0).derive(0).publicKey.slice(1);
  const tapTweak = bitcoin.crypto.taggedHash('TapTweak', internalKey);
  const tweaked = ecc.xOnlyPointAddTweak(internalKey, tapTweak);
  assert.ok(tweaked);

  const signingAggregateKey = new Uint8Array(33);
  signingAggregateKey[0] = tweaked.parity === 1 ? 0x03 : 0x02;
  signingAggregateKey.set(tweaked.xOnlyPubkey, 1);

  const psbt = new Psbt();
  psbt.addInput({
    hash: '11'.repeat(32),
    index: 0,
    witnessUtxo: {
      script: concatBytes(Uint8Array.of(0x51, 0x20), tweaked.xOnlyPubkey),
      value: 100_000n,
    },
    tapInternalKey: internalKey,
    tapBip32Derivation: [
      {
        pubkey: internalKey,
        masterFingerprint: bitcoin.crypto.hash160(ROOT_AGGREGATE_KEY).slice(0, 4),
        path: 'm/0/0',
        leafHashes: [],
      },
    ],
  });
  psbt.addOutput({ script: Uint8Array.of(0x6a), value: outputValue });
  addMuSig2ParticipantsToInput(psbt, 0, ROOT_AGGREGATE_KEY, PARTICIPANT_KEYS);

  const nonces = PARTICIPANT_KEYS.map((publicKey, signerIndex) =>
    nonceGen({
      random32: new Uint8Array(32).fill(nonceOffset + signerIndex + 1),
      secretKey: SECRET_KEYS[signerIndex],
      publicKey,
      aggregatePublicKey: tweaked.xOnlyPubkey,
    }),
  );
  nonces.forEach((nonce, signerIndex) =>
    addMuSig2PublicNonceToInput(psbt, 0, PARTICIPANT_KEYS[signerIndex], signingAggregateKey, nonce.publicNonce),
  );

  const context = createMuSig2KeyPathSigningContext(psbt, 0);
  const partials = nonces.map((nonce, signerIndex) => partialSign(nonce.secretNonce, SECRET_KEYS[signerIndex], context.session));
  return { psbt, signingAggregateKey, partials };
}

function signerResponse(fixture: Round2Fixture, signerIndex: 0 | 1, partial = fixture.partials[signerIndex]): Psbt {
  const response = getMuSig2Round2SignerPsbt(fixture.psbt);
  addMuSig2PartialSignatureToInput(
    response,
    0,
    PARTICIPANT_KEYS[signerIndex],
    fixture.signingAggregateKey,
    partial,
  );
  return response;
}

describe('MuSig2 BIP373 Round 2 coordinator merge', () => {
  it('cryptographically verifies and collects a partial signature from either signer until 2/2', () => {
    const fixture = makeRound2Fixture();
    const base = fixture.psbt;
    assert.deepStrictEqual(getMuSig2PartialSignatureProgress(base), { collected: 0, expected: 2, complete: false });

    const first = mergeMuSig2Round2Psbt(base, signerResponse(fixture, 0));
    assert.strictEqual(first.added, 1);
    assert.strictEqual(first.collected, 1);
    assert.strictEqual(first.expected, 2);
    assert.strictEqual(first.complete, false);
    assert.strictEqual(verifyMuSig2PartialSignatures(first.psbt), 1);

    const secondResponse = getMuSig2Round2SignerPsbt(first.psbt);
    addMuSig2PartialSignatureToInput(
      secondResponse,
      0,
      PARTICIPANT_KEYS[1],
      fixture.signingAggregateKey,
      fixture.partials[1],
    );
    const second = mergeMuSig2Round2Psbt(first.psbt, secondResponse);
    assert.strictEqual(second.added, 1);
    assert.strictEqual(second.collected, 2);
    assert.strictEqual(second.expected, 2);
    assert.strictEqual(second.complete, true);
    assert.strictEqual(getMuSig2PartialSignatures(second.psbt).length, 2);
    assert.strictEqual(verifyMuSig2PartialSignatures(second.psbt), 2);
  });

  it('keeps the signer-facing Round 2 PSBT free of collected partial signatures', () => {
    const fixture = makeRound2Fixture();
    const first = mergeMuSig2Round2Psbt(fixture.psbt, signerResponse(fixture, 0));
    const signerPsbt = getMuSig2Round2SignerPsbt(first.psbt);

    assert.strictEqual(getMuSig2PartialSignatures(first.psbt).length, 1);
    assert.strictEqual(getMuSig2PartialSignatures(signerPsbt).length, 0);
    assert.strictEqual(signerPsbt.data.inputs[0].unknownKeyVals?.some(item => item.key[0] === PSBT_IN_MUSIG2_PARTIAL_SIG), false);
  });

  it('is idempotent when the same cryptographically valid signer response is imported twice', () => {
    const fixture = makeRound2Fixture();
    const response = signerResponse(fixture, 0);
    const first = mergeMuSig2Round2Psbt(fixture.psbt, response);
    const repeated = mergeMuSig2Round2Psbt(first.psbt, response);

    assert.strictEqual(repeated.added, 0);
    assert.strictEqual(repeated.collected, 1);
  });

  it('rejects a structurally valid but cryptographically invalid partial signature before merge', () => {
    const fixture = makeRound2Fixture();
    const corrupted = new Uint8Array(fixture.partials[0]);
    corrupted[31] ^= 1;

    assert.throws(() => mergeMuSig2Round2Psbt(fixture.psbt, signerResponse(fixture, 0, corrupted)), /failed cryptographic verification/);
    assert.strictEqual(getMuSig2PartialSignatures(fixture.psbt).length, 0);
  });

  it('rejects a partial signature for an unexpected participant', () => {
    const fixture = makeRound2Fixture();
    const response = getMuSig2Round2SignerPsbt(fixture.psbt);
    addMuSig2PartialSignatureToInput(response, 0, OUTSIDER_KEY, fixture.signingAggregateKey, fixture.partials[0]);

    assert.throws(() => mergeMuSig2Round2Psbt(fixture.psbt, response), /not from an expected participant or signing key/);
  });

  it('rejects replacement of an already accepted partial signature', () => {
    const fixture = makeRound2Fixture();
    const first = mergeMuSig2Round2Psbt(fixture.psbt, signerResponse(fixture, 0));
    const conflicting = new Uint8Array(fixture.partials[0]);
    conflicting[31] ^= 1;
    const response = getMuSig2Round2SignerPsbt(first.psbt);
    addMuSig2PartialSignatureToInput(response, 0, PARTICIPANT_KEYS[0], fixture.signingAggregateKey, conflicting);

    assert.throws(
      () => mergeMuSig2Round2Psbt(first.psbt, response),
      /failed cryptographic verification|Conflicting MuSig2 partial signature/,
    );
  });

  it('rejects a Round 2 response that changes the nonce session', () => {
    const fixture = makeRound2Fixture();
    const changedFixture = makeRound2Fixture(99_800n, 20);
    const changed = signerResponse(changedFixture, 0);

    assert.throws(() => mergeMuSig2Round2Psbt(fixture.psbt, changed), /changed the MuSig2 nonce session/);
  });

  it('rejects a returned PSBT for a different unsigned transaction', () => {
    const fixture = makeRound2Fixture();
    const changedFixture = makeRound2Fixture(99_799n);
    const changed = signerResponse(changedFixture, 0);

    assert.throws(() => mergeMuSig2Round2Psbt(fixture.psbt, changed), /different unsigned transaction/);
  });

  it('rejects a final Taproot signature in the coordinator partial-signature phase', () => {
    const fixture = makeRound2Fixture();
    const response = getMuSig2Round2SignerPsbt(fixture.psbt);
    response.updateInput(0, { tapKeySig: new Uint8Array(64).fill(1) });

    assert.throws(() => mergeMuSig2Round2Psbt(fixture.psbt, response), /final Taproot signature/);
  });
});
