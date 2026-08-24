import { descriptorChecksum } from '../../class/wallet-descriptor';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import {
  parseMuSig2SignerDerivationPath,
  validateMuSig2VaultSigners,
} from './vault';
import { MUSIG2_BSMS_PATH_RESTRICTIONS, MUSIG2_BSMS_VERSION } from './bsms';

const NUNCHUK_BSMS_ALTERNATE_PATH_RESTRICTIONS = '/0/*,/1/*';
const NUNCHUK_KEY_SUFFIXES = ['/*', '/0/*', '/1/*', '/<0;1>/*'] as const;
type NunchukKeySuffix = (typeof NUNCHUK_KEY_SUFFIXES)[number];

export type NunchukMuSig2WalletImport = {
  wallet: HDTaprootMuSig2Wallet;
  descriptor: string;
  descriptorSuffix: NunchukKeySuffix;
  bsms?: string;
  firstAddress?: string;
};

function looksLikeMuSig2Descriptor(value: string): boolean {
  return value.replace(/\s+/g, '').includes('musig(');
}

function validateDescriptorChecksum(descriptor: string): string {
  const normalized = descriptor.trim();
  const separator = normalized.lastIndexOf('#');
  if (separator <= 0 || separator !== normalized.length - 9) {
    throw new Error('Nunchuk MuSig2 descriptor must contain an 8-character checksum');
  }

  const body = normalized.slice(0, separator);
  const supplied = normalized.slice(separator + 1).toLowerCase();
  const expected = descriptorChecksum(body);
  if (supplied !== expected) throw new Error('Nunchuk MuSig2 descriptor checksum is invalid');
  return body;
}

function splitMusigKeys(body: string): string[] {
  const compact = body.replace(/\s+/g, '');
  const prefix = 'tr(musig(';
  const suffix = '))';

  if (!compact.startsWith(prefix)) {
    if (looksLikeMuSig2Descriptor(compact)) {
      throw new Error(
        'This Nunchuk MuSig2 wallet uses a Taproot script path. BlueWallet MuSig2 import currently supports N-of-N Value Keyset key-path wallets only.',
      );
    }
    return [];
  }
  if (!compact.endsWith(suffix)) {
    throw new Error('Nunchuk MuSig2 descriptor must be a direct tr(musig(...)) key-path descriptor');
  }

  const inner = compact.slice(prefix.length, -suffix.length);
  if (!inner) throw new Error('Nunchuk MuSig2 descriptor contains no signer keys');

  // Extended public-key expressions do not contain commas. A comma inside a
  // different policy expression therefore means this is not the N-of-N
  // key-path form BlueWallet intentionally supports here.
  return inner.split(',');
}

function stripNunchukKeySuffix(key: string): { keyExpression: string; suffix: NunchukKeySuffix } {
  for (const suffix of [...NUNCHUK_KEY_SUFFIXES].sort((a, b) => b.length - a.length)) {
    if (key.endsWith(suffix)) {
      const keyExpression = key.slice(0, -suffix.length);
      if (!keyExpression) break;
      return { keyExpression, suffix };
    }
  }
  throw new Error('Nunchuk MuSig2 signer key must end in /*, /0/*, /1/*, or /<0;1>/*');
}

export function parseNunchukMuSig2Descriptor(descriptor: string): NunchukMuSig2WalletImport | undefined {
  const normalizedDescriptor = descriptor.trim();
  if (!looksLikeMuSig2Descriptor(normalizedDescriptor)) return undefined;

  const body = validateDescriptorChecksum(normalizedDescriptor);
  const keys = splitMusigKeys(body);
  if (keys.length === 0) return undefined;

  const parsed = keys.map(stripNunchukKeySuffix);
  const suffixes = new Set(parsed.map(item => item.suffix));
  if (suffixes.size !== 1) {
    throw new Error('All Nunchuk MuSig2 signer keys must use the same address-derivation suffix');
  }

  const signerExpressions = validateMuSig2VaultSigners(parsed.map(item => item.keyExpression), parsed.length);
  for (const expression of signerExpressions) {
    const closeBracket = expression.indexOf(']');
    if (closeBracket < 0) throw new Error('Nunchuk MuSig2 signer is missing origin metadata');
    const origin = expression.slice(1, closeBracket);
    const slash = origin.indexOf('/');
    const path = slash < 0 ? undefined : `m/${origin.slice(slash + 1)}`;
    const derivation = parseMuSig2SignerDerivationPath(path);
    if (derivation.scheme !== 'nunchuk-bip87') {
      throw new Error("Nunchuk MuSig2 wallet signers must use the BIP87 m/87'/0'/account' origin family");
    }
  }

  const wallet = new HDTaprootMuSig2Wallet();
  wallet.setLabel('Nunchuk MuSig2 Vault');
  wallet.setParticipantKeyExpressions(signerExpressions);
  wallet.setDerivationMode('bip390-derived-participants');

  return {
    wallet,
    descriptor: normalizedDescriptor,
    descriptorSuffix: parsed[0].suffix,
  };
}

/**
 * Parses either a raw Nunchuk MuSig2 descriptor or the four-line BSMS 1.0
 * wallet backup produced by Nunchuk. Unrelated wallet text returns undefined;
 * malformed MuSig2 input throws so the normal import UI can show a useful
 * policy/checksum/address error instead of falling through to another format.
 */
export function parseNunchukMuSig2WalletInput(input: string): NunchukMuSig2WalletImport | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (!/^BSMS\s+1\.0(?:\r?\n|$)/i.test(trimmed)) {
    return parseNunchukMuSig2Descriptor(trimmed);
  }

  const lines = trimmed.split(/\r?\n/).map(line => line.trim());
  if (lines.length !== 4) {
    // Do not steal unrelated BSMS imports from BlueWallet's existing multisig
    // importer unless the descriptor itself is MuSig2.
    const descriptorLine = lines[1] ?? '';
    if (!looksLikeMuSig2Descriptor(descriptorLine)) return undefined;
    throw new Error('Nunchuk MuSig2 BSMS 1.0 backup must contain exactly four lines');
  }
  if (lines[0] !== MUSIG2_BSMS_VERSION) {
    if (!looksLikeMuSig2Descriptor(lines[1] ?? '')) return undefined;
    throw new Error(`Nunchuk MuSig2 backup must begin with ${MUSIG2_BSMS_VERSION}`);
  }

  const descriptorResult = parseNunchukMuSig2Descriptor(lines[1]);
  if (!descriptorResult) return undefined;

  if (
    lines[2] !== MUSIG2_BSMS_PATH_RESTRICTIONS &&
    lines[2] !== NUNCHUK_BSMS_ALTERNATE_PATH_RESTRICTIONS
  ) {
    throw new Error('Unsupported Nunchuk BSMS path restrictions');
  }
  if (!lines[3]) throw new Error('Nunchuk MuSig2 BSMS backup is missing its first receive address');

  const expectedFirstAddress = descriptorResult.wallet._getExternalAddressByIndex(0);
  if (lines[3].toLowerCase() !== expectedFirstAddress.toLowerCase()) {
    throw new Error(
      `Nunchuk MuSig2 BSMS first address does not match the descriptor (expected ${expectedFirstAddress})`,
    );
  }

  return {
    ...descriptorResult,
    bsms: trimmed,
    firstAddress: lines[3],
  };
}
