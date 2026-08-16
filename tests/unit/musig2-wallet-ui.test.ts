import assert from 'assert';

import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { uint8ArrayToHex } from '../../blue_modules/uint8array-extras';

const SIGNER_1 = '02F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9';
const SIGNER_2 = '03DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659';

describe('MuSig2 minimal coordinator wallet UI model', () => {
  it('creates and restores a public-key-only 2-of-2 coordinator wallet', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setLabel('MuSig2 Vault');
    wallet.setParticipantPublicKeys([SIGNER_1, SIGNER_2]);

    const address = wallet._getExternalAddressByIndex(0);
    const id = wallet.getID();
    const aggregate = uint8ArrayToHex(wallet.getAggregatePublicKey());

    assert.ok(address.startsWith('bc1p'));
    assert.strictEqual(wallet.hasParticipantPublicKeys(), true);
    assert.strictEqual(wallet.hasCompleteParticipantMetadata(), false);
    assert.deepStrictEqual(wallet.getParticipants(), [
      { publicKeyHex: SIGNER_1.toLowerCase() },
      { publicKeyHex: SIGNER_2.toLowerCase() },
    ]);

    const restored = HDTaprootMuSig2Wallet.fromJson(JSON.stringify(wallet));
    assert.strictEqual(restored.getID(), id);
    assert.strictEqual(restored._getExternalAddressByIndex(0), address);
    assert.strictEqual(uint8ArrayToHex(restored.getAggregatePublicKey()), aggregate);
    assert.deepStrictEqual(restored.getParticipants(), wallet.getParticipants());
  });

  it('rejects duplicate public keys', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    assert.throws(() => wallet.setParticipantPublicKeys([SIGNER_1, SIGNER_1]), /must be distinct/);
  });
});
