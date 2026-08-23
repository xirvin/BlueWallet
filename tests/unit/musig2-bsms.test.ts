import assert from 'assert';

import { normalizeMuSig2SignerInput } from '../../blue_modules/musig2/bsms';
import { normalizeMuSig2VaultSigner } from '../../blue_modules/musig2/vault';
import { descriptorWithChecksum } from '../../class/wallet-descriptor';
import { parseMuSig2ParticipantKeyExpression } from '../../class/wallets/hd-taproot-musig2-wallet';

const LEGACY_XPUB =
  'xpub6CTWUpMsz6J8agBdjV6PqsCZfdrgtQj7nasH5D4APNRoiZc3xcFCYFAumrWLcuz9U4EagrhZgMqRW3tibSvt5ie5EwzguZ6NMQrVXpEFBz9';
const LEGACY_KEY_EXPRESSION = `[52c4ead8/86'/0'/0']${LEGACY_XPUB}`;
const LEGACY_BSMS = `BSMS 1.0
tr(${LEGACY_KEY_EXPRESSION}/*)#60gtkx8s
No path restrictions
bc1pp2hgkzf0hw7wug5e8vhwr828wg6ynqxwyz5d9rjc2ze8d99su2qq8dty34`;

const PROVIDED_XPUB =
  'xpub6BfAYP9UKRSNBR1eRzzqoZRXNjxKDswmqTEnFGquHLagyfdxJ3v63eMkpyxu9ZuKbw6VLqRnwwQreqG1EP5n7cu9D4u4z9ffZym57ML3VHr';
const PROVIDED_KEY_EXPRESSION = `[32b14325/86'/0'/0']${PROVIDED_XPUB}`;
const PROVIDED_BSMS = `BSMS 1.0
tr(${PROVIDED_KEY_EXPRESSION}/*)#d69tpnqj
No path restrictions
bc1p4kxqrdy8zgz400ukce5vazr0d6qrunzeuacv3pxke3e9dznwcceqv3j4uh`;

const NUNCHUK_ACCOUNT_2_XPUB =
  'xpub6CV536smmJ4Nu15RWBJiF5oagPjfVMon4dAMdZA6di2BnbVVny8o9a7ENATNS3eX8bUTHXncBXe2SCQLDRXrY8eNq4wmbCVQEw4CNjMzWHm';
const NUNCHUK_ACCOUNT_2_KEY_EXPRESSION = `[32b14325/87'/0'/2']${NUNCHUK_ACCOUNT_2_XPUB}`;
const NUNCHUK_ACCOUNT_2_DESCRIPTOR = descriptorWithChecksum(`tr(${NUNCHUK_ACCOUNT_2_KEY_EXPRESSION}/*)`);
const NUNCHUK_ACCOUNT_2_BSMS = `BSMS 1.0
${NUNCHUK_ACCOUNT_2_DESCRIPTOR}
No path restrictions
bc1ptestaddress`;

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
    xpub: LEGACY_XPUB,
  },
});

describe('MuSig2 signer BSMS import', () => {
  it("extracts a Nunchuk m/87'/0'/2' signer account from BSMS", () => {
    assert.strictEqual(normalizeMuSig2SignerInput(NUNCHUK_ACCOUNT_2_BSMS), NUNCHUK_ACCOUNT_2_KEY_EXPRESSION);

    const normalized = normalizeMuSig2VaultSigner(NUNCHUK_ACCOUNT_2_BSMS);
    assert.strictEqual(normalized.participant.masterFingerprint, '32b14325');
    assert.strictEqual(normalized.participant.derivationPath, "m/87'/0'/2'");
    assert.strictEqual(normalized.participant.xpub, NUNCHUK_ACCOUNT_2_XPUB);
  });

  it('keeps legacy BlueWallet BIP86 signer BSMS exports importable', () => {
    assert.strictEqual(normalizeMuSig2SignerInput(LEGACY_BSMS), LEGACY_KEY_EXPRESSION);

    const parsed = parseMuSig2ParticipantKeyExpression(normalizeMuSig2SignerInput(LEGACY_BSMS));
    assert.strictEqual(parsed.masterFingerprint, '52c4ead8');
    assert.strictEqual(parsed.derivationPath, "m/86'/0'/0'");
    assert.strictEqual(parsed.xpub, LEGACY_XPUB);
  });

  it('accepts the same legacy BSMS export when clipboard formatting collapses it to one line', () => {
    const flattened = LEGACY_BSMS.replace(/\s+/g, ' ');
    assert.strictEqual(normalizeMuSig2SignerInput(flattened), LEGACY_KEY_EXPRESSION);
  });

  it('accepts a repeated legacy BSMS export pasted into the universal signer field', () => {
    const repeated = `${LEGACY_BSMS}${LEGACY_BSMS}`;
    assert.strictEqual(normalizeMuSig2SignerInput(repeated), LEGACY_KEY_EXPRESSION);
  });

  it('accepts the provided complete BIP86 BSMS signer export for backwards compatibility', () => {
    assert.strictEqual(normalizeMuSig2SignerInput(PROVIDED_BSMS), PROVIDED_KEY_EXPRESSION);
    assert.strictEqual(normalizeMuSig2SignerInput(`${PROVIDED_BSMS}${PROVIDED_BSMS}`), PROVIDED_KEY_EXPRESSION);
  });

  it('accepts compatible public signer JSON using a Nunchuk BIP87 account path', () => {
    const json = JSON.stringify({
      xpub: NUNCHUK_ACCOUNT_2_XPUB,
      xfp: '32b14325',
      path: "m/87'/0'/2'",
    });
    assert.strictEqual(normalizeMuSig2SignerInput(json), NUNCHUK_ACCOUNT_2_KEY_EXPRESSION);
    assert.strictEqual(normalizeMuSig2VaultSigner(json).participant.derivationPath, "m/87'/0'/2'");
  });

  it('accepts a legacy Electrum COLDCARD hardware keystore export', () => {
    const normalized = normalizeMuSig2SignerInput(ELECTRUM_COLDCARD_JSON);
    assert.strictEqual(normalized, LEGACY_KEY_EXPRESSION);

    const parsed = parseMuSig2ParticipantKeyExpression(normalized);
    assert.strictEqual(parsed.masterFingerprint, '52c4ead8');
    assert.strictEqual(parsed.derivationPath, "m/86'/0'/0'");
    assert.strictEqual(parsed.xpub, LEGACY_XPUB);
  });

  it('accepts a JSON wrapper around a Nunchuk-path single-key Taproot descriptor', () => {
    assert.strictEqual(
      normalizeMuSig2SignerInput(JSON.stringify({ name: 'Signer 1', desc: NUNCHUK_ACCOUNT_2_DESCRIPTOR })),
      NUNCHUK_ACCOUNT_2_KEY_EXPRESSION,
    );
  });

  it('rejects a BSMS descriptor with a bad checksum', () => {
    assert.throws(
      () => normalizeMuSig2SignerInput(LEGACY_BSMS.replace('#60gtkx8s', '#00000000')),
      /checksum is invalid/,
    );
  });

  it('leaves an ordinary Nunchuk hardware key expression unchanged', () => {
    assert.strictEqual(normalizeMuSig2SignerInput(NUNCHUK_ACCOUNT_2_KEY_EXPRESSION), NUNCHUK_ACCOUNT_2_KEY_EXPRESSION);
  });
});
