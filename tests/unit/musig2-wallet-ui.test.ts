import assert from 'assert';

import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import type { MuSig2CoordinatorExport } from '../../class/wallets/hd-taproot-musig2-wallet';
import { uint8ArrayToHex } from '../../blue_modules/uint8array-extras';

const SIGNER_1 = '02F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9';
const SIGNER_2 = '03DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659';
const EXPECTED_AGGREGATE = '027150e41741100618ed08b2bcbd24f74a06727ad8bc10f394f3340665de1779bd';
const EXPECTED_ROOT_FINGERPRINT = '9FC242BF';
const EXPECTED_XPUB =
  'xpub661MyMwAqRbcFt6tk3uaczE1y6EvM1TqXvawXcYmFEWijEM4PDBnuCXwwVWRKxCE7dZGi8PeE6sCDx8LVLAyU9K2JkjaKphMy6g9bJDYeVg';
const EXPECTED_RECEIVE_ADDRESSES = [
  'bc1pv6zuf787yus2gzc5khvy62cv72u9rk2f5t7hncy4ndlx28r04yhsctu6dt',
  'bc1ppqtta8caspwv3r9l7nky9zvpw5rt35kkhzjtf4jnvj0t3j00u23s6y98rf',
  'bc1psvxydzlp8sf4ynrte9ec2n3cyqsykfxkr5dhuwz8jx6lsnjfl9esekvxpf',
  'bc1pygzsna23yqhq33c45ysjvq45r5n0s0hs7z4xacn2pyljs6qvt3fsup92du',
  'bc1pck6wcljyjy4esj2h4qgn0spvw0ceudgravsfkmhtwpndvm3m4vuste3qwc',
];

describe('MuSig2 minimal coordinator wallet UI model', () => {
  it('locks the verified 2-of-2 BIP328 root, fingerprint, xpub and receive-address derivation', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setLabel('MuSig2 Vault');
    wallet.setParticipantPublicKeys([SIGNER_1, SIGNER_2]);

    assert.strictEqual(HDTaprootMuSig2Wallet.derivationPath, 'm');
    assert.strictEqual(uint8ArrayToHex(wallet.getAggregatePublicKey()), EXPECTED_AGGREGATE);
    assert.strictEqual(wallet.getMuSig2RootFingerprint(), EXPECTED_ROOT_FINGERPRINT);
    assert.strictEqual(wallet.getMasterFingerprintHex(), EXPECTED_ROOT_FINGERPRINT);
    assert.strictEqual(wallet.getXpub(), EXPECTED_XPUB);
    assert.deepStrictEqual(
      EXPECTED_RECEIVE_ADDRESSES.map((_, index) => wallet._getExternalAddressByIndex(index)),
      EXPECTED_RECEIVE_ADDRESSES,
    );
  });

  it('exports a versioned public coordinator backup suitable for QR transport', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setLabel('MuSig2 Vault');
    wallet.setParticipantPublicKeys([SIGNER_1, SIGNER_2]);

    const payload = JSON.parse(wallet.getCoordinatorExport()) as MuSig2CoordinatorExport;

    assert.strictEqual(payload.format, 'bluewallet-musig2');
    assert.strictEqual(payload.version, 1);
    assert.strictEqual(payload.network, 'bitcoin');
    assert.strictEqual(payload.label, 'MuSig2 Vault');
    assert.strictEqual(payload.root, 'm');
    assert.strictEqual(payload.rootFingerprint, EXPECTED_ROOT_FINGERPRINT);
    assert.strictEqual(payload.aggregatePublicKey, EXPECTED_AGGREGATE);
    assert.strictEqual(payload.xpub, EXPECTED_XPUB);
    assert.deepStrictEqual(payload.participants, [
      { publicKeyHex: SIGNER_1.toLowerCase() },
      { publicKeyHex: SIGNER_2.toLowerCase() },
    ]);
    assert.ok(!wallet.getCoordinatorExport().includes('secret'));
  });

  it('creates and restores a public-key-only 2-of-2 coordinator wallet', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setLabel('MuSig2 Vault');
    wallet.setParticipantPublicKeys([SIGNER_1, SIGNER_2]);

    const address = wallet._getExternalAddressByIndex(0);
    const id = wallet.getID();
    const aggregate = uint8ArrayToHex(wallet.getAggregatePublicKey());

    assert.strictEqual(address, EXPECTED_RECEIVE_ADDRESSES[0]);
    assert.strictEqual(wallet.hasParticipantPublicKeys(), true);
    assert.strictEqual(wallet.hasCompleteParticipantMetadata(), false);
    assert.deepStrictEqual(wallet.getParticipants(), [
      { publicKeyHex: SIGNER_1.toLowerCase() },
      { publicKeyHex: SIGNER_2.toLowerCase() },
    ]);

    const restored = HDTaprootMuSig2Wallet.fromJson(JSON.stringify(wallet));
    assert.strictEqual(restored.getID(), id);
    assert.strictEqual(restored.getXpub(), EXPECTED_XPUB);
    assert.strictEqual(restored.getMuSig2RootFingerprint(), EXPECTED_ROOT_FINGERPRINT);
    assert.strictEqual(restored.getMasterFingerprintHex(), EXPECTED_ROOT_FINGERPRINT);
    assert.strictEqual(restored._getExternalAddressByIndex(0), address);
    assert.strictEqual(uint8ArrayToHex(restored.getAggregatePublicKey()), aggregate);
    assert.deepStrictEqual(restored.getParticipants(), wallet.getParticipants());
  });

  it('keeps signer fingerprints separate from the synthetic MuSig2 root fingerprint', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setParticipants([
      { publicKeyHex: SIGNER_1, masterFingerprint: 'A1B2C3D4', derivationPath: "m/86'/0'/0'" },
      { publicKeyHex: SIGNER_2, masterFingerprint: '01020304', derivationPath: "m/86'/0'/1'" },
    ]);

    assert.strictEqual(wallet.getMuSig2RootFingerprint(), EXPECTED_ROOT_FINGERPRINT);
    assert.deepStrictEqual(
      wallet.getParticipants().map(participant => participant.masterFingerprint),
      ['a1b2c3d4', '01020304'],
    );
  });

  it('rejects duplicate public keys', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    assert.throws(() => wallet.setParticipantPublicKeys([SIGNER_1, SIGNER_1]), /must be distinct/);
  });
});
