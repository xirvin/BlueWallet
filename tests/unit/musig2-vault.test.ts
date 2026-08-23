import assert from 'assert';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { normalizeMuSig2SignerInput } from '../../blue_modules/musig2/bsms';
import {
  MUSIG2_LEGACY_SIGNER_DERIVATION,
  MUSIG2_MAX_SIGNERS,
  MUSIG2_MIN_SIGNERS,
  MUSIG2_SIGNER_DERIVATION,
  assertMuSig2SignerCount,
  clampMuSig2SignerCount,
  createMuSig2TaprootSignerWallet,
  getMuSig2SignerDerivationPath,
  isMuSig2TaprootSignerMnemonic,
  normalizeMuSig2VaultSigner,
  parseMuSig2SignerDerivationPath,
  taprootWalletToMuSig2KeyExpression,
  validateMuSig2VaultSigners,
} from '../../blue_modules/musig2/vault';
import { uint8ArrayToHex } from '../../blue_modules/uint8array-extras';
import { descriptorWithChecksum } from '../../class/wallet-descriptor';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

const LEGACY_BSMS_SIGNER_1 =
  "[52c4ead8/86'/0'/0']xpub6CTWUpMsz6J8agBdjV6PqsCZfdrgtQj7nasH5D4APNRoiZc3xcFCYFAumrWLcuz9U4EagrhZgMqRW3tibSvt5ie5EwzguZ6NMQrVXpEFBz9";
const LEGACY_BSMS_SIGNER_2 =
  "[32b14325/86'/0'/0']xpub6BfAYP9UKRSNBR1eRzzqoZRXNjxKDswmqTEnFGquHLagyfdxJ3v63eMkpyxu9ZuKbw6VLqRnwwQreqG1EP5n7cu9D4u4z9ffZym57ML3VHr";
const LEGACY_BSMS_FIRST_ADDRESS = 'bc1pqrkpachpag3632jhcf5453wglxcr5raakjms89w9xzvhmh9qp3zshysyau';

const NUNCHUK_ACCOUNT_2_SIGNER_1 =
  "[32b14325/87'/0'/2']xpub6CV536smmJ4Nu15RWBJiF5oagPjfVMon4dAMdZA6di2BnbVVny8o9a7ENATNS3eX8bUTHXncBXe2SCQLDRXrY8eNq4wmbCVQEw4CNjMzWHm";
const NUNCHUK_ACCOUNT_2_SIGNER_2 =
  "[52c4ead8/87'/0'/2']xpub6DWaGeRp9hTVLL2ei2x3Gd6ywGVhi5wFvStKGjDLhrp5h4gbgCejZRpa3SghQhaAdohDXpsRHFReFTXAs2Q3WBXDpPCAVyZD5B7VQ8mJjD1";

function makeSignerExpression(index: number, accountIndex = 0): string {
  const root = bip32.fromSeed(new Uint8Array(32).fill(index + 1));
  const account = root.deriveHardened(87).deriveHardened(0).deriveHardened(accountIndex).neutered();
  return `[${uint8ArrayToHex(root.fingerprint)}/87'/0'/${accountIndex}']${account.toBase58()}`;
}

