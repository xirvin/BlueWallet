import { descriptorChecksum } from '../../class/wallet-descriptor';

const XPUB_PATTERN = 'xpub[1-9A-HJ-NP-Za-km-z]+';
const ORIGIN_PATTERN = String.raw`\[[0-9a-fA-F]{8}(?:\/(?:0|[1-9][0-9]*)(?:['hH])?)*\]`;
const TAPROOT_DESCRIPTOR = new RegExp(
  String.raw`tr\((${ORIGIN_PATTERN}${XPUB_PATTERN})\/\*\)#([0-9a-z]{8})`,
  'i',
);
const BARE_KEY_EXPRESSION = new RegExp(String.raw`^${ORIGIN_PATTERN}${XPUB_PATTERN}$`, 'i');

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
 * verified. Only public signer metadata is returned.
 */
export function normalizeMuSig2SignerInput(input: string): string {
  const trimmed = input.trim();
  const compact = trimmed.replace(/\s+/g, '');

  if (BARE_KEY_EXPRESSION.test(compact)) return compact;

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
