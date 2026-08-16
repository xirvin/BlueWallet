import assert from 'assert';
import * as secp from '@noble/secp256k1';
import { Psbt } from 'bitcoinjs-lib';

import { concatBytes, getPlainPublicKey, keyAgg } from '../../blue_modules/musig2/key-aggregation';
import {
  addMuSig2ParticipantsToInput,
  addMuSig2PartialSignatureToInput,
  addMuSig2PublicNonceToInput,
  getMuSig2NonceProgress,
  getMuSig2PublicNonces,
  mergeMuSig2Round1Psbt,
  PSBT_IN_MUSIG2_PUB_NONCE,
} from '../../blue_modules/musig2/psbt';
import { nonceGen } from '../../blue_modules/musig2/session';

const SECRET_KEYS = [1n, 2n, 3n].map(value => secp.etc.numberToBytesBE(value));
const PARTICIPANT_KEYS = SECRET_KEYS.slice(0, 2).map(secretKey => secp.getPublicKey(secretKey, true));
const OUTSIDER_KEY = secp.getPublicKey(SECRET_KEYS[2], true);
const AGGREGATE_KEY = getPlainPublicKey(keyAgg(PARTICIPANT_KEYS));

function makeBasePsbt(outputValue = 0n): Psbt {
  const psbt = new Psbt();
  psbt.addInput({ hash: '11'.repeat(32), index: 0 });
  psbt.addOutput({ script: Uint8Array.of(0x6a), value: outputValue });
  addMuSig2ParticipantsToInput(psbt, 0, AGGREGATE_KEY, PARTICIPANT_KEYS);
  return psbt;
}

function makePublicNonce(signerIndex: 0 | 1 | 2, fill: number): Uint8Array {
  const publicKey = signerIndex === 2 ? OUTSIDER_KEY : PARTICIPANT_KEYS[signerIndex];
  return nonceGen({
    random32: new Uint8Array(32).fill(fill),
    secretKey: SECRET_KEYS[signerIndex],
    publicKey,
  }).publicNonce;
}

describe('MuSig2 BIP373 Round 1 coordinator merge', () => {
  it('collects independent signer responses and produces a Round 2 PSBT only when all nonces are present', () => {
    const base = makeBasePsbt();
    assert.deepStrictEqual(getMuSig2NonceProgress(base), { collected: 0, expected: 2, complete: false });

    const signer1 = base.clone();
    addMuSig2PublicNonceToInput(signer1, 0, PARTICIPANT_KEYS[0], AGGREGATE_KEY, makePublicNonce(0, 1));
    const firstMerge = mergeMuSig2Round1Psbt(base, signer1);

    assert.strictEqual(firstMerge.added, 1);
    assert.strictEqual(firstMerge.collected, 1);
    assert.strictEqual(firstMerge.expected, 2);
    assert.strictEqual(firstMerge.complete, false);

    const signer2 = base.clone();
    addMuSig2PublicNonceToInput(signer2, 0, PARTICIPANT_KEYS[1], AGGREGATE_KEY, makePublicNonce(1, 2));
    const secondMerge = mergeMuSig2Round1Psbt(firstMerge.psbt, signer2);

    assert.strictEqual(secondMerge.added, 1);
    assert.strictEqual(secondMerge.collected, 2);
    assert.strictEqual(secondMerge.expected, 2);
    assert.strictEqual(secondMerge.complete, true);
    assert.strictEqual(getMuSig2PublicNonces(secondMerge.psbt).length, 2);
  });

  it('is idempotent when the same returned signer PSBT is imported twice', () => {
    const base = makeBasePsbt();
    const signer1 = base.clone();
    addMuSig2PublicNonceToInput(signer1, 0, PARTICIPANT_KEYS[0], AGGREGATE_KEY, makePublicNonce(0, 3));

    const firstMerge = mergeMuSig2Round1Psbt(base, signer1);
    const repeatedMerge = mergeMuSig2Round1Psbt(firstMerge.psbt, signer1);

    assert.strictEqual(repeatedMerge.added, 0);
    assert.strictEqual(repeatedMerge.collected, 1);
    assert.strictEqual(repeatedMerge.complete, false);
  });

  it('rejects a returned PSBT for a different unsigned transaction', () => {
    const base = makeBasePsbt();
    const changed = makeBasePsbt(1n);
    addMuSig2PublicNonceToInput(changed, 0, PARTICIPANT_KEYS[0], AGGREGATE_KEY, makePublicNonce(0, 4));

    assert.throws(() => mergeMuSig2Round1Psbt(base, changed), /different unsigned transaction/);
  });

  it('rejects a nonce that claims an unexpected participant', () => {
    const base = makeBasePsbt();
    const returned = base.clone();
    addMuSig2PublicNonceToInput(returned, 0, OUTSIDER_KEY, AGGREGATE_KEY, makePublicNonce(2, 5));

    assert.throws(() => mergeMuSig2Round1Psbt(base, returned), /not from an expected participant/);
  });

  it('rejects malformed public nonce points', () => {
    const base = makeBasePsbt();
    const returned = base.clone();
    returned.addUnknownKeyValToInput(0, {
      key: concatBytes(Uint8Array.of(PSBT_IN_MUSIG2_PUB_NONCE), PARTICIPANT_KEYS[0], AGGREGATE_KEY),
      value: new Uint8Array(66),
    });

    assert.throws(() => mergeMuSig2Round1Psbt(base, returned), /two valid compressed secp256k1 points/);
  });

  it('rejects replacing a previously accepted signer nonce', () => {
    const base = makeBasePsbt();
    const firstResponse = base.clone();
    addMuSig2PublicNonceToInput(firstResponse, 0, PARTICIPANT_KEYS[0], AGGREGATE_KEY, makePublicNonce(0, 6));
    const firstMerge = mergeMuSig2Round1Psbt(base, firstResponse);

    const conflictingResponse = base.clone();
    addMuSig2PublicNonceToInput(conflictingResponse, 0, PARTICIPANT_KEYS[0], AGGREGATE_KEY, makePublicNonce(0, 7));

    assert.throws(() => mergeMuSig2Round1Psbt(firstMerge.psbt, conflictingResponse), /Conflicting MuSig2 public nonce/);
  });

  it('rejects a Round 1 response that already contains a partial signature', () => {
    const base = makeBasePsbt();
    const returned = base.clone();
    addMuSig2PartialSignatureToInput(returned, 0, PARTICIPANT_KEYS[0], AGGREGATE_KEY, new Uint8Array(32).fill(1));

    assert.throws(() => mergeMuSig2Round1Psbt(base, returned), /Round 1 response unexpectedly contains/);
  });
});
