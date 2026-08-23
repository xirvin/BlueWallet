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
export const MUSIG2_DEFAULT_ACCOUNT_INDEX = 0;
export const MUSIG2_MAX_ACCOUNT_INDEX = 0x7fffffff;
export const MUSIG2_LEGACY_SIGNER_DERIVATION = "m/86'/0'/0'";
export const MUSIG2_WALLET_TYPE_LABEL = 'Taproot (P2TR-MuSig2)';

export type MuSig2SignerDerivationInfo = {
  path: string;
  accountIndex: number;
  scheme: 'nunchuk-bip87' | 'legacy-bluewallet-bip86';
};

export function getMuSig2SignerDerivationPath(accountIndex = MUSIG2_DEFAULT_ACCOUNT_INDEX): string {
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > MUSIG2_MAX_ACCOUNT_INDEX) {
    throw new Error(`MuSig2 account index must be between 0 and ${MUSIG2_MAX_ACCOUNT_INDEX}`);
  }
  return `m/87'/0'/${accountIndex}'`;
}

export const MUSIG2_SIGNER_DERIVATION = getMuSig2SignerDerivationPath();

export function parseMuSig2SignerDerivationPath(path: string): MuSig2SignerDerivationInfo {
  const normalized = path.trim().replace(/[hH]/g, "'");

  if (normalized === MUSIG2_LEGACY_SIGNER_DERIVATION) {
    return {
      path: normalized,
      accountIndex: 0,
      scheme: 'legacy-bluewallet-bip86',
    };
  }

  const nunchuk = normalized.match(/^m\/87'\/0'\/(0|[1-9][0-9]*)'$/);
  if (nunchuk) {
    const accountIndex = Number(nunchuk[1]);
    if (Number.isSafeInteger(accountIndex) && accountIndex <= MUSIG2_MAX_ACCOUNT_INDEX) {
      return {
        path: getMuSig2SignerDerivationPath(accountIndex),
        accountIndex,
        scheme: 'nunchuk-bip87',
      };
    }
  }

  throw new Error(
    `MuSig2 Vault signer origin must use Nunchuk's mainnet m/87'/0'/account' derivation (legacy ${MUSIG2_LEGACY_SIGNER_DERIVATION} vaults remain supported)`,
  );
}

export const MUSIG2_SIGNER_INPUT_PLACEHOLDER =
  "Paste or type signer wallet information here\n\n12 or 24 BIP39 seed words\n\nor\n\nBSMS 1.0\ntr([f23a9cde/87'/0'/0']xpub6ExampleMuSig2SignerKey/*)#checksum\nNo path restrictions\nbc1p...\n\nor\n\n[f23a9cde/87'/0'/0']xpub6ExampleMuSig2SignerKey\n\nor compatible signer JSON";

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

export function normalizeMuSig2VaultSigner(
  input: string,
  requiredDerivationPath?: string,
): {
  keyExpression: string;
  participant: MuSig2ParticipantMetadata;
} {
  const keyExpression = normalizeMuSig2SignerInput(input).trim();
  const participant = parseMuSig2ParticipantKeyExpression(keyExpression);

  if (!participant.xpub || !participant.masterFingerprint || !participant.derivationPath) {
    throw new Error('MuSig2 Vault signers must use a [fingerprint/path]xpub Taproot key expression');
  }

  const derivation = parseMuSig2SignerDerivationPath(participant.derivationPath);
  participant.derivationPath = derivation.path;

  if (requiredDerivationPath) {
    const required = parseMuSig2SignerDerivationPath(requiredDerivationPath);
    if (derivation.path !== required.path) {
      throw new Error(`MuSig2 Vault signer origin must use ${required.path}`);
    }
  }

  return { keyExpression, participant };
}

export function validateMuSig2VaultSigners(
  inputs: string[],
  expectedCount = inputs.length,
  requiredDerivationPath?: string,
): string[] {
  assertMuSig2SignerCount(expectedCount);
  if (inputs.length !== expectedCount) {
    throw new Error(`MuSig2 Vault requires exactly ${expectedCount} signer keys`);
  }

  const normalized = inputs.map(input => normalizeMuSig2VaultSigner(input, requiredDerivationPath));
  const publicKeys = new Set(normalized.map(item => item.participant.publicKeyHex));
  if (publicKeys.size !== normalized.length) {
    throw new Error('MuSig2 Vault signer keys must all be distinct');
  }

  const derivationPaths = new Set(normalized.map(item => item.participant.derivationPath));
  if (derivationPaths.size !== 1) {
    throw new Error("All MuSig2 Vault signers must use the same m/87'/0'/account' origin");
  }

  return normalized.map(item => item.keyExpression);
}

/**
 * Builds a dedicated local Taproot signer wallet at the Nunchuk MuSig2 account
 * origin by default. A recorded legacy derivation can be supplied when an
 * existing BlueWallet MuSig2 signer is being restored.
 */
export function createMuSig2TaprootSignerWallet(
  mnemonic: string,
  passphrase = '',
  derivationPath = MUSIG2_SIGNER_DERIVATION,
): HDTaprootWallet {
  const derivation = parseMuSig2SignerDerivationPath(derivationPath);
  const wallet = new HDTaprootWallet();
  wallet._derivationPath = derivation.path;
  wallet.setSecret(mnemonic);
  if (!wallet.validateMnemonic()) {
    throw new Error('MuSig2 local signer must use a valid BIP39 seed phrase');
  }
  if (passphrase) wallet.setPassphrase(passphrase);
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
  const derivation = parseMuSig2SignerDerivationPath(wallet.getDerivationPath());

  // A freshly generated local signer has not imported an external hardware
  // fingerprint, so derive the BIP32 master fingerprint directly from its
  // BIP39 seed (including any configured BIP39 passphrase).
  const root = bip32.fromSeed(wallet._getSeed());
  const fingerprint = uint8ArrayToHex(root.fingerprint).toLowerCase();
  const origin = derivation.path.slice(2);
  return `[${fingerprint}/${origin}]${wallet.getXpub()}`;
}
