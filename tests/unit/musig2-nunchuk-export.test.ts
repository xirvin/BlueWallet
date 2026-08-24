import assert from 'assert';

import {
  MUSIG2_BSMS_PATH_RESTRICTIONS,
  MUSIG2_BSMS_VERSION,
  createMuSig2WalletBSMSRecord,
} from '../../blue_modules/musig2/bsms';
import { validateMuSig2VaultSigners } from '../../blue_modules/musig2/vault';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

const NUNCHUK_ACCOUNT_2_SIGNER_1 =
  "[32b14325/87'/0'/2']xpub6CV536smmJ4Nu15RWBJiF5oagPjfVMon4dAMdZA6di2BnbVVny8o9a7ENATNS3eX8bUTHXncBXe2SCQLDRXrY8eNq4wmbCVQEw4CNjMzWHm";
const NUNCHUK_ACCOUNT_2_SIGNER_2 =
  "[52c4ead8/87'/0'/2']xpub6DWaGeRp9hTVLL2ei2x3Gd6ywGVhi5wFvStKGjDLhrp5h4gbgCejZRpa3SghQhaAdohDXpsRHFReFTXAs2Q3WBXDpPCAVyZD5B7VQ8mJjD1";

function createAccount2Vault(): HDTaprootMuSig2Wallet {
  const wallet = new HDTaprootMuSig2Wallet();
  wallet.setParticipantKeyExpressions(
    validateMuSig2VaultSigners([NUNCHUK_ACCOUNT_2_SIGNER_1, NUNCHUK_ACCOUNT_2_SIGNER_2], 2),
  );
  return wallet;
}

describe('MuSig2 Nunchuk wallet export', () => {
  it("builds a four-line BSMS 1.0 record preserving each signer's m/87'/0'/2' origin", () => {
    const wallet = createAccount2Vault();
    const descriptor = wallet.getBIP390Descriptor();
    const firstAddress = wallet._getExternalAddressByIndex(0);
    const record = createMuSig2WalletBSMSRecord(descriptor, firstAddress);
    const lines = record.split('\n');

    assert.strictEqual(lines.length, 4);
    assert.strictEqual(lines[0], MUSIG2_BSMS_VERSION);
    assert.strictEqual(lines[1], descriptor);
    assert.strictEqual(lines[2], MUSIG2_BSMS_PATH_RESTRICTIONS);
    assert.strictEqual(lines[3], firstAddress);
    assert.strictEqual(wallet.getParticipants().every(participant => participant.derivationPath === "m/87'/0'/2'"), true);
    assert.ok(descriptor.includes('/87h/0h/2h]'));
    assert.ok(descriptor.includes(NUNCHUK_ACCOUNT_2_SIGNER_1.split(']')[1]));
    assert.ok(descriptor.includes(NUNCHUK_ACCOUNT_2_SIGNER_2.split(']')[1]));
  });

  it('does not rewrite the BlueWallet BIP390 descriptor while wrapping it in BSMS', () => {
    const wallet = createAccount2Vault();
    const descriptor = wallet.getBIP390Descriptor();
    const firstAddress = wallet._getExternalAddressByIndex(0);
    const record = createMuSig2WalletBSMSRecord(`  ${descriptor}\n`, ` ${firstAddress} `);
    assert.strictEqual(record.split('\n')[1], descriptor);
  });

  it('rejects an invalid descriptor checksum instead of exporting an unverifiable backup', () => {
    const wallet = createAccount2Vault();
    const descriptor = wallet.getBIP390Descriptor();
    const firstAddress = wallet._getExternalAddressByIndex(0);
    const badDescriptor = `${descriptor.slice(0, -8)}00000000`;
    assert.throws(() => createMuSig2WalletBSMSRecord(badDescriptor, firstAddress), /checksum is invalid/);
  });
});
