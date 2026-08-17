import assert from 'assert';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { normalizeMuSig2SignerInput } from '../../blue_modules/musig2/bsms';
import {
  MUSIG2_MAX_SIGNERS,
  MUSIG2_MIN_SIGNERS,
  MUSIG2_SIGNER_DERIVATION,
  assertMuSig2SignerCount,
  clampMuSig2SignerCount,
  normalizeMuSig2VaultSigner,
  taprootWalletToMuSig2KeyExpression,
  validateMuSig2VaultSigners,
} from '../../blue_modules/musig2/vault';
import { uint8ArrayToHex } from '../../blue_modules/uint8array-extras';
import { descriptorWithChecksum } from '../../class/wallet-descriptor';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

function makeSignerExpression(index: number): string {
  const root = bip32.fromSeed(new Uint8Array(32).fill(index + 1));
  const account = root.deriveHardened(86).deriveHardened(0).deriveHardened(0).neutered();
  return `[${uint8ArrayToHex(root.fingerprint)}/86'/0'/0']${account.toBase58()}`;
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

  it('validates complete BIP86 signer sets for every supported vault size', () => {
    const all = Array.from({ length: 7 }, (_, index) => makeSignerExpression(index));

    for (let count = 2; count <= 7; count++) {
      const expressions = validateMuSig2VaultSigners(all.slice(0, count), count);
      const wallet = new HDTaprootMuSig2Wallet();
      wallet.setParticipantKeyExpressions(expressions);

      assert.strictEqual(wallet.getSignerCount(), count);
      assert.strictEqual(wallet.hasCompleteExtendedParticipantMetadata(), true);
      assert.ok(wallet.getBIP390Descriptor().startsWith('tr(musig('));
    }
  });

  it('includes every signer account xpub in a 7-of-7 signing PSBT', () => {
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
    const roundTrip = bitcoin.Psbt.fromBase64(result.psbt.toBase64());
    assert.strictEqual(roundTrip.data.globalMap.globalXpub?.length, 7);
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

  it('requires the standard BIP86 account origin and distinct signer keys', () => {
    const expression = makeSignerExpression(0);
    const wrongPath = expression.replace("/86'/0'/0']", "/84'/0'/0']");

    assert.throws(() => normalizeMuSig2VaultSigner(wrongPath), /standard BIP86 path/);
    assert.throws(() => validateMuSig2VaultSigners([expression, expression], 2), /must all be distinct/);
  });

  it('turns a normal BlueWallet Taproot wallet into the expected MuSig2 signer expression', () => {
    const signer = new HDTaprootWallet();
    signer.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    assert.strictEqual(signer.getDerivationPath(), MUSIG2_SIGNER_DERIVATION);
    assert.ok(signer._getExternalAddressByIndex(0).startsWith('bc1p'));

    const expression = taprootWalletToMuSig2KeyExpression(signer);
    const normalized = normalizeMuSig2VaultSigner(expression);
    assert.strictEqual(normalized.participant.derivationPath, MUSIG2_SIGNER_DERIVATION);
    assert.strictEqual(normalized.participant.xpub, signer.getXpub());
  });
});
