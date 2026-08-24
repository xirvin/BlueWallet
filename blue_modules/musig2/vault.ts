import BIP32Factory from 'bip32';

import ecc from '../noble_ecc';
import { uint8ArrayToHex } from '../uint8array-extras';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import {
  HDTaprootMuSig2Wallet,
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

export function parseMuSig2SignerDerivationPath(path?: string): MuSig2SignerDerivationInfo {
  if (!path) {
    throw new Error("MuSig2 Vault signer origin is missing; expected Nunchuk's mainnet m/87'/0'/account' derivation");
  }

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

function normalizeMasterFingerprint(masterFingerprint: string): string {
  const normalized = masterFingerprint.trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(normalized)) {
    throw new Error('MuSig2 signer fingerprint must be exactly 8 hexadecimal characters');
  }
  return normalized;
}

export function getMuSig2LocalSignerMasterFingerprint(wallet: HDTaprootWallet): string {
  const root = bip32.fromSeed(wallet._getSeed());
  return uint8ArrayToHex(root.fingerprint).toLowerCase();
}

export function getUsedMuSig2AccountIndexesForFingerprint(
  masterFingerprint: string,
  vaults: HDTaprootMuSig2Wallet[],
): number[] {
  const fingerprint = normalizeMasterFingerprint(masterFingerprint);
  const used = new Set<number>();

  for (const vault of vaults) {
    for (const participant of vault.getParticipants()) {
      if (participant.masterFingerprint?.toLowerCase() !== fingerprint || !participant.derivationPath) continue;
      try {
        const derivation = parseMuSig2SignerDerivationPath(participant.derivationPath);
        if (derivation.scheme === 'nunchuk-bip87') used.add(derivation.accountIndex);
      } catch {
        // Ignore unrelated/custom historical participant paths here. The vault
        // validator is responsible for deciding whether they can be used.
      }
    }
  }

  return [...used].sort((a, b) => a - b);
}

export function isMuSig2AccountIndexUsedForFingerprint(
  masterFingerprint: string,
  accountIndex: number,
  vaults: HDTaprootMuSig2Wallet[],
): boolean {
  return getUsedMuSig2AccountIndexesForFingerprint(masterFingerprint, vaults).includes(accountIndex);
}

export function getNextUnusedMuSig2AccountIndexForFingerprint(
  masterFingerprint: string,
  vaults: HDTaprootMuSig2Wallet[],
): number {
  const used = new Set(getUsedMuSig2AccountIndexesForFingerprint(masterFingerprint, vaults));
  for (let accountIndex = 0; accountIndex <= MUSIG2_MAX_ACCOUNT_INDEX; accountIndex++) {
    if (!used.has(accountIndex)) return accountIndex;
  }
  throw new Error('No unused MuSig2 BIP87 account indexes remain for this signer');
}

export function assertMuSig2AccountAvailableForFingerprint(
  masterFingerprint: string,
  accountIndex: number,
  vaults: HDTaprootMuSig2Wallet[],
): void {
  if (isMuSig2AccountIndexUsedForFingerprint(masterFingerprint, accountIndex, vaults)) {
    throw new Error(
      `MuSig2 account ${accountIndex} is already used by signer ${normalizeMasterFingerprint(masterFingerprint).toUpperCase()} in another vault`,
    );
  }
}

export function assertMuSig2ParticipantAccountAvailable(
  participant: MuSig2ParticipantMetadata,
  vaults: HDTaprootMuSig2Wallet[],
): void {
  if (!participant.masterFingerprint || !participant.derivationPath) return;
  const derivation = parseMuSig2SignerDerivationPath(participant.derivationPath);
  if (derivation.scheme !== 'nunchuk-bip87') return;
  assertMuSig2AccountAvailableForFingerprint(participant.masterFingerprint, derivation.accountIndex, vaults);
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
    throw new Error('All MuSig2 Vault signers must use the same signer account origin');
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

/**
 * Creates the account view for a new vault. If this master signer has already
 * been used in stored BIP87 MuSig2 vaults, the next unused hardened account is
 * selected. When another participant has already fixed the vault account,
 * requiredDerivationPath is enforced instead.
 */
export function createMuSig2TaprootSignerWalletForVault(
  mnemonic: string,
  passphrase: string,
  vaults: HDTaprootMuSig2Wallet[],
  requiredDerivationPath?: string,
): HDTaprootWallet {
  const probe = createMuSig2TaprootSignerWallet(mnemonic, passphrase);
  const fingerprint = getMuSig2LocalSignerMasterFingerprint(probe);

  let targetPath: string;
  if (requiredDerivationPath) {
    const required = parseMuSig2SignerDerivationPath(requiredDerivationPath);
    if (required.scheme === 'nunchuk-bip87') {
      assertMuSig2AccountAvailableForFingerprint(fingerprint, required.accountIndex, vaults);
    }
    targetPath = required.path;
  } else {
    targetPath = getMuSig2SignerDerivationPath(getNextUnusedMuSig2AccountIndexForFingerprint(fingerprint, vaults));
  }

  return createMuSig2TaprootSignerWallet(mnemonic, passphrase, targetPath);
}

/**
 * Reuses the same local master seed in another MuSig2 vault by deriving a
 * sibling BIP87 account. The source account wallet is returned unchanged only
 * when its account has not yet been committed to another stored vault.
 */
export function deriveMuSig2TaprootSignerAccountWalletForVault(
  sourceWallet: HDTaprootWallet,
  vaults: HDTaprootMuSig2Wallet[],
  requiredDerivationPath?: string,
): HDTaprootWallet {
  const fingerprint = getMuSig2LocalSignerMasterFingerprint(sourceWallet);
  let targetPath: string;

  if (requiredDerivationPath) {
    const required = parseMuSig2SignerDerivationPath(requiredDerivationPath);
    if (required.scheme === 'nunchuk-bip87') {
      assertMuSig2AccountAvailableForFingerprint(fingerprint, required.accountIndex, vaults);
    }
    targetPath = required.path;
  } else {
    let current: MuSig2SignerDerivationInfo | undefined;
    try {
      current = parseMuSig2SignerDerivationPath(sourceWallet.getDerivationPath());
    } catch {
      current = undefined;
    }

    if (
      current?.scheme === 'nunchuk-bip87' &&
      !isMuSig2AccountIndexUsedForFingerprint(fingerprint, current.accountIndex, vaults)
    ) {
      targetPath = current.path;
    } else {
      targetPath = getMuSig2SignerDerivationPath(getNextUnusedMuSig2AccountIndexForFingerprint(fingerprint, vaults));
    }
  }

  if (sourceWallet.getDerivationPath()?.replace(/[hH]/g, "'") === targetPath) return sourceWallet;

  const accountWallet = createMuSig2TaprootSignerWallet(
    sourceWallet.getSecret(),
    sourceWallet.getPassphrase() ?? '',
    targetPath,
  );
  accountWallet.setLabel(sourceWallet.getLabel());
  return accountWallet;
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
