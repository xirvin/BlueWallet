import assert from 'assert';

import { normalizeMuSig2SignerInput } from '../../blue_modules/musig2/bsms';
import { parseMuSig2ParticipantKeyExpression } from '../../class/wallets/hd-taproot-musig2-wallet';

const NUNCHUK_XPUB =
  'xpub6CTWUpMsz6J8agBdjV6PqsCZfdrgtQj7nasH5D4APNRoiZc3xcFCYFAumrWLcuz9U4EagrhZgMqRW3tibSvt5ie5EwzguZ6NMQrVXpEFBz9';
const EXPECTED_KEY_EXPRESSION = `[52c4ead8/86'/0'/0']${NUNCHUK_XPUB}`;
const NUNCHUK_BSMS = `BSMS 1.0
tr(${EXPECTED_KEY_EXPRESSION}/*)#60gtkx8s
No path restrictions
bc1pp2hgkzf0hw7wug5e8vhwr828wg6ynqxwyz5d9rjc2ze8d99su2qq8dty34`;

describe('MuSig2 Nunchuk BSMS import', () => {
  it('extracts a signer key expression from the complete Nunchuk Mobile BSMS export', () => {
    assert.strictEqual(normalizeMuSig2SignerInput(NUNCHUK_BSMS), EXPECTED_KEY_EXPRESSION);

    const parsed = parseMuSig2ParticipantKeyExpression(normalizeMuSig2SignerInput(NUNCHUK_BSMS));
    assert.strictEqual(parsed.masterFingerprint, '52c4ead8');
    assert.strictEqual(parsed.derivationPath, "m/86'/0'/0'");
    assert.strictEqual(parsed.xpub, NUNCHUK_XPUB);
  });

  it('accepts the same BSMS export when clipboard formatting collapses it to one line', () => {
    const flattened = NUNCHUK_BSMS.replace(/\s+/g, ' ');
    assert.strictEqual(normalizeMuSig2SignerInput(flattened), EXPECTED_KEY_EXPRESSION);
  });

  it('accepts a repeated BSMS export pasted into the universal signer field', () => {
    const repeated = `${NUNCHUK_BSMS}${NUNCHUK_BSMS}`;
    assert.strictEqual(normalizeMuSig2SignerInput(repeated), EXPECTED_KEY_EXPRESSION);
  });

  it('accepts compatible public signer JSON using xpub, fingerprint and path', () => {
    const json = JSON.stringify({
      xpub: NUNCHUK_XPUB,
      xfp: '52c4ead8',
      path: "m/86'/0'/0'",
    });
    assert.strictEqual(normalizeMuSig2SignerInput(json), EXPECTED_KEY_EXPRESSION);
  });

  it('accepts a JSON wrapper around the single-key Taproot descriptor', () => {
    const descriptor = NUNCHUK_BSMS.split('\n')[1];
    assert.strictEqual(normalizeMuSig2SignerInput(JSON.stringify({ name: 'Signer 1', desc: descriptor })), EXPECTED_KEY_EXPRESSION);
  });

  it('rejects a Nunchuk BSMS descriptor with a bad checksum', () => {
    assert.throws(
      () => normalizeMuSig2SignerInput(NUNCHUK_BSMS.replace('#60gtkx8s', '#00000000')),
      /checksum is invalid/,
    );
  });

  it('leaves an ordinary hardware key expression unchanged', () => {
    assert.strictEqual(normalizeMuSig2SignerInput(EXPECTED_KEY_EXPRESSION), EXPECTED_KEY_EXPRESSION);
  });
});
