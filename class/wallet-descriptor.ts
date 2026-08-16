const DESCRIPTOR_INPUT_CHARSET =
  `0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH\`#"\\ `;
const DESCRIPTOR_CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function descriptorPolyMod(checksum: bigint, value: number): bigint {
  const top = checksum >> 35n;
  let result = ((checksum & 0x7ffffffffn) << 5n) ^ BigInt(value);
  if (top & 1n) result ^= 0xf5dee51989n;
  if (top & 2n) result ^= 0xa9fdca3312n;
  if (top & 4n) result ^= 0x1bab10e32dn;
  if (top & 8n) result ^= 0x3706b1677an;
  if (top & 16n) result ^= 0x644d626ffdn;
  return result;
}

/** BIP380 descriptor checksum, without the leading '#'. */
export function descriptorChecksum(descriptor: string): string {
  if (descriptor.includes('#')) throw new Error('Descriptor checksum input must not already contain a checksum');

  let checksum = 1n;
  let cls = 0;
  let clsCount = 0;

  for (const char of descriptor) {
    const position = DESCRIPTOR_INPUT_CHARSET.indexOf(char);
    if (position === -1) throw new Error(`Unsupported descriptor character: ${char}`);

    checksum = descriptorPolyMod(checksum, position & 31);
    cls = cls * 3 + (position >> 5);
    clsCount++;

    if (clsCount === 3) {
      checksum = descriptorPolyMod(checksum, cls);
      cls = 0;
      clsCount = 0;
    }
  }

  if (clsCount > 0) checksum = descriptorPolyMod(checksum, cls);
  for (let i = 0; i < 8; i++) checksum = descriptorPolyMod(checksum, 0);
  checksum ^= 1n;

  let result = '';
  for (let i = 0; i < 8; i++) {
    result += DESCRIPTOR_CHECKSUM_CHARSET[Number((checksum >> BigInt(5 * (7 - i))) & 31n)];
  }
  return result;
}

export function descriptorWithChecksum(descriptor: string): string {
  return `${descriptor}#${descriptorChecksum(descriptor)}`;
}

export class WalletDescriptor {
  static getDescriptor(fpHex: string, path: string, xpub: string): string {
    switch (true) {
      case path.startsWith("m/86'"):
        return `tr([${fpHex.toLowerCase()}/${path.replace('m/', '')}]${xpub})`;
      default:
        throw new Error('Dont know how to make a descriptor');
    }
  }

  static withChecksum(descriptor: string): string {
    return descriptorWithChecksum(descriptor);
  }
}
