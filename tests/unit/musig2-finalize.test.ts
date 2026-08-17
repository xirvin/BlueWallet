import assert from 'assert';
import * as secp from '@noble/secp256k1';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';

import { createMuSig2KeyPathSigningContext, finalizeMuSig2Psbt } from '../../blue_modules/musig2/finalize';
import { concatBytes, getPlainPublicKey, keyAgg } from '../../blue_modules/musig2/key-aggregation';
import {
  addMuSig2ParticipantsToInput,
  addMuSig2PartialSignatureToInput,
  addMuSig2PublicNonceToInput,
} from '../../blue_modules/musig2/psbt';
import { nonceGen, partialSign } from '../../blue_modules/musig2/session';
import ecc from '../../blue_modules/noble_ecc';

const bip32 = BIP32Factory(ecc);
const BIP328_CHAIN_CODE = Uint8Array.from([
  0x86, 0x80, 0x87, 0xca, 0x02, 0xa6, 0xf9, 0x74,
  0xc4, 0x59, 0x89, 0x24, 0xc3, 0x6b, 0x57, 0x76,
  0x2d, 0x32, 0xcb, 0x45, 0x71, 0x71, 0x67, 0xe3,
  0x00, 0x62, 0x2c, 0x71, 0x67, 0xe3, 0x89, 0x65,
]);

const SECRET_KEYS = [1n, 2n].map(value => secp.etc.numberToBytesBE(value));
const PARTICIPANT_KEYS = SECRET_KEYS.map(secretKey => secp.getPublicKey(secretKey, true));
const ROOT_AGGREGATE_KEY = getPlainPublicKey(keyAgg(PARTICIPANT_KEYS));

function makeSigningPsbt() {
  const aggregateNode = bip32.fromPublicKey(ROOT_AGGREGATE_KEY, BIP328_CHAIN_CODE);
  const internalKey = aggregateNode.derive(0).derive(0).publicKey.slice(1);
  const tapTweak = bitcoin.crypto.taggedHash('TapTweak', internalKey);
  const tweaked = ecc.xOnlyPointAddTweak(internalKey, tapTweak);
  assert.ok(tweaked);

  const signingAggregateKey = new Uint8Array(33);
  signingAggregateKey[0] = tweaked.parity === 1 ? 0x03 : 0x02;
  signingAggregateKey.set(tweaked.xOnlyPubkey, 1);

  const witnessScript = concatBytes(Uint8Array.of(0x51, 0x20), tweaked.xOnlyPubkey);
  const rootFingerprint = bitcoin.crypto.hash160(ROOT_AGGREGATE_KEY).slice(0, 4);
  const psbt = new Psbt();
  psbt.addInput({
    hash: '11'.repeat(32),
    index: 0,
    witnessUtxo: { script: witnessScript, value: 100_000n },
    tapInternalKey: internalKey,
    tapBip32Derivation: [
      {
        pubkey: internalKey,
        masterFingerprint: rootFingerprint,
        path: 'm/0/0',
        leafHashes: [],
      },
    ],
  });
  psbt.addOutput({ script: Uint8Array.of(0x6a), value: 99_800n });
  addMuSig2ParticipantsToInput(psbt, 0, ROOT_AGGREGATE_KEY, PARTICIPANT_KEYS);

  const nonce1 = nonceGen({
    random32: new Uint8Array(32).fill(1),
    secretKey: SECRET_KEYS[0],
    publicKey: PARTICIPANT_KEYS[0],
    aggregatePublicKey: tweaked.xOnlyPubkey,
  });
  const nonce2 = nonceGen({
    random32: new Uint8Array(32).fill(2),
    secretKey: SECRET_KEYS[1],
    publicKey: PARTICIPANT_KEYS[1],
    aggregatePublicKey: tweaked.xOnlyPubkey,
  });

  addMuSig2PublicNonceToInput(psbt, 0, PARTICIPANT_KEYS[0], signingAggregateKey, nonce1.publicNonce);
  addMuSig2PublicNonceToInput(psbt, 0, PARTICIPANT_KEYS[1], signingAggregateKey, nonce2.publicNonce);

  const signingContext = createMuSig2KeyPathSigningContext(psbt, 0);
  const partial1 = partialSign(nonce1.secretNonce, SECRET_KEYS[0], signingContext.session);
  const partial2 = partialSign(nonce2.secretNonce, SECRET_KEYS[1], signingContext.session);

  return { psbt, signingAggregateKey, partial1, partial2 };
}

describe('MuSig2 final signature aggregation and Taproot finalization', () => {
  it('verifies both partial signatures, aggregates BIP340 signature and extracts the transaction', () => {
    const { psbt, signingAggregateKey, partial1, partial2 } = makeSigningPsbt();
    addMuSig2PartialSignatureToInput(psbt, 0, PARTICIPANT_KEYS[0], signingAggregateKey, partial1);
    addMuSig2PartialSignatureToInput(psbt, 0, PARTICIPANT_KEYS[1], signingAggregateKey, partial2);

    const result = finalizeMuSig2Psbt(psbt);
    assert.strictEqual(result.verifiedPartialSignatures, 2);
    assert.strictEqual(result.finalSignatures.length, 1);
    assert.strictEqual(result.finalSignatures[0].length, 64);
    assert.ok(result.psbt.data.inputs[0].finalScriptWitness);
    assert.strictEqual(result.txid.length, 64);

    const transaction = bitcoin.Transaction.fromHex(result.rawTransactionHex);
    assert.strictEqual(transaction.ins[0].witness.length, 1);
    assert.deepStrictEqual(transaction.ins[0].witness[0], result.finalSignatures[0]);
  });

  it('rejects a structurally valid but cryptographically invalid partial signature', () => {
    const { psbt, signingAggregateKey, partial1, partial2 } = makeSigningPsbt();
    const corrupted = new Uint8Array(partial1);
    corrupted[31] ^= 1;

    addMuSig2PartialSignatureToInput(psbt, 0, PARTICIPANT_KEYS[0], signingAggregateKey, corrupted);
    addMuSig2PartialSignatureToInput(psbt, 0, PARTICIPANT_KEYS[1], signingAggregateKey, partial2);

    assert.throws(() => finalizeMuSig2Psbt(psbt), /failed cryptographic verification/);
  });

  it('rejects a PSBT whose BIP328 aggregate derivation no longer matches the Taproot internal key', () => {
    const { psbt, signingAggregateKey, partial1, partial2 } = makeSigningPsbt();
    psbt.data.inputs[0].tapBip32Derivation![0].path = 'm/0/1';
    addMuSig2PartialSignatureToInput(psbt, 0, PARTICIPANT_KEYS[0], signingAggregateKey, partial1);
    addMuSig2PartialSignatureToInput(psbt, 0, PARTICIPANT_KEYS[1], signingAggregateKey, partial2);

    assert.throws(() => finalizeMuSig2Psbt(psbt), /BIP328-derived MuSig2 internal key does not match/);
  });
});
