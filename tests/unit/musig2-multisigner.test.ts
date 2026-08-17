import assert from 'assert';
import * as secp from '@noble/secp256k1';
import { Psbt } from 'bitcoinjs-lib';

import { getPlainPublicKey, getXOnlyPublicKey, keyAgg } from '../../blue_modules/musig2/key-aggregation';
import {
  addMuSig2ParticipantsToInput,
  addMuSig2PublicNonceToInput,
  getMuSig2NonceProgress,
  mergeMuSig2Round1Psbt,
} from '../../blue_modules/musig2/psbt';
import { createSession, nonceGen, partialSigAgg, partialSigVerify, partialSign, verifyFinalSignature } from '../../blue_modules/musig2/session';

function makeKeys(count: number) {
  const secretKeys = Array.from({ length: count }, (_, index) => secp.etc.numberToBytesBE(BigInt(index + 11)));
  const publicKeys = secretKeys.map(secretKey => secp.getPublicKey(secretKey, true));
  return { secretKeys, publicKeys };
}

describe('MuSig2 multi-signer coordination', () => {
  for (const count of [3, 7]) {
    it(`tracks all ${count} Round 1 public nonces`, () => {
      const { secretKeys, publicKeys } = makeKeys(count);
      const aggregate = getPlainPublicKey(keyAgg(publicKeys));
      const base = new Psbt();
      base.addInput({ hash: '11'.repeat(32), index: 0 });
      base.addOutput({ script: Uint8Array.of(0x6a), value: 0n });
      addMuSig2ParticipantsToInput(base, 0, aggregate, publicKeys);

      let coordinator = base;
      assert.deepStrictEqual(getMuSig2NonceProgress(coordinator), { collected: 0, expected: count, complete: false });

      for (let signerIndex = 0; signerIndex < count; signerIndex++) {
        const nonce = nonceGen({
          random32: new Uint8Array(32).fill(signerIndex + 1),
          secretKey: secretKeys[signerIndex],
          publicKey: publicKeys[signerIndex],
        });
        const response = base.clone();
        addMuSig2PublicNonceToInput(response, 0, publicKeys[signerIndex], aggregate, nonce.publicNonce);
        const merged = mergeMuSig2Round1Psbt(coordinator, response);
        coordinator = merged.psbt;

        assert.strictEqual(merged.collected, signerIndex + 1);
        assert.strictEqual(merged.expected, count);
        assert.strictEqual(merged.complete, signerIndex === count - 1);
      }
    });

    it(`aggregates and verifies a ${count}-signer BIP327 signature`, () => {
      const { secretKeys, publicKeys } = makeKeys(count);
      const aggregateXOnly = getXOnlyPublicKey(keyAgg(publicKeys));
      const message = new Uint8Array(32).fill(count);
      const nonces = publicKeys.map((publicKey, signerIndex) =>
        nonceGen({
          random32: new Uint8Array(32).fill(40 + signerIndex),
          secretKey: secretKeys[signerIndex],
          publicKey,
          aggregatePublicKey: aggregateXOnly,
          message,
        }),
      );

      const session = createSession(
        nonces.map(nonce => nonce.publicNonce),
        publicKeys,
        message,
      );
      const partials = nonces.map((nonce, signerIndex) => partialSign(nonce.secretNonce, secretKeys[signerIndex], session));

      partials.forEach((partial, signerIndex) => {
        assert.strictEqual(partialSigVerify(partial, nonces[signerIndex].publicNonce, publicKeys[signerIndex], session), true);
      });

      const signature = partialSigAgg(partials, session);
      assert.strictEqual(signature.length, 64);
      assert.strictEqual(verifyFinalSignature(signature, session), true);
      assert.strictEqual(secp.schnorr.verify(signature, message, aggregateXOnly), true);
    });
  }
});
