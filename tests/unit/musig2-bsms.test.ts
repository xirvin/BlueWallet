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

const PROVIDED_XPUB =
  'xpub6BfAYP9UKRSNBR1eRzzqoZRXNjxKDswmqTEnFGquHLagyfdxJ3v63eMkpyxu9ZuKbw6VLqRnwwQreqG1EP5n7cu9D4u4z9ffZym57ML3VHr';
const PROVIDED_KEY_EXPRESSION = `[32b14325/86'/0'/0']${PROVIDED_XPUB}`;
const PROVIDED_BSMS = `BSMS 1.0
tr(${PROVIDED_KEY_EXPRESSION}/*)#d69tpnqj
No path restrictions
bc1p4kxqrdy8zgz400ukce5vazr0d6qrunzeuacv3pxke3e9dznwcceqv3j4uh`;

const ELECTRUM_COLDCARD_JSON = JSON.stringify({
  seed_version: 17,
  use_encryption: false,
  wallet_type: 'standard',
  keystore: {
    type: 'hardware',
    hw_type: 'coldcard',
    label: 'Coldcard Import 52C4EAD8',
    ckcc_xfp: 3639264338,
    ckcc_xpub: 'xpub661MyMwAqRbcGXcajxEmY6QPji2UedMfx4wbm1Ah5n3m5UgyvC9xktPt676DFuoY76rKLGrwADGdUStUafkNsApxzWGU5Z6Mzvifr22M2dN',
    derivation: 'm/86h/0h/0h',
    xpub: NUNCHUK_XPUB,
  },
});

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

  it('accepts the provided complete BIP86 BSMS signer export', () => {
    assert.strictEqual(normalizeMuSig2SignerInput(PROVIDED_BSMS), PROVIDED_KEY_EXPRESSION);
    assert.strictEqual(normalizeMuSig2SignerInput(`${PROVIDED_BSMS}${PROVIDED_BSMS}`), PROVIDED_KEY_EXPRESSION);
  });

  it('accepts compatible public signer JSON using xpub, fingerprint and path', () => {
    const json = JSON.stringify({
      xpub: NUNCHUK_XPUB,
      xfp: '52c4ead8',
      path: "m/86'/0'/0'",
    });
    assert.strictEqual(normalizeMuSig2SignerInput(json), EXPECTED_KEY_EXPRESSION);
  });

  it('accepts an Electrum COLDCARD hardware keystore export', () => {
    const normalized = normalizeMuSig2SignerInput(ELECTRUM_COLDCARD_JSON);
    assert.strictEqual(normalized, EXPECTED_KEY_EXPRESSION);

    const parsed = parseMuSig2ParticipantKeyExpression(normalized);
    assert.strictEqual(parsed.masterFingerprint, '52c4ead8');
    assert.strictEqual(parsed.derivationPath, "m/86'/0'/0'");
    assert.strictEqual(parsed.xpub, NUNCHUK_XPUB);
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
