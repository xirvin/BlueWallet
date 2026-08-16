import assert from 'assert';
import { encodeQR } from 'qr';

import { splitQRs } from '../../blue_modules/bbqr/split';

describe('BBQr rendering', () => {
  it('encodes multipart BBQr frames in QR alphanumeric mode', () => {
    const payload = Uint8Array.from({ length: 1400 }, (_, index) => (index * 73 + index * index * 11) & 0xff);
    const { parts } = splitQRs(payload, 'P', {
      minVersion: 10,
      maxVersion: 10,
      minSplit: 2,
      encoding: '2',
    });

    assert.ok(parts.length >= 2);
    for (const part of parts) {
      assert.ok(part.startsWith('B$'));
      const matrix = encodeQR(part.toUpperCase(), 'raw', {
        ecc: 'low',
        border: 1,
        encoding: 'alphanumeric',
      });
      assert.ok(matrix.length > 0);
      assert.strictEqual(matrix.length, matrix[0].length);
    }
  });
});
