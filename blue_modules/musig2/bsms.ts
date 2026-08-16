import { descriptorChecksum } from '../../class/wallet-descriptor';

const XPUB_PATTERN = 'xpub[1-9A-HJ-NP-Za-km-z]+';
const ORIGIN_PATTERN = String.raw`\[[0-9a-fA-F]{8}(?:\/(?:0|[1-9][0-9]*)(?:['hH])?)*\]`;
const NUNCHUK_TAPROOT_DESCRIPTOR = new RegExp(
  String.raw`tr\((${ORIGIN_PATTERN}${XPUB_PATTERN})\/\*\)#([0-9a-z]{8})`,
  'i',
);

/**
 * Accepts either a normal BIP380 [fingerprint/path]xpub key expression or a
 * complete Nunchuk Mobile BSMS 1.0 single-key Taproot export. For BSMS, only
 * the public signer origin+xpub is returned. The address and path-restriction
 * lines are intentionally ignored.
 */
export function normalizeMuSig2SignerInput(input: string): string {
  const trimmed = input.trim();
  if (!/^BSMS\s+1\.0(?:\s|$)/i.test(trimmed)) return trimmed;

  const compact = trimmed.replace(/\s+/g, '');
  const match = compact.match(NUNCHUK_TAPROOT_DESCRIPTOR);
  if (!match) {
    throw new Error('Nunchuk BSMS 1.0 export must contain a single-key Taproot tr([fingerprint/path]xpub/*) descriptor');
  }

  const keyExpression = match[1];
  const suppliedChecksum = match[2].toLowerCase();
  const descriptor = `tr(${keyExpression}/*)`;
  const expectedChecksum = descriptorChecksum(descriptor);

  if (suppliedChecksum !== expectedChecksum) {
    throw new Error('Nunchuk BSMS 1.0 descriptor checksum is invalid');
  }

  return keyExpression;
}
