import assert from 'assert';

import { joinQRs } from '../../blue_modules/bbqr/join';
import { splitQRs } from '../../blue_modules/bbqr/split';
import { stringToUint8Array, uint8ArrayToString } from '../../blue_modules/uint8array-extras';

const DEMO_DESCRIPTOR =
  'tr(musig([52c4ead8/86h/0h/0h]xpub6CTWUpMsz6J8agBdjV6PqsCZfdrgtQj7nasH5D4APNRoiZc3xcFCYFAumrWLcuz9U4EagrhZgMqRW3tibSvt5ie5EwzguZ6NMQrVXpEFBz9,[32b14325/86h/0h/0h]xpub6BfAYP9UKRSNBR1eRzzqoZRXNjxKDswmqTEnFGquHLagyfdxJ3v63eMkpyxu9ZuKbw6VLqRnwwQreqG1EP5n7cu9D4u4z9ffZym57ML3VHr)/<0;1>/*)#eu6xsn9s';

function roundTripDescriptor(descriptor: string): { fileType: string; decoded: string; partCount: number } {
  const { parts } = splitQRs(stringToUint8Array(descriptor), 'U', {
    minVersion: 1,
    maxVersion: 20,
  });
  const joined = joinQRs(parts);
  return {
    fileType: joined.fileType,
    decoded: uint8ArrayToString(joined.raw),
    partCount: parts.length,
  };
}

describe('MuSig2 Nunchuk BBQr descriptor export', () => {
  it('round-trips the exact demo BIP390 descriptor as BBQr Unicode text', () => {
    const result = roundTripDescriptor(DEMO_DESCRIPTOR);

    assert.strictEqual(result.fileType, 'U');
    assert.strictEqual(result.decoded, DEMO_DESCRIPTOR);
    assert.ok(result.partCount >= 1);
  });

  it('round-trips a seven-signer-sized descriptor payload without truncation', () => {
    const signerTemplate = '[12345678/86h/0h/0h]xpub6ExampleMuSig2SignerPayloadForBBQrTransportRegression';
    const longDescriptor = `tr(musig(${Array.from({ length: 7 }, (_, index) => `${signerTemplate}${index}`).join(',')})/<0;1>/*)#12345678`;
    const result = roundTripDescriptor(longDescriptor);

    assert.strictEqual(result.fileType, 'U');
    assert.strictEqual(result.decoded, longDescriptor);
    assert.ok(result.partCount >= 1);
  });
});
