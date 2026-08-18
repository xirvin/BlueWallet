import BIP32Factory from 'bip32';

import ecc from '../noble_ecc';
import { uint8ArrayToHex } from '../uint8array-extras';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import {
  MuSig2ParticipantMetadata,
  parseMuSig2ParticipantKeyExpression,
} from '../../class/wallets/hd-taproot-musig2-wallet';
import { normalizeMuSig2SignerInput } from './bsms';

const bip32 = BIP32Factory(ecc);

export const MUSIG2_MIN_SIGNERS = 2;
export const MUSIG2_MAX_SIGNERS = 7;
export const MUSIG2_DEFAULT_SIGNERS = 2;
export const MUSIG2_SIGNER_DERIVATION = "m/86'/0'/0'";
export const MUSIG2_WALLET_TYPE_LABEL = 'Taproot (P2TR-MuSig2)';

export const MUSIG2_SIGNER_INPUT_PLACEHOLDER =
  "12 or 24 BIP39 seed words\n\nor\nBSMS 1.0\ntr([f23a9cde/86'/0'/0']xpub6ExampleTaprootSignerKey/*)#checksum\nNo path restrictions\nbc1p...\n\nor\n[f23a9cde/86'/0'/0']xpub6ExampleTaprootSignerKey\n\nor compatible signer JSON";

export function assertMuSig2SignerCount(count: number): number {
  if (!Number.isInteger(count) || count < MUSIG2_MIN_SIGNERS || count > MUSIG2_MAX_SIGNERS) {
    throw new Error(`MuSig2 Vault requires between ${MUSIG2_MIN_SIGNERS} and ${MUSIG2_MAX_SIGNERS} signers`);
  }
  return count;
}

export function clampMuSig2SignerCount(count: number): number {
  if (!Number.isFinite(count)) return MUSIG2_DEFAULT_SIGNERS;
  return Math.min(MUSIG2_MAX_SIGNERS, Math.max(MUSIG2_MIN_SIGNERS, Math.trunc(count)));
}

export function normalizeMuSig2VaultSigner(input: string): {
  keyExpression: string;
  participant: MuSig2ParticipantMetadata;
} {
  const keyExpression = normalizeMuSig2SignerInput(input).trim();
  const participant = parseMuSig2ParticipantKeyExpression(keyExpression);

  if (!participant.xpub || !participant.masterFingerprint || !participant.derivationPath) {
    throw new Error('MuSig2 Vault signers must use a [fingerprint/path]xpub Taproot key expression');
  }
  if (participant.derivationPath !== MUSIG2_SIGNER_DERIVATION) {
    throw new Error(`MuSig2 Vault signer origin must use the standard BIP86 path ${MUSIG2_SIGNER_DERIVATION}`);
  }

  return { keyExpression, participant };
}

export function validateMuSig2VaultSigners(inputs: string[], expectedCount = inputs.length): string[] {
  assertMuSig2SignerCount(expectedCount);
  if (inputs.length !== expectedCount) {
    throw new Error(`MuSig2 Vault requires exactly ${expectedCount} signer keys`);
  }

  const normalized = inputs.map(input => normalizeMuSig2VaultSigner(input));
  const publicKeys = new Set(normalized.map(item => item.participant.publicKeyHex));
  if (publicKeys.size !== normalized.length) {
    throw new Error('MuSig2 Vault signer keys must all be distinct');
  }

  return normalized.map(item => item.keyExpression);
}

/**
 * Builds a normal BlueWallet BIP86 Taproot wallet for a local MuSig2 signer.
 * The returned wallet remains a regular single-sig Taproot wallet. The MuSig2
 * vault receives only the public account key expression derived from it.
 */
export function createMuSig2TaprootSignerWallet(mnemonic: string, passphrase = ''): HDTaprootWallet {
  const wallet = new HDTaprootWallet();
  wallet.setSecret(mnemonic);
  if (!wallet.validateMnemonic()) {
    throw new Error('MuSig2 local signer must use a valid BIP39 seed phrase');
  }
  if (passphrase) wallet.setPassphrase(passphrase);
  if (wallet.getDerivationPath() !== MUSIG2_SIGNER_DERIVATION) {
    throw new Error(`Taproot signer wallet must use ${MUSIG2_SIGNER_DERIVATION}`);
  }
  return wallet;
}

export function isMuSig2TaprootSignerMnemonic(input: string): boolean {
  try {
    createMuSig2TaprootSignerWallet(input);
    return true;
  } catch {
    return false;
  }
}

export function taprootWalletToMuSig2KeyExpression(wallet: HDTaprootWallet): string {
  const derivationPath = wallet.getDerivationPath();
  if (derivationPath !== MUSIG2_SIGNER_DERIVATION) {
    throw new Error(`Taproot signer wallet must use ${MUSIG2_SIGNER_DERIVATION}`);
  }

  // A freshly generated HDTaprootWallet has not imported an external hardware
  // fingerprint, so derive the BIP32 master fingerprint directly from its
  // BIP39 seed (including any configured BIP39 passphrase).
  const root = bip32.fromSeed(wallet._getSeed());
  const fingerprint = uint8ArrayToHex(root.fingerprint).toLowerCase();
  const origin = derivationPath.slice(2);
  return `[${fingerprint}/${origin}]${wallet.getXpub()}`;
}
