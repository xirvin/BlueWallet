import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import {
  MuSig2ParticipantMetadata,
  parseMuSig2ParticipantKeyExpression,
} from '../../class/wallets/hd-taproot-musig2-wallet';
import { normalizeMuSig2SignerInput } from './bsms';

export const MUSIG2_MIN_SIGNERS = 2;
export const MUSIG2_MAX_SIGNERS = 7;
export const MUSIG2_DEFAULT_SIGNERS = 2;
export const MUSIG2_SIGNER_DERIVATION = "m/86'/0'/0'";
export const MUSIG2_WALLET_TYPE_LABEL = 'Taproot (P2TR-MuSig2)';

export const MUSIG2_SIGNER_INPUT_PLACEHOLDER =
  "BSMS 1.0\ntr([f23a9cde/86'/0'/0']xpub6ExampleTaprootSignerKey/*)#checksum\nNo path restrictions\nbc1p...\n\nor\n[f23a9cde/86'/0'/0']xpub6ExampleTaprootSignerKey";

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

export function taprootWalletToMuSig2KeyExpression(wallet: HDTaprootWallet): string {
  const derivationPath = wallet.getDerivationPath();
  if (derivationPath !== MUSIG2_SIGNER_DERIVATION) {
    throw new Error(`Taproot signer wallet must use ${MUSIG2_SIGNER_DERIVATION}`);
  }

  const fingerprint = wallet.getMasterFingerprintHex().toLowerCase();
  const origin = derivationPath.slice(2);
  return `[${fingerprint}/${origin}]${wallet.getXpub()}`;
}
