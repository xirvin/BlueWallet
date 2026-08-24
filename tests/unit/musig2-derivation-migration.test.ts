import assert from 'assert';

import { validateMuSig2VaultSigners } from '../../blue_modules/musig2/vault';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

const LEGACY_SIGNER_1 =
  "[52c4ead8/86'/0'/0']xpub6CTWUpMsz6J8agBdjV6PqsCZfdrgtQj7nasH5D4APNRoiZc3xcFCYFAumrWLcuz9U4EagrhZgMqRW3tibSvt5ie5EwzguZ6NMQrVXpEFBz9";
const LEGACY_SIGNER_2 =
  "[32b14325/86'/0'/0']xpub6BfAYP9UKRSNBR1eRzzqoZRXNjxKDswmqTEnFGquHLagyfdxJ3v63eMkpyxu9ZuKbw6VLqRnwwQreqG1EP5n7cu9D4u4z9ffZym57ML3VHr";
const LEGACY_FIRST_ADDRESS = 'bc1pqrkpachpag3632jhcf5453wglxcr5raakjms89w9xzvhmh9qp3zshysyau';

const BIP87_SIGNER_1 =
  "[32b14325/87'/0'/2']xpub6CV536smmJ4Nu15RWBJiF5oagPjfVMon4dAMdZA6di2BnbVVny8o9a7ENATNS3eX8bUTHXncBXe2SCQLDRXrY8eNq4wmbCVQEw4CNjMzWHm";
const BIP87_SIGNER_2 =
  "[52c4ead8/87'/0'/2']xpub6DWaGeRp9hTVLL2ei2x3Gd6ywGVhi5wFvStKGjDLhrp5h4gbgCejZRpa3SghQhaAdohDXpsRHFReFTXAs2Q3WBXDpPCAVyZD5B7VQ8mJjD1";

describe('MuSig2 derivation-model migration', () => {
  it('keeps historical BIP86 aggregate-first wallets on their original address chain', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setParticipantKeyExpressions(validateMuSig2VaultSigners([LEGACY_SIGNER_1, LEGACY_SIGNER_2], 2));
    assert.strictEqual(wallet.getDerivationMode(), 'legacy-bip328');
    assert.strictEqual(wallet._getExternalAddressByIndex(0), LEGACY_FIRST_ADDRESS);

    const oldSerialized = JSON.parse(JSON.stringify(wallet)) as Record<string, unknown>;
    delete oldSerialized._derivationMode;
    const restored = HDTaprootMuSig2Wallet.fromJson(JSON.stringify(oldSerialized));

    assert.strictEqual(restored.getDerivationMode(), 'legacy-bip328');
    assert.strictEqual(restored._getExternalAddressByIndex(0), LEGACY_FIRST_ADDRESS);
  });

  it('treats pre-migration BIP87 BlueWallet JSON as legacy aggregate-first rather than silently changing addresses', () => {
    const historical = new HDTaprootMuSig2Wallet();
    historical.setParticipantKeyExpressions(validateMuSig2VaultSigners([BIP87_SIGNER_1, BIP87_SIGNER_2], 2));
    historical.setDerivationMode('legacy-bip328');
    const historicalAddress = historical._getExternalAddressByIndex(0);

    const oldSerialized = JSON.parse(JSON.stringify(historical)) as Record<string, unknown>;
    delete oldSerialized._derivationMode;
    const restored = HDTaprootMuSig2Wallet.fromJson(JSON.stringify(oldSerialized));

    assert.strictEqual(restored.getDerivationMode(), 'legacy-bip328');
    assert.strictEqual(restored._getExternalAddressByIndex(0), historicalAddress);

    const newWallet = new HDTaprootMuSig2Wallet();
    newWallet.setParticipantKeyExpressions(validateMuSig2VaultSigners([BIP87_SIGNER_1, BIP87_SIGNER_2], 2));
    assert.strictEqual(newWallet.getDerivationMode(), 'bip390-derived-participants');
    assert.notStrictEqual(newWallet._getExternalAddressByIndex(0), historicalAddress);
  });
});
