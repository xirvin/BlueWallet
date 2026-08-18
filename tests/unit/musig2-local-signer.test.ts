import assert from 'assert';

import { createMuSig2DryRun } from '../../blue_modules/musig2/dry-run';
import { finalizeMuSig2Psbt } from '../../blue_modules/musig2/finalize';
import {
  createLocalMuSig2Round1Response,
  createLocalMuSig2Round2Response,
  getLocalMuSig2SignerMatches,
} from '../../blue_modules/musig2/local-signer';
import { getMuSig2NonceProgress, mergeMuSig2Round1Psbt } from '../../blue_modules/musig2/psbt';
import { getMuSig2PartialSignatureProgress, mergeMuSig2Round2Psbt } from '../../blue_modules/musig2/round2';
import { createMuSig2TaprootSignerWallet, taprootWalletToMuSig2KeyExpression } from '../../blue_modules/musig2/vault';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

const MNEMONIC_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

function deterministicEntropy(seed: number) {
  let counter = seed;
  return () => new Uint8Array(32).fill(counter++);
}

describe('MuSig2 local BlueWallet signers', () => {
  it('keeps Round 1 nonces pending until explicit Round 2 signing and then completes locally', () => {
    const signerA = createMuSig2TaprootSignerWallet(MNEMONIC_A);
    signerA.setLabel('Local A');
    const signerB = createMuSig2TaprootSignerWallet(MNEMONIC_B);
    signerB.setLabel('Local B');

    const vault = new HDTaprootMuSig2Wallet();
    vault.setParticipantKeyExpressions([
      taprootWalletToMuSig2KeyExpression(signerA),
      taprootWalletToMuSig2KeyExpression(signerB),
    ]);

    const matches = getLocalMuSig2SignerMatches(vault, [signerA, signerB]);
    assert.strictEqual(matches.length, 2);

    let coordinator = createMuSig2DryRun(vault).psbt;
    const nonceStates = new Map<string, ReturnType<typeof createLocalMuSig2Round1Response>['nonces']>();

    matches.forEach((match, index) => {
      const response = createLocalMuSig2Round1Response(coordinator, match, deterministicEntropy(10 + index * 10));
      nonceStates.set(match.participant.publicKeyHex, response.nonces);
      coordinator = mergeMuSig2Round1Psbt(coordinator, response.psbt).psbt;
    });

    assert.strictEqual(getMuSig2NonceProgress(coordinator).complete, true);
    assert.strictEqual(getMuSig2PartialSignatureProgress(coordinator).collected, 0);
    for (const nonces of nonceStates.values()) {
      assert.strictEqual(nonces.every(nonce => !nonce.secretNonce.isConsumed()), true);
    }

    for (const match of matches) {
      const nonces = nonceStates.get(match.participant.publicKeyHex);
      assert.ok(nonces);
      const response = createLocalMuSig2Round2Response(coordinator, match, nonces!);
      assert.strictEqual(nonces!.every(nonce => nonce.secretNonce.isConsumed()), true);
      coordinator = mergeMuSig2Round2Psbt(coordinator, response).psbt;
    }

    assert.strictEqual(getMuSig2PartialSignatureProgress(coordinator).complete, true);
    const finalization = finalizeMuSig2Psbt(coordinator);
    assert.strictEqual(finalization.verifiedPartialSignatures, 2);
    assert.strictEqual(finalization.finalSignatures.length, 1);
  });

  it('does not treat an unrelated local Taproot wallet as a vault participant', () => {
    const signerA = createMuSig2TaprootSignerWallet(MNEMONIC_A);
    const signerB = createMuSig2TaprootSignerWallet(MNEMONIC_B);

    const vault = new HDTaprootMuSig2Wallet();
    vault.setParticipantKeyExpressions([
      taprootWalletToMuSig2KeyExpression(signerA),
      taprootWalletToMuSig2KeyExpression(signerB),
    ]);

    assert.strictEqual(getLocalMuSig2SignerMatches(vault, [signerA]).length, 1);
    assert.strictEqual(getLocalMuSig2SignerMatches(vault, []).length, 0);
  });

  it('refuses Round 2 if the frozen public nonce differs from the in-memory local nonce', () => {
    const signerA = createMuSig2TaprootSignerWallet(MNEMONIC_A);
    const signerB = createMuSig2TaprootSignerWallet(MNEMONIC_B);
    const vault = new HDTaprootMuSig2Wallet();
    vault.setParticipantKeyExpressions([
      taprootWalletToMuSig2KeyExpression(signerA),
      taprootWalletToMuSig2KeyExpression(signerB),
    ]);

    const matches = getLocalMuSig2SignerMatches(vault, [signerA, signerB]);
    let coordinator = createMuSig2DryRun(vault).psbt;
    const first = createLocalMuSig2Round1Response(coordinator, matches[0], deterministicEntropy(30));
    coordinator = mergeMuSig2Round1Psbt(coordinator, first.psbt).psbt;
    const second = createLocalMuSig2Round1Response(coordinator, matches[1], deterministicEntropy(40));
    coordinator = mergeMuSig2Round1Psbt(coordinator, second.psbt).psbt;

    first.nonces[0].publicNonce = new Uint8Array(first.nonces[0].publicNonce);
    first.nonces[0].publicNonce[10] ^= 1;

    assert.throws(
      () => createLocalMuSig2Round2Response(coordinator, matches[0], first.nonces),
      /public nonce changed|restart the signing session/,
    );
  });
});