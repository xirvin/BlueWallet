import { Psbt } from 'bitcoinjs-lib';

import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

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

/**
 * Builds a deliberately unbroadcastable MuSig2 PSBT for hardware/software
 * interoperability testing. The input references a fixed nonexistent outpoint
 * and therefore must never be treated as a real wallet transaction.
 */
export function createMuSig2DryRun(wallet: HDTaprootMuSig2Wallet): MuSig2DryRun {
  if (!wallet.hasCompleteExtendedParticipantMetadata()) {
    throw new Error('MuSig2 dry run requires two signer [fingerprint/path]xpub key expressions');
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

  return {
    psbt: result.psbt,
    fundingAddress,
    targetAddress,
    changeAddress,
  };
}