describe('MuSig2 Vault UX rules', () => {
  it('allows only locked N-of-N signer counts from 2 through 7', () => {
    for (let count = MUSIG2_MIN_SIGNERS; count <= MUSIG2_MAX_SIGNERS; count++) {
      assert.strictEqual(assertMuSig2SignerCount(count), count);
    }
    assert.throws(() => assertMuSig2SignerCount(1), /between 2 and 7 signers/);
    assert.throws(() => assertMuSig2SignerCount(8), /between 2 and 7 signers/);
    assert.strictEqual(clampMuSig2SignerCount(1), 2);
    assert.strictEqual(clampMuSig2SignerCount(9), 7);
  });

  it("uses Nunchuk's m/87'/0'/account' family and defaults new local signers to account 0", () => {
    assert.strictEqual(MUSIG2_SIGNER_DERIVATION, "m/87'/0'/0'");
    assert.strictEqual(getMuSig2SignerDerivationPath(2), "m/87'/0'/2'");
    assert.deepStrictEqual(parseMuSig2SignerDerivationPath("m/87h/0h/2h"), {
      path: "m/87'/0'/2'",
      accountIndex: 2,
      scheme: 'nunchuk-bip87',
    });
  });

  it('validates complete Nunchuk-style signer sets for every supported vault size', () => {
    const all = Array.from({ length: 7 }, (_, index) => makeSignerExpression(index));

    for (let count = 2; count <= 7; count++) {
      const expressions = validateMuSig2VaultSigners(all.slice(0, count), count);
      const wallet = new HDTaprootMuSig2Wallet();
      wallet.setParticipantKeyExpressions(expressions);

      assert.strictEqual(wallet.getSignerCount(), count);
      assert.strictEqual(wallet.hasCompleteExtendedParticipantMetadata(), true);
      assert.strictEqual(wallet.getParticipants().every(participant => participant.derivationPath === MUSIG2_SIGNER_DERIVATION), true);
      assert.ok(wallet.getBIP390Descriptor().startsWith('tr(musig('));
    }
  });

  it('accepts the real Nunchuk account-2 signer origin convention', () => {
    const expressions = validateMuSig2VaultSigners([NUNCHUK_ACCOUNT_2_SIGNER_1, NUNCHUK_ACCOUNT_2_SIGNER_2], 2);
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setParticipantKeyExpressions(expressions);

    assert.strictEqual(wallet.getParticipants().every(participant => participant.derivationPath === "m/87'/0'/2'"), true);
    assert.ok(wallet.getBIP390Descriptor().includes('/87h/0h/2h]'));
  });

  it('keeps existing BlueWallet BIP86 vaults recoverable without changing their addresses', () => {
    const expressions = validateMuSig2VaultSigners([LEGACY_BSMS_SIGNER_1, LEGACY_BSMS_SIGNER_2], 2);
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setParticipantKeyExpressions(expressions);

    assert.strictEqual(wallet._getExternalAddressByIndex(0), LEGACY_BSMS_FIRST_ADDRESS);
    assert.strictEqual(wallet.getParticipants().every(participant => participant.derivationPath === MUSIG2_LEGACY_SIGNER_DERIVATION), true);
  });

  it('rejects mixed MuSig2 account origins in one vault', () => {
    const account0 = makeSignerExpression(0, 0);
    const account2 = makeSignerExpression(1, 2);
    assert.throws(() => validateMuSig2VaultSigners([account0, account2], 2), /same m\/87'\/0'\/account' origin/);
  });

  it('includes every Nunchuk-style signer account xpub and path in a 7-of-7 signing PSBT', () => {
    const expressions = Array.from({ length: 7 }, (_, index) => makeSignerExpression(index));
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setParticipantKeyExpressions(expressions);

    const fundingAddress = wallet._getExternalAddressByIndex(0);
    const targetAddress = wallet._getExternalAddressByIndex(1);
    const changeAddress = wallet._getInternalAddressByIndex(0);
    const result = wallet.createTransaction(
      [{ txid: '22'.repeat(32), vout: 0, value: 100_000, address: fundingAddress }],
      [{ address: targetAddress, value: 25_000 }],
      1,
      changeAddress,
    );

    assert.strictEqual(result.psbt.data.globalMap.globalXpub?.length, 7);
    assert.strictEqual(result.psbt.data.globalMap.globalXpub?.every(item => item.path === MUSIG2_SIGNER_DERIVATION), true);
    const roundTrip = bitcoin.Psbt.fromBase64(result.psbt.toBase64());
    assert.strictEqual(roundTrip.data.globalMap.globalXpub?.length, 7);
    assert.strictEqual(roundTrip.data.globalMap.globalXpub?.every(item => item.path === MUSIG2_SIGNER_DERIVATION), true);
    assert.deepStrictEqual(
      new Set(roundTrip.data.globalMap.globalXpub?.map(item => uint8ArrayToHex(item.masterFingerprint))).size,
      7,
    );
  });

  it('accepts a bare key, descriptor-only BSMS form, or complete BSMS 1.0 form', () => {
    const expression = makeSignerExpression(0);
    const descriptor = descriptorWithChecksum(`tr(${expression}/*)`);
    const complete = `BSMS 1.0\n${descriptor}\nNo path restrictions\nbc1ptestaddress`;

    assert.strictEqual(normalizeMuSig2SignerInput(expression), expression);
    assert.strictEqual(normalizeMuSig2SignerInput(descriptor), expression);
    assert.strictEqual(normalizeMuSig2SignerInput(complete), expression);
    assert.strictEqual(normalizeMuSig2VaultSigner(complete).keyExpression, expression);
  });

  it('requires a supported MuSig2 account origin and distinct signer keys', () => {
    const expression = makeSignerExpression(0);
    const wrongPath = expression.replace("/87'/0'/0']", "/84'/0'/0']");

    assert.throws(() => normalizeMuSig2VaultSigner(wrongPath), /m\/87'\/0'\/account'/);
    assert.throws(() => validateMuSig2VaultSigners([expression, expression], 2), /must all be distinct/);
  });

  it('imports a BIP39 seed as a local Nunchuk-style MuSig2 signer wallet', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    assert.strictEqual(isMuSig2TaprootSignerMnemonic(mnemonic), true);
    assert.strictEqual(isMuSig2TaprootSignerMnemonic('not a valid seed phrase'), false);

    const signer = createMuSig2TaprootSignerWallet(mnemonic);
    assert.strictEqual(signer.type, HDTaprootWallet.type);
    assert.strictEqual(signer.getDerivationPath(), MUSIG2_SIGNER_DERIVATION);
    assert.ok(signer._getExternalAddressByIndex(0).startsWith('bc1p'));

    const expression = taprootWalletToMuSig2KeyExpression(signer);
    assert.ok(expression.includes("/87'/0'/0']"));
    assert.strictEqual(normalizeMuSig2VaultSigner(expression).participant.xpub, signer.getXpub());
  });

  it('can derive and restore a Nunchuk account-2 signer from seed words', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const account0 = createMuSig2TaprootSignerWallet(mnemonic);
    const account2 = createMuSig2TaprootSignerWallet(mnemonic, '', getMuSig2SignerDerivationPath(2));

    assert.strictEqual(account2.getDerivationPath(), "m/87'/0'/2'");
    assert.notStrictEqual(account2.getXpub(), account0.getXpub());
    assert.ok(taprootWalletToMuSig2KeyExpression(account2).includes("/87'/0'/2']"));
  });

  it('continues to recognize an existing local BIP86 signer wallet', () => {
    const signer = new HDTaprootWallet();
    signer.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    assert.strictEqual(signer.getDerivationPath(), MUSIG2_LEGACY_SIGNER_DERIVATION);
    const expression = taprootWalletToMuSig2KeyExpression(signer);
    assert.ok(expression.includes("/86'/0'/0']"));
    assert.strictEqual(normalizeMuSig2VaultSigner(expression).participant.derivationPath, MUSIG2_LEGACY_SIGNER_DERIVATION);
  });

  it('includes a BIP39 passphrase in the local signer identity', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const plain = createMuSig2TaprootSignerWallet(mnemonic);
    const protectedSigner = createMuSig2TaprootSignerWallet(mnemonic, 'MuSig2 test passphrase');

    assert.notStrictEqual(protectedSigner.getXpub(), plain.getXpub());
    assert.notStrictEqual(protectedSigner._getExternalAddressByIndex(0), plain._getExternalAddressByIndex(0));
    assert.notStrictEqual(taprootWalletToMuSig2KeyExpression(protectedSigner), taprootWalletToMuSig2KeyExpression(plain));
  });
});
