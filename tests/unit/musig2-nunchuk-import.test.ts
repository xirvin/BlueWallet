import assert from 'assert';

import { createMuSig2WalletBSMSRecord } from '../../blue_modules/musig2/bsms';
import {
  parseNunchukMuSig2Descriptor,
  parseNunchukMuSig2WalletInput,
} from '../../blue_modules/musig2/nunchuk';
import { validateMuSig2VaultSigners } from '../../blue_modules/musig2/vault';
import { descriptorWithChecksum } from '../../class/wallet-descriptor';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

const SIGNER_1 =
  "[32b14325/87'/0'/2']xpub6CV536smmJ4Nu15RWBJiF5oagPjfVMon4dAMdZA6di2BnbVVny8o9a7ENATNS3eX8bUTHXncBXe2SCQLDRXrY8eNq4wmbCVQEw4CNjMzWHm";
const SIGNER_2 =
  "[52c4ead8/87'/0'/2']xpub6DWaGeRp9hTVLL2ei2x3Gd6ywGVhi5wFvStKGjDLhrp5h4gbgCejZRpa3SghQhaAdohDXpsRHFReFTXAs2Q3WBXDpPCAVyZD5B7VQ8mJjD1";
const FIRST_ADDRESS = 'bc1pama7qhrgse8dsycaglnfwyfyv7kpjs552zwv5nfa4wy36qsasurskp4z3c';
const WRONG_FIRST_ADDRESS = 'bc1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp4d7z';

function makeNunchukWallet() {
  const wallet = new HDTaprootMuSig2Wallet();
  wallet.setParticipantKeyExpressions(validateMuSig2VaultSigners([SIGNER_1, SIGNER_2], 2));
  return wallet;
}

describe('Nunchuk MuSig2 wallet import', () => {
  it('imports a raw Nunchuk Value Keyset descriptor as a derived-participant wallet', () => {
    const source = makeNunchukWallet();
    const descriptor = source.getNunchukDescriptor('any');
    const imported = parseNunchukMuSig2Descriptor(descriptor);

    assert.ok(imported);
    assert.strictEqual(imported!.descriptor, descriptor);
    assert.strictEqual(imported!.descriptorSuffix, '/*');
    assert.strictEqual(imported!.wallet.getDerivationMode(), 'bip390-derived-participants');
    assert.strictEqual(imported!.wallet._getExternalAddressByIndex(0), FIRST_ADDRESS);
    assert.strictEqual(imported!.wallet.getNunchukDescriptor('any'), descriptor);
  });

  it('imports Nunchuk BSMS 1.0 and verifies receive address #0', () => {
    const source = makeNunchukWallet();
    const descriptor = source.getNunchukDescriptor('any');
    const bsms = createMuSig2WalletBSMSRecord(descriptor, source._getExternalAddressByIndex(0));
    const imported = parseNunchukMuSig2WalletInput(bsms);

    assert.ok(imported);
    assert.strictEqual(imported!.bsms, bsms);
    assert.strictEqual(imported!.firstAddress, FIRST_ADDRESS);
    assert.strictEqual(imported!.wallet._getExternalAddressByIndex(0), FIRST_ADDRESS);
    assert.deepStrictEqual(
      imported!.wallet.getParticipants().map(participant => participant.derivationPath),
      ["m/87'/0'/2'", "m/87'/0'/2'"],
    );
  });

  it('accepts Nunchuk external and BIP390 multipath descriptor suffixes', () => {
    const source = makeNunchukWallet();

    const external = parseNunchukMuSig2Descriptor(source.getNunchukDescriptor('external'));
    const multipath = parseNunchukMuSig2Descriptor(source.getBIP390Descriptor());

    assert.ok(external);
    assert.ok(multipath);
    assert.strictEqual(external!.descriptorSuffix, '/0/*');
    assert.strictEqual(multipath!.descriptorSuffix, '/<0;1>/*');
    assert.strictEqual(external!.wallet._getExternalAddressByIndex(0), FIRST_ADDRESS);
    assert.strictEqual(multipath!.wallet._getExternalAddressByIndex(0), FIRST_ADDRESS);
  });

  it('rejects BSMS whose verification address does not belong to the descriptor', () => {
    const source = makeNunchukWallet();
    const descriptor = source.getNunchukDescriptor('any');
    const bsms = createMuSig2WalletBSMSRecord(descriptor, source._getExternalAddressByIndex(0));
    const lines = bsms.split('\n');
    assert.strictEqual(lines.length, 4);
    assert.strictEqual(lines[3], FIRST_ADDRESS);

    // Replace the verification-address line directly instead of string-replacing
    // a cached fixture. This keeps the negative test effective if the valid
    // derivation vector is intentionally updated in the future.
    const wrong = [...lines.slice(0, 3), WRONG_FIRST_ADDRESS].join('\n');
    assert.notStrictEqual(wrong, bsms);

    assert.throws(() => parseNunchukMuSig2WalletInput(wrong), /first address does not match the descriptor/);
  });

  it('rejects an invalid Nunchuk descriptor checksum', () => {
    const descriptor = makeNunchukWallet().getNunchukDescriptor('any');
    const bad = `${descriptor.slice(0, -8)}00000000`;
    assert.throws(() => parseNunchukMuSig2WalletInput(bad), /checksum is invalid/);
  });

  it('rejects Value Keyset disabled script-path MuSig2 instead of changing its policy', () => {
    const scriptPathDescriptor = descriptorWithChecksum(
      `tr(${'11'.repeat(32)},pk(musig(${SIGNER_1}/*,${SIGNER_2}/*)))`,
    );
    assert.throws(
      () => parseNunchukMuSig2WalletInput(scriptPathDescriptor),
      /Value Keyset key-path wallets only/,
    );
  });

  it('leaves unrelated non-MuSig2 descriptors to the existing import pipeline', () => {
    const unrelated = descriptorWithChecksum(`tr(${SIGNER_1}/*)`);
    assert.strictEqual(parseNunchukMuSig2WalletInput(unrelated), undefined);
  });
});
