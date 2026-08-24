import assert from 'assert';

import { PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS } from '../../blue_modules/musig2/psbt';
import { uint8ArrayToHex } from '../../blue_modules/uint8array-extras';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

const SIGNER_1 =
  "[32b14325/87'/0'/2']xpub6CV536smmJ4Nu15RWBJiF5oagPjfVMon4dAMdZA6di2BnbVVny8o9a7ENATNS3eX8bUTHXncBXe2SCQLDRXrY8eNq4wmbCVQEw4CNjMzWHm";
const SIGNER_2 =
  "[52c4ead8/87'/0'/2']xpub6DWaGeRp9hTVLL2ei2x3Gd6ywGVhi5wFvStKGjDLhrp5h4gbgCejZRpa3SghQhaAdohDXpsRHFReFTXAs2Q3WBXDpPCAVyZD5B7VQ8mJjD1";

function createNunchukWallet(): HDTaprootMuSig2Wallet {
  const wallet = new HDTaprootMuSig2Wallet();
  wallet.setParticipantKeyExpressions([SIGNER_1, SIGNER_2]);
  return wallet;
}

function createColdcardWallet(): HDTaprootMuSig2Wallet {
  const wallet = createNunchukWallet();
  wallet.setDerivationMode('legacy-bip328');
  return wallet;
}

describe('MuSig2 compatibility modes', () => {
  it('keeps Nunchuk participant-first BIP390 as the default for fresh BIP87 vaults', () => {
    const wallet = createNunchukWallet();
    const descriptor = wallet.getBIP390Descriptor(false);

    assert.strictEqual(wallet.getDerivationMode(), 'bip390-derived-participants');
    assert.ok(descriptor.includes(`${SIGNER_1}/<0;1>/*`));
    assert.ok(descriptor.includes(`${SIGNER_2}/<0;1>/*`));
    assert.ok(!descriptor.includes(')/<0;1>/*)'));
    assert.strictEqual(wallet._getExternalAddressByIndex(0), 'bc1pama7qhrgse8dsycaglnfwyfyv7kpjs552zwv5nfa4wy36qsasurskp4z3c');
  });

  it('supports an explicit COLDCARD aggregate-first BIP328 vault using the same BIP87 signer accounts', () => {
    const nunchuk = createNunchukWallet();
    const coldcard = createColdcardWallet();
    const descriptor = coldcard.getBIP390Descriptor(false);

    assert.strictEqual(coldcard.getDerivationMode(), 'legacy-bip328');
    assert.ok(descriptor.startsWith('tr(musig('));
    assert.ok(descriptor.includes(SIGNER_1));
    assert.ok(descriptor.includes(SIGNER_2));
    assert.ok(descriptor.endsWith(')/<0;1>/*)'));
    assert.ok(!descriptor.includes(`${SIGNER_1}/<0;1>/*`));
    assert.ok(!descriptor.includes(`${SIGNER_2}/<0;1>/*`));

    const nunchukAddress = nunchuk._getExternalAddressByIndex(0);
    const coldcardAddress = coldcard._getExternalAddressByIndex(0);
    assert.notStrictEqual(coldcardAddress, nunchukAddress);

    const accountParticipantKeys = coldcard.getParticipants().map(participant => participant.publicKeyHex);
    assert.deepStrictEqual(
      coldcard.getAddressParticipantPublicKeys(0, 0).map(uint8ArrayToHex),
      accountParticipantKeys,
    );

    const restored = HDTaprootMuSig2Wallet.fromJson(JSON.stringify(coldcard));
    assert.strictEqual(restored.getDerivationMode(), 'legacy-bip328');
    assert.strictEqual(restored._getExternalAddressByIndex(0), coldcardAddress);
    assert.strictEqual(restored.getBIP390Descriptor(), coldcard.getBIP390Descriptor());
  });

  it('builds the COLDCARD BIP373 PSBT with account participants plus the synthetic aggregate derivation', () => {
    const wallet = createColdcardWallet();
    const receiveAddress = wallet._getExternalAddressByIndex(0);
    const changeAddress = wallet._getInternalAddressByIndex(0);
    const externalTarget = createNunchukWallet()._getExternalAddressByIndex(0);

    const result = wallet.createTransaction(
      [
        {
          txid: '77'.repeat(32),
          vout: 0,
          value: 100000,
          address: receiveAddress,
        },
      ],
      [{ address: externalTarget, value: 25000 }],
      1,
      changeAddress,
    );

    const input = result.psbt.data.inputs[0];
    assert.deepStrictEqual(
      input.tapBip32Derivation?.map(item => item.path).sort(),
      ["m/87'/0'/2'", "m/87'/0'/2'", 'm/0/0'].sort(),
    );

    const participantField = input.unknownKeyVals?.find(item => item.key[0] === PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS);
    assert.ok(participantField);
    assert.strictEqual(uint8ArrayToHex(participantField!.key.slice(1)), uint8ArrayToHex(wallet.getAggregatePublicKey()));
    assert.strictEqual(
      uint8ArrayToHex(participantField!.value),
      wallet.getAddressParticipantPublicKeys(0, 0).map(uint8ArrayToHex).join(''),
    );
  });
});
