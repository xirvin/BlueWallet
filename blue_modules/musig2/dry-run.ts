import BIP32Factory, { BIP32Interface } from 'bip32';
import { Psbt } from 'bitcoinjs-lib';

import ecc from '../noble_ecc';
import { hexToUint8Array } from '../uint8array-extras';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

const bip32 = BIP32Factory(ecc);

export const MUSIG2_DRY_RUN_FAKE_TXID = '11'.repeat(32);
export const MUSIG2_DRY_RUN_INPUT_VALUE = 100_000;
export const MUSIG2_DRY_RUN_TARGET_VALUE = 25_000;
export const MUSIG2_DRY_RUN_FEE_RATE = 1;

export type MuSig2DryRun = {
  psbt: Psbt;
  fundingAddress: string;
  targetAddress: string;
  changeAddress: string;
};

function serializeExtendedPublicKey(node: BIP32Interface): Uint8Array {
  const serialized = new Uint8Array(78);
  const view = new DataView(serialized.buffer, serialized.byteOffset, serialized.byteLength);

  view.setUint32(0, node.network.bip32.public, false);
  serialized[4] = node.depth;
  view.setUint32(5, node.parentFingerprint, false);
  view.setUint32(9, node.index, false);
  serialized.set(node.chainCode, 13);
  serialized.set(node.publicKey, 45);

  return serialized;
}

function addParticipantGlobalXpubs(psbt: Psbt, wallet: HDTaprootMuSig2Wallet): void {
  const globalXpub = wallet.getParticipants().map(participant => {
    if (!participant.xpub || !participant.masterFingerprint || !participant.derivationPath) {
      throw new Error('MuSig2 dry run requires complete signer xpub origin metadata');
    }

    return {
      extendedPubkey: serializeExtendedPublicKey(bip32.fromBase58(participant.xpub)),
      masterFingerprint: hexToUint8Array(participant.masterFingerprint),
      path: participant.derivationPath,
    };
  });

  psbt.updateGlobal({ globalXpub });
}

/**
 * Builds a deliberately unbroadcastable MuSig2 PSBT for hardware/software
 * interoperability testing. The input references a fixed nonexistent outpoint
 * and therefore must never be treated as a real wallet transaction.
 */
export function createMuSig2DryRun(wallet: HDTaprootMuSig2Wallet): MuSig2DryRun {
  if (!wallet.hasCompleteExtendedParticipantMetadata()) {
    throw new Error('MuSig2 dry run requires complete [fingerprint/path]xpub key expressions for every signer');
  }

  const fundingAddress = wallet._getExternalAddressByIndex(0);
  const targetAddress = wallet._getExternalAddressByIndex(1);
  const changeAddress = wallet._getInternalAddressByIndex(0);

  const result = wallet.createTransaction(
    [
      {
        txid: MUSIG2_DRY_RUN_FAKE_TXID,
        vout: 0,
        value: MUSIG2_DRY_RUN_INPUT_VALUE,
        address: fundingAddress,
      },
    ],
    [{ address: targetAddress, value: MUSIG2_DRY_RUN_TARGET_VALUE }],
    MUSIG2_DRY_RUN_FEE_RATE,
    changeAddress,
  );

  if (result.tx) throw new Error('MuSig2 dry run unexpectedly produced a signed transaction');

  // BIP174 global XPUB records give hardware signers enough public metadata to
  // identify or reconstruct the BIP390 MuSig2 wallet from all account xpubs.
  // They contain no private key material.
  addParticipantGlobalXpubs(result.psbt, wallet);

  return {
    psbt: result.psbt,
    fundingAddress,
    targetAddress,
    changeAddress,
  };
}
