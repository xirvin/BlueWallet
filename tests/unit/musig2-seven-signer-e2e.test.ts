import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { finalizeMuSig2Psbt } from '../../blue_modules/musig2/finalize';
import {
  LocalMuSig2NonceState,
  createLocalMuSig2Round1Response,
  createLocalMuSig2Round2Response,
  getLocalMuSig2SignerMatches,
} from '../../blue_modules/musig2/local-signer';
import { getMuSig2NonceProgress, mergeMuSig2Round1Psbt } from '../../blue_modules/musig2/psbt';
import { getMuSig2PartialSignatureProgress, mergeMuSig2Round2Psbt } from '../../blue_modules/musig2/round2';
import {
  createMuSig2TaprootSignerWallet,
  getMuSig2SignerDerivationPath,
  taprootWalletToMuSig2KeyExpression,
} from '../../blue_modules/musig2/vault';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

bitcoin.initEccLib(ecc);

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SIGNER_COUNT = 7;
const INPUT_COUNT = 2;
const SIGNER_ACCOUNT_PATHS = Array.from({ length: SIGNER_COUNT }, (_, index) => getMuSig2SignerDerivationPath(index));

function createSevenLocalSigners() {
  return Array.from({ length: SIGNER_COUNT }, (_, index) =>
    createMuSig2TaprootSignerWallet(MNEMONIC, `musig2-seven-signer-${index + 1}`, SIGNER_ACCOUNT_PATHS[index]),
  );
}

describe('MuSig2 7-of-7 end-to-end signing', () => {
  it('carries independent BIP87 signer accounts through both rounds and finalizes a two-input Taproot transaction', () => {
    const signers = createSevenLocalSigners();
    assert.deepStrictEqual(signers.map(signer => signer.getDerivationPath()).sort(), [...SIGNER_ACCOUNT_PATHS].sort());

    const vault = new HDTaprootMuSig2Wallet();
    vault.setParticipantKeyExpressions(signers.map(taprootWalletToMuSig2KeyExpression));

    assert.strictEqual(vault.getSignerCount(), SIGNER_COUNT);
    assert.deepStrictEqual(
      vault.getParticipants().map(participant => participant.derivationPath).sort(),
      [...SIGNER_ACCOUNT_PATHS].sort(),
    );

    const fundingAddress0 = vault._getExternalAddressByIndex(0);
    const fundingAddress1 = vault._getExternalAddressByIndex(1);
    const targetAddress = vault._getExternalAddressByIndex(2);
    const changeAddress = vault._getInternalAddressByIndex(0);
    const transaction = vault.createTransaction(
      [
        { txid: '11'.repeat(32), vout: 0, value: 70_000, address: fundingAddress0 },
        { txid: '22'.repeat(32), vout: 1, value: 70_000, address: fundingAddress1 },
      ],
      [{ address: targetAddress, value: 100_000 }],
      1,
      changeAddress,
    );

    const round1Psbt = transaction.psbt;
    assert.strictEqual(round1Psbt.inputCount, INPUT_COUNT);
    assert.strictEqual(round1Psbt.data.globalMap.globalXpub?.length, SIGNER_COUNT);
    assert.deepStrictEqual(
      round1Psbt.data.globalMap.globalXpub?.map(item => item.path).sort(),
      [...SIGNER_ACCOUNT_PATHS].sort(),
    );

    const matches = getLocalMuSig2SignerMatches(vault, signers);
    assert.strictEqual(matches.length, SIGNER_COUNT);
    assert.deepStrictEqual(
      matches.map(match => match.wallet.getDerivationPath()).sort(),
      [...SIGNER_ACCOUNT_PATHS].sort(),
    );

    let coordinator = bitcoin.Psbt.fromBase64(round1Psbt.toBase64());
    const nonceStates = new Map<string, LocalMuSig2NonceState[]>();

    for (const match of matches) {
      const response = createLocalMuSig2Round1Response(
        coordinator,
        match,
        () => new Uint8Array(32).fill(match.participantIndex + 1),
      );
      nonceStates.set(match.participant.publicKeyHex.toLowerCase(), response.nonces);
      coordinator = mergeMuSig2Round1Psbt(coordinator, response.psbt).psbt;
    }

    assert.deepStrictEqual(getMuSig2NonceProgress(coordinator), {
      collected: SIGNER_COUNT * INPUT_COUNT,
      expected: SIGNER_COUNT * INPUT_COUNT,
      complete: true,
    });

    // Exercise the same public PSBT serialization boundary used for QR/file
    // transport. The one-time secret nonces deliberately remain only in the
    // signer-side in-memory nonceStates map.
    coordinator = bitcoin.Psbt.fromBase64(coordinator.toBase64());

    for (const match of matches) {
      const publicKeyHex = match.participant.publicKeyHex.toLowerCase();
      const signerNonces = nonceStates.get(publicKeyHex);
      assert.ok(signerNonces);

      const response = createLocalMuSig2Round2Response(coordinator, match, signerNonces!);
      coordinator = mergeMuSig2Round2Psbt(coordinator, response).psbt;
    }

    assert.deepStrictEqual(getMuSig2PartialSignatureProgress(coordinator), {
      collected: SIGNER_COUNT * INPUT_COUNT,
      expected: SIGNER_COUNT * INPUT_COUNT,
      complete: true,
    });

    for (const states of nonceStates.values()) {
      assert.strictEqual(states.every(state => state.secretNonce.isConsumed()), true);
    }

    const finalized = finalizeMuSig2Psbt(coordinator);
    assert.strictEqual(finalized.verifiedPartialSignatures, SIGNER_COUNT * INPUT_COUNT);
    assert.strictEqual(finalized.finalSignatures.length, INPUT_COUNT);

    const finalTransaction = bitcoin.Transaction.fromHex(finalized.rawTransactionHex);
    assert.strictEqual(finalTransaction.ins.length, INPUT_COUNT);
    for (const input of finalTransaction.ins) {
      assert.strictEqual(input.witness.length, 1);
      assert.strictEqual(input.witness[0].length, 64);
    }
  });
});
