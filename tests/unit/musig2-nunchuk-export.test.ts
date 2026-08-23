import assert from 'assert';

import {
  MUSIG2_BSMS_PATH_RESTRICTIONS,
  MUSIG2_BSMS_VERSION,
  createMuSig2WalletBSMSRecord,
} from '../../blue_modules/musig2/bsms';

const DEMO_DESCRIPTOR =
  'tr(musig([52c4ead8/86h/0h/0h]xpub6CTWUpMsz6J8agBdjV6PqsCZfdrgtQj7nasH5D4APNRoiZc3xcFCYFAumrWLcuz9U4EagrhZgMqRW3tibSvt5ie5EwzguZ6NMQrVXpEFBz9,[32b14325/86h/0h/0h]xpub6BfAYP9UKRSNBR1eRzzqoZRXNjxKDswmqTEnFGquHLagyfdxJ3v63eMkpyxu9ZuKbw6VLqRnwwQreqG1EP5n7cu9D4u4z9ffZym57ML3VHr)/<0;1>/*)#eu6xsn9s';
const DEMO_FIRST_ADDRESS = 'bc1pqrkpachpag3632jhcf5453wglxcr5raakjms89w9xzvhmh9qp3zshysyau';

describe('MuSig2 Nunchuk wallet export', () => {
  it('builds the four-line BSMS 1.0 record used by Nunchuk wallet information backups', () => {
    const record = createMuSig2WalletBSMSRecord(DEMO_DESCRIPTOR, DEMO_FIRST_ADDRESS);
    const lines = record.split('\n');

    assert.strictEqual(lines.length, 4);
    assert.strictEqual(lines[0], MUSIG2_BSMS_VERSION);
    assert.strictEqual(lines[1], DEMO_DESCRIPTOR);
    assert.strictEqual(lines[2], MUSIG2_BSMS_PATH_RESTRICTIONS);
    assert.strictEqual(lines[3], DEMO_FIRST_ADDRESS);
    assert.strictEqual(
      record,
      `BSMS 1.0\n${DEMO_DESCRIPTOR}\nNo path restrictions\n${DEMO_FIRST_ADDRESS}`,
    );
  });

  it('does not rewrite the BlueWallet BIP390 descriptor while wrapping it in BSMS', () => {
    const record = createMuSig2WalletBSMSRecord(`  ${DEMO_DESCRIPTOR}\n`, ` ${DEMO_FIRST_ADDRESS} `);
    assert.strictEqual(record.split('\n')[1], DEMO_DESCRIPTOR);
  });

  it('rejects an invalid descriptor checksum instead of exporting an unverifiable backup', () => {
    assert.throws(
      () => createMuSig2WalletBSMSRecord(DEMO_DESCRIPTOR.replace('#eu6xsn9s', '#00000000'), DEMO_FIRST_ADDRESS),
      /checksum is invalid/,
    );
  });
});
