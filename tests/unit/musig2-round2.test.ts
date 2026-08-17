import assert from 'assert';
import * as secp from '@noble/secp256k1';
import { Psbt } from 'bitcoinjs-lib';

import { getPlainPublicKey, keyAgg } from '../../blue_modules/musig2/key-aggregation';
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
} from '../../blue_modules/musig2/round2';
import { nonceGen } from '../../blue_modules/musig2/session';

const SECRET_KEYS = [1n, 2n, 3n].map(value => secp.etc.numberToBytesBE(value));
const PARTICIPANT_KEYS = SECRET_KEYS.slice(0, 2).map(secretKey => secp.getPublicKey(secretKey, true));
const OUTSIDER_KEY = secp.getPublicKey(SECRET_KEYS[2], true);
const AGGREGATE_KEY = getPlainPublicKey(keyAgg(PARTICIPANT_KEYS));

function makePublicNonce(signerIndex: 0 | 1, fill: number): Uint8Array {
  return nonceGen({
    random32: new Uint8Array(32).fill(fill),
    secretKey: SECRET_KEYS[signerIndex],
    publicKey: PARTICIPANT_KEYS[signerIndex],
  }).publicNonce;
}

function makeRound2Base(outputValue = 0n): Psbt {
  const psbt = new Psbt();
  psbt.addInput({ hash: '11'.repeat(32), index: 0 });
  psbt.addOutput({ script: Uint8Array.of(0x6a), value: outputValue });
  addMuSig2ParticipantsToInput(psbt, 0, AGGREGATE_KEY, PARTICIPANT_KEYS);
  addMuSig2PublicNonceToInput(psbt, 0, PARTICIPANT_KEYS[0], AGGREGATE_KEY, makePublicNonce(0, 1));
  addMuSig2PublicNonceToInput(psbt, 0, PARTICIPANT_KEYS[1], AGGREGATE_KEY, makePublicNonce(1, 2));
  return psbt;
}

function addPartial(psbt: Psbt, signerIndex: 0 | 1, fill: number): Psbt {
  addMuSig2PartialSignatureToInput(
    psbt,
    0,
    PARTICIPANT_KEYS[signerIndex],
    AGGREGATE_KEY,
    new Uint8Array(32).fill(fill),
  );
  return psbt;
}

describe('MuSig2 BIP373 Round 2 coordinator merge', () => {
  it('collects a partial signature from either signer and reaches 2/2', () => {
    const base = makeRound2Base();
    assert.deepStrictEqual(getMuSig2PartialSignatureProgress(base), { collected: 0, expected: 2, complete: false });

    const signer1 = addPartial(base.clone(), 0, 1);
    const first = mergeMuSig2Round2Psbt(base, signer1);
    assert.strictEqual(first.added, 1);
    assert.strictEqual(first.collected, 1);
    assert.strictEqual(first.expected, 2);
    assert.strictEqual(first.complete, false);

    const signer2 = addPartial(getMuSig2Round2SignerPsbt(first.psbt), 1, 2);
    const second = mergeMuSig2Round2Psbt(first.psbt, signer2);
    assert.strictEqual(second.added, 1);
    assert.strictEqual(second.collected, 2);
    assert.strictEqual(second.expected, 2);
    assert.strictEqual(second.complete, true);
    assert.strictEqual(getMuSig2PartialSignatures(second.psbt).length, 2);
  });

  it('keeps the signer-facing Round 2 PSBT free of collected partial signatures', () => {
    const coordinator = addPartial(makeRound2Base(), 0, 3);
    const signerPsbt = getMuSig2Round2SignerPsbt(coordinator);

    assert.strictEqual(getMuSig2PartialSignatures(coordinator).length, 1);
    assert.strictEqual(getMuSig2PartialSignatures(signerPsbt).length, 0);
    assert.strictEqual(signerPsbt.data.inputs[0].unknownKeyVals?.some(item => item.key[0] === PSBT_IN_MUSIG2_PARTIAL_SIG), false);
  });

  it('is idempotent when the same signer response is imported twice', () => {
    const base = makeRound2Base();
    const response = addPartial(base.clone(), 0, 4);
    const first = mergeMuSig2Round2Psbt(base, response);
    const repeated = mergeMuSig2Round2Psbt(first.psbt, response);

    assert.strictEqual(repeated.added, 0);
    assert.strictEqual(repeated.collected, 1);
  });

  it('rejects a partial signature for an unexpected participant', () => {
    const base = makeRound2Base();
    const response = base.clone();
    addMuSig2PartialSignatureToInput(response, 0, OUTSIDER_KEY, AGGREGATE_KEY, new Uint8Array(32).fill(5));

    assert.throws(() => mergeMuSig2Round2Psbt(base, response), /not from an expected participant or signing key/);
  });

  it('rejects replacement of an already accepted partial signature', () => {
    const base = makeRound2Base();
    const first = mergeMuSig2Round2Psbt(base, addPartial(base.clone(), 0, 6));
    const conflicting = addPartial(getMuSig2Round2SignerPsbt(first.psbt), 0, 7);

    assert.throws(() => mergeMuSig2Round2Psbt(first.psbt, conflicting), /Conflicting MuSig2 partial signature/);
  });

  it('rejects a Round 2 response that changes the nonce session', () => {
    const base = makeRound2Base();
    const changed = new Psbt();
    changed.addInput({ hash: '11'.repeat(32), index: 0 });
    changed.addOutput({ script: Uint8Array.of(0x6a), value: 0n });
    addMuSig2ParticipantsToInput(changed, 0, AGGREGATE_KEY, PARTICIPANT_KEYS);
    addMuSig2PublicNonceToInput(changed, 0, PARTICIPANT_KEYS[0], AGGREGATE_KEY, makePublicNonce(0, 9));
    addMuSig2PublicNonceToInput(changed, 0, PARTICIPANT_KEYS[1], AGGREGATE_KEY, makePublicNonce(1, 2));
    addPartial(changed, 0, 8);

    assert.throws(() => mergeMuSig2Round2Psbt(base, changed), /changed the MuSig2 nonce session/);
  });

  it('rejects a returned PSBT for a different unsigned transaction', () => {
    const base = makeRound2Base();
    const changed = makeRound2Base(1n);
    addPartial(changed, 0, 9);

    assert.throws(() => mergeMuSig2Round2Psbt(base, changed), /different unsigned transaction/);
  });

  it('rejects a final Taproot signature in the coordinator partial-signature phase', () => {
    const base = makeRound2Base();
    const response = base.clone();
    response.updateInput(0, { tapKeySig: new Uint8Array(64).fill(1) });

    assert.throws(() => mergeMuSig2Round2Psbt(base, response), /final Taproot signature/);
  });
});
