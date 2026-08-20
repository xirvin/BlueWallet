import { HDTaprootMuSig2Wallet, MuSig2ParticipantMetadata } from '../../class/wallets/hd-taproot-musig2-wallet';
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
  watchOnly.setSecret(participant.xpub);
  watchOnly.segwitType = 'p2tr';
  watchOnly._derivationPath = participant.derivationPath;
  watchOnly.hideBalance = localWallet.hideBalance;
  watchOnly.setPreferredBalanceUnit(localWallet.getPreferredBalanceUnit());
  watchOnly.setUserHasSavedExport(localWallet.getUserHasSavedExport());
  watchOnly.setHideTransactionsInWalletsList(localWallet.getHideTransactionsInWalletsList());
  watchOnly.init();

  const hdWallet = watchOnly._hdWalletInstance;
  if (!(hdWallet instanceof HDTaprootWallet)) {
    throw new Error('Could not create xpub-only Taproot signer wallet');
  }

  // Preserve public wallet state so the converted signer remains useful as a
  // watch-only wallet without copying any mnemonic, passphrase, WIF cache, or
  // private BIP32 node state.
  hdWallet.next_free_address_index = localWallet.next_free_address_index;
  hdWallet.next_free_change_address_index = localWallet.next_free_change_address_index;
  hdWallet.external_addresses_cache = { ...localWallet.external_addresses_cache };
  hdWallet.internal_addresses_cache = { ...localWallet.internal_addresses_cache };
  hdWallet.balance = localWallet.balance;
  hdWallet.unconfirmed_balance = localWallet.unconfirmed_balance;
  hdWallet._lastTxFetch = localWallet._lastTxFetch;
  hdWallet._lastBalanceFetch = localWallet._lastBalanceFetch;
  hdWallet._utxo = [...localWallet._utxo];
  hdWallet.preferredBalanceUnit = localWallet.getPreferredBalanceUnit();
  hdWallet.hideBalance = localWallet.hideBalance;

  return watchOnly;
}

export function getMuSig2VaultLocalSignerWallets(wallet: HDTaprootMuSig2Wallet, wallets: HDTaprootWallet[]): HDTaprootWallet[] {
  const participants = wallet.getParticipants();
  return participants.flatMap(participant => {
    const local = wallets.find(candidate => {
      try {
        return normalizeMuSig2VaultSigner(taprootWalletToMuSig2KeyExpression(candidate)).participant.publicKeyHex === participant.publicKeyHex;
      } catch {
        return false;
      }
    });
    return local ? [local] : [];
  });
}
