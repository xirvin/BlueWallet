import { MuSig2ParticipantMetadata } from '../../class/wallets/hd-taproot-musig2-wallet';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { normalizeMuSig2VaultSigner, taprootWalletToMuSig2KeyExpression } from './vault';

function assertExtendedParticipant(participant: MuSig2ParticipantMetadata): asserts participant is MuSig2ParticipantMetadata & {
  xpub: string;
  masterFingerprint: string;
  derivationPath: string;
} {
  if (!participant.xpub || !participant.masterFingerprint || !participant.derivationPath) {
    throw new Error('MuSig2 signer requires xpub, fingerprint, and derivation path metadata');
  }
}

function copyPublicTaprootWalletState(source: HDTaprootWallet, target: HDTaprootWallet): void {
  target.next_free_address_index = source.next_free_address_index;
  target.next_free_change_address_index = source.next_free_change_address_index;
  target.external_addresses_cache = { ...source.external_addresses_cache };
  target.internal_addresses_cache = { ...source.internal_addresses_cache };
  target._txs_by_external_index = { ...source._txs_by_external_index };
  target._txs_by_internal_index = { ...source._txs_by_internal_index };
  target._utxo = [...source._utxo];
  target._utxoMetadata = { ...source._utxoMetadata };
  target.balance = source.balance;
  target.unconfirmed_balance = source.unconfirmed_balance;
  target._lastTxFetch = source._lastTxFetch;
  target._lastBalanceFetch = source._lastBalanceFetch;
  target.gap_limit = source.gap_limit;
  target.preferredBalanceUnit = source.getPreferredBalanceUnit();
  target.hideBalance = source.hideBalance;
}

export function muSig2ParticipantKeyExpression(participant: MuSig2ParticipantMetadata): string {
  assertExtendedParticipant(participant);
  const origin = participant.derivationPath === 'm' ? '' : `/${participant.derivationPath.slice(2)}`;
  return `[${participant.masterFingerprint}${origin}]${participant.xpub}`;
}

export function watchOnlyWalletMatchesMuSig2Participant(wallet: WatchOnlyWallet, participant: MuSig2ParticipantMetadata): boolean {
  if (!participant.xpub || !participant.derivationPath) return false;
  return wallet.getSecret() === participant.xpub && wallet._derivationPath === participant.derivationPath && wallet.segwitType === 'p2tr';
}

export function createMuSig2WatchOnlySignerWallet(
  localWallet: HDTaprootWallet,
  participant: MuSig2ParticipantMetadata,
): WatchOnlyWallet {
  assertExtendedParticipant(participant);

  const localParticipant = normalizeMuSig2VaultSigner(taprootWalletToMuSig2KeyExpression(localWallet)).participant;
  if (
    localParticipant.publicKeyHex !== participant.publicKeyHex.toLowerCase() ||
    localParticipant.xpub !== participant.xpub ||
    localParticipant.masterFingerprint !== participant.masterFingerprint.toLowerCase() ||
    localParticipant.derivationPath !== participant.derivationPath
  ) {
    throw new Error('Local Taproot signer no longer matches this MuSig2 Vault Key');
  }

  const watchOnly = new WatchOnlyWallet();
  watchOnly.setLabel(localWallet.getLabel());
  watchOnly.setSecret(muSig2ParticipantKeyExpression(participant));
  watchOnly.segwitType = 'p2tr';
  watchOnly.hideBalance = localWallet.hideBalance;
  watchOnly.setPreferredBalanceUnit(localWallet.getPreferredBalanceUnit());
  watchOnly.setUserHasSavedExport(localWallet.getUserHasSavedExport());
  watchOnly.setHideTransactionsInWalletsList(localWallet.getHideTransactionsInWalletsList());
  watchOnly.init();

  const hdWallet = watchOnly._hdWalletInstance;
  if (!(hdWallet instanceof HDTaprootWallet)) {
    throw new Error('Could not create xpub-only Taproot signer wallet');
  }

  // Preserve only public wallet state so the converted signer remains useful
  // as a watch-only wallet. Mnemonic, passphrase, WIF cache, and private BIP32
  // node state are deliberately not copied.
  copyPublicTaprootWalletState(localWallet, hdWallet);

  return watchOnly;
}

export function restoreMuSig2LocalSignerWalletFromWatchOnly(
  localWallet: HDTaprootWallet,
  watchOnly: WatchOnlyWallet,
): HDTaprootWallet {
  const hdWallet = watchOnly._hdWalletInstance;
  if (!(hdWallet instanceof HDTaprootWallet)) {
    throw new Error('MuSig2 xpub-only signer wallet is not initialized as Taproot');
  }

  localWallet.setLabel(watchOnly.getLabel());
  localWallet.setPreferredBalanceUnit(watchOnly.getPreferredBalanceUnit());
  localWallet.hideBalance = watchOnly.hideBalance;
  localWallet.setUserHasSavedExport(watchOnly.getUserHasSavedExport());
  localWallet.setHideTransactionsInWalletsList(watchOnly.getHideTransactionsInWalletsList());
  copyPublicTaprootWalletState(hdWallet, localWallet);
  return localWallet;
}
