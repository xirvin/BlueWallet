import { descriptorChecksum } from '../../class/wallet-descriptor';

const XPUB_PATTERN = 'xpub[1-9A-HJ-NP-Za-km-z]+';
const ORIGIN_PATTERN = String.raw`\[[0-9a-fA-F]{8}(?:\/(?:0|[1-9][0-9]*)(?:['hH])?)*\]`;
const TAPROOT_DESCRIPTOR = new RegExp(
  String.raw`tr\((${ORIGIN_PATTERN}${XPUB_PATTERN})\/\*\)#([0-9a-z]{8})`,
  'i',
);
const BARE_KEY_EXPRESSION = new RegExp(String.raw`^${ORIGIN_PATTERN}${XPUB_PATTERN}$`, 'i');

function normalizeJsonFingerprint(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff) {
    return value.toString(16).padStart(8, '0');
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/^0x/i, '');
  return /^[0-9a-fA-F]{8}$/.test(normalized) ? normalized : undefined;
}

function normalizeColdcardElectrumFingerprint(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff) {
    const bigEndianHex = value.toString(16).padStart(8, '0');
    return bigEndianHex.match(/../g)?.reverse().join('');
  }

  // Some external exporters may serialize an already display-formatted XFP as
  // an eight-character hex string. Preserve that byte order rather than
  // applying Electrum's integer representation a second time.
  return normalizeJsonFingerprint(value);
}

function normalizeJsonPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const path = value.trim().replace(/[hH]/g, "'");
  if (path !== 'm' && !path.startsWith('m/')) return undefined;
  return path;
}

function keyExpressionFromElectrumColdcardJson(record: Record<string, unknown>): string | undefined {
  const keystoreValue = record.keystore;
  if (!keystoreValue || typeof keystoreValue !== 'object' || Array.isArray(keystoreValue)) return undefined;

  const keystore = keystoreValue as Record<string, unknown>;
  if (keystore.ckcc_xfp === undefined || typeof keystore.xpub !== 'string' || !keystore.xpub.trim()) return undefined;

  const fingerprint = normalizeColdcardElectrumFingerprint(keystore.ckcc_xfp);
  const path = normalizeJsonPath(keystore.derivation ?? keystore.derivationPath ?? keystore.path);
  if (!fingerprint || !path) return undefined;

  const originPath = path === 'm' ? '' : `/${path.slice(2)}`;
  return `[${fingerprint}${originPath}]${keystore.xpub.trim()}`;
}

function keyExpressionFromJson(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  for (const field of ['keyExpression', 'bsms', 'descriptor', 'desc']) {
    if (typeof record[field] === 'string' && record[field].trim()) {
      return normalizeMuSig2SignerInput(record[field] as string);
    }
  }

  const electrumColdcard = keyExpressionFromElectrumColdcardJson(record);
  if (electrumColdcard) return electrumColdcard;

  if (typeof record.xpub !== 'string' || !record.xpub.trim()) return undefined;
  const fingerprint = normalizeJsonFingerprint(record.xfp ?? record.fingerprint ?? record.masterFingerprint);
  const path = normalizeJsonPath(record.path ?? record.derivationPath);
  if (!fingerprint || !path) return undefined;

  const originPath = path === 'm' ? '' : `/${path.slice(2)}`;
  return `[${fingerprint}${originPath}]${record.xpub.trim()}`;
}

/**
 * Normalizes the public Taproot signer forms used by the MuSig2 Vault UI:
 *
 *   [fingerprint/86h/0h/0h]xpub...
 *
 * or the descriptor line by itself:
 *
 *   tr([fingerprint/86h/0h/0h]xpub.../*)#checksum
 *
 * or a complete BSMS 1.0 export containing that descriptor line. Extra BSMS
 * path-restriction/address lines are ignored after the descriptor checksum is
 * verified.
 *
 * Compatible JSON wrappers are also accepted. They may contain a single-key
 * descriptor (`desc`/`descriptor`), a `keyExpression`, a `bsms` string, the
 * public tuple `{ xpub, xfp|fingerprint|masterFingerprint, path|derivationPath }`,
 * or an Electrum COLDCARD hardware keystore containing `ckcc_xfp`, `xpub`, and
 * `derivation`. Only public signer metadata is returned from this helper.
 */
export function normalizeMuSig2SignerInput(input: string): string {
  const trimmed = input.trim();
  const compact = trimmed.replace(/\s+/g, '');

  if (BARE_KEY_EXPRESSION.test(compact)) return compact;

  if (trimmed.startsWith('{')) {
    try {
      const fromJson = keyExpressionFromJson(JSON.parse(trimmed));
      if (fromJson) return fromJson;
    } catch {
      // Fall through to the normal descriptor/BSMS validation below so callers
      // receive the same invalid-signer error path as any other malformed input.
    }
  }

  const match = compact.match(TAPROOT_DESCRIPTOR);
  if (match) {
    const keyExpression = match[1];
    const suppliedChecksum = match[2].toLowerCase();
    const descriptor = `tr(${keyExpression}/*)`;
    const expectedChecksum = descriptorChecksum(descriptor);

    if (suppliedChecksum !== expectedChecksum) {
      throw new Error('Taproot BSMS descriptor checksum is invalid');
    }
    return keyExpression;
  }

  if (/^BSMS\s+1\.0(?:\s|$)/i.test(trimmed)) {
    throw new Error('BSMS 1.0 export must contain a single-key Taproot tr([fingerprint/path]xpub/*) descriptor');
  }

  // Preserve existing coordinator/testing support for bare compressed public
  // keys. The stricter MuSig2 Vault helper subsequently requires a BIP86 xpub.
  return trimmed;
}
