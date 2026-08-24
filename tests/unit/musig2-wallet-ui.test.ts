import assert from 'assert';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';

import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import type { MuSig2CoordinatorExport } from '../../class/wallets/hd-taproot-musig2-wallet';
import { descriptorChecksum } from '../../class/wallet-descriptor';
import { keySort } from '../../blue_modules/musig2/key-aggregation';
import { PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS, PSBT_OUT_MUSIG2_PARTICIPANT_PUBKEYS } from '../../blue_modules/musig2/psbt';
import ecc from '../../blue_modules/noble_ecc';
import { uint8ArrayToHex } from '../../blue_modules/uint8array-extras';

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

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

// BIP390 public extended-key fixtures. The origins match the serialized xpub
// depth/child numbers and let the test independently derive each child xpub
// before comparing it with the wallet's BIP390 participant set.
const BIP390_XPUB_1 =
  'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL';
const BIP390_XPUB_2 =
  'xpub68NZiKmJWnxxS6aaHmn81bvJeTESw724CRDs6HbuccFQN9Ku14VQrADWgqbhhTHBaohPX4CjNLf9fq9MYo6oDaPPLPxSb7gwQN3ih19Zm4Y';
const BIP390_KEY_EXPRESSION_1 = `[deadbeef/0h/0h/0h/2147483646h]${BIP390_XPUB_1}`;
const BIP390_KEY_EXPRESSION_2 = `[cafebabe/0h]${BIP390_XPUB_2}`;

function createHardwareVectorWallet(): HDTaprootMuSig2Wallet {
  const wallet = new HDTaprootMuSig2Wallet();
  wallet.setLabel('MuSig2 Hardware Vault');
  wallet.setParticipantKeyExpressions([BIP390_KEY_EXPRESSION_1, BIP390_KEY_EXPRESSION_2]);
  return wallet;
}

describe('MuSig2 minimal coordinator wallet UI model', () => {
  it('keeps the verified bare-public-key BIP328 root and receive-address derivation as legacy behavior', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setLabel('MuSig2 Vault');
    wallet.setParticipantPublicKeys([SIGNER_1, SIGNER_2]);

    assert.strictEqual(wallet.getDerivationMode(), 'legacy-bip328');
    assert.strictEqual(HDTaprootMuSig2Wallet.derivationPath, 'm');
    assert.strictEqual(uint8ArrayToHex(wallet.getAggregatePublicKey()), EXPECTED_AGGREGATE);
    assert.strictEqual(wallet.getMuSig2RootFingerprint(), EXPECTED_ROOT_FINGERPRINT);
    assert.strictEqual(wallet.getMasterFingerprintHex(), EXPECTED_ROOT_FINGERPRINT);
    assert.strictEqual(wallet.getXpub(), EXPECTED_XPUB);
    assert.deepStrictEqual(
      EXPECTED_RECEIVE_ADDRESSES.map((_, index) => wallet._getExternalAddressByIndex(index)),
      EXPECTED_RECEIVE_ADDRESSES,
    );
    assert.strictEqual(wallet.allowSend(), false);
  });

  it('implements the BIP380 descriptor checksum vector', () => {
    assert.strictEqual(descriptorChecksum('raw(deadbeef)'), '89f8spxm');
  });

  it('derives every extended-key participant before KeySort/KeyAgg and exports BIP390 multipath syntax', () => {
    const wallet = createHardwareVectorWallet();

    assert.strictEqual(wallet.getDerivationMode(), 'bip390-derived-participants');
    assert.strictEqual(wallet.hasCompleteExtendedParticipantMetadata(), true);
    assert.strictEqual(wallet.allowSend(), true);
    assert.strictEqual(wallet.allowXpub(), false);
    assert.deepStrictEqual(
      wallet.getParticipants().map(participant => participant.masterFingerprint),
      ['cafebabe', 'deadbeef'],
    );

    const independentlyDerived = keySort([
      new Uint8Array(bip32.fromBase58(BIP390_XPUB_1).derive(0).derive(0).publicKey),
      new Uint8Array(bip32.fromBase58(BIP390_XPUB_2).derive(0).derive(0).publicKey),
    ]);
    assert.deepStrictEqual(
      wallet.getAddressParticipantPublicKeys(0, 0).map(uint8ArrayToHex),
      independentlyDerived.map(uint8ArrayToHex),
    );
    assert.notStrictEqual(
      uint8ArrayToHex(wallet.getAddressAggregatePublicKey(0, 0)),
      uint8ArrayToHex(wallet.getAggregatePublicKey()),
    );

    const descriptor = wallet.getBIP390Descriptor();
    const [body, checksum] = descriptor.split('#');
    assert.ok(body.startsWith('tr(musig('));
    assert.ok(body.includes(`${BIP390_XPUB_1}/<0;1>/*`));
    assert.ok(body.includes(`${BIP390_XPUB_2}/<0;1>/*`));
    assert.ok(body.endsWith('))'));
    assert.ok(!body.includes(')/<0;1>/*)'));
    assert.strictEqual(checksum, descriptorChecksum(body));
  });

  it('builds a BIP373 Round 1 PSBT with derived participant child keys and paths', () => {
    const wallet = createHardwareVectorWallet();
    const receiveAddress = wallet._getExternalAddressByIndex(0);
    const changeAddress = wallet._getInternalAddressByIndex(0);
    const externalTarget = EXPECTED_RECEIVE_ADDRESSES[0];

    const result = wallet.createTransaction(
      [
        {
          txid: '11'.repeat(32),
          vout: 0,
          value: 100000,
          address: receiveAddress,
        },
      ],
      [{ address: externalTarget, value: 25000 }],
      1,
      changeAddress,
    );

    assert.strictEqual(result.tx, undefined);
    assert.strictEqual(result.psbt.inputCount, 1);

    const input = result.psbt.data.inputs[0];
    const internalKey = wallet._getNodePubkeyByIndex(0, 0);
    const expectedP2tr = bitcoin.payments.p2tr({ internalPubkey: internalKey });
    assert.ok(expectedP2tr.output);
    assert.strictEqual(uint8ArrayToHex(input.witnessUtxo!.script), uint8ArrayToHex(expectedP2tr.output!));
    assert.strictEqual(uint8ArrayToHex(input.tapInternalKey!), uint8ArrayToHex(internalKey));

    assert.strictEqual(input.tapBip32Derivation?.some(item => item.path === 'm/0/0'), false);
    assert.deepStrictEqual(
      input.tapBip32Derivation?.map(item => item.path).sort(),
      ["m/0'/0'/0'/2147483646'/0/0", "m/0'/0/0"].sort(),
    );
    assert.deepStrictEqual(
      input.tapBip32Derivation?.map(item => uint8ArrayToHex(item.masterFingerprint)).sort(),
      ['cafebabe', 'deadbeef'].sort(),
    );

    const participantField = input.unknownKeyVals?.find(item => item.key[0] === PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS);
    assert.ok(participantField);
    assert.strictEqual(
      uint8ArrayToHex(participantField!.key.slice(1)),
      uint8ArrayToHex(wallet.getAddressAggregatePublicKey(0, 0)),
    );
    assert.strictEqual(participantField!.value.length, 66);
    assert.strictEqual(
      uint8ArrayToHex(participantField!.value),
      wallet.getAddressParticipantPublicKeys(0, 0).map(uint8ArrayToHex).join(''),
    );

    const changeOutputIndex = result.outputs.findIndex(output => output.address === changeAddress);
    assert.ok(changeOutputIndex >= 0);
    const changeParticipantField = result.psbt.data.outputs[changeOutputIndex].unknownKeyVals?.find(
      item => item.key[0] === PSBT_OUT_MUSIG2_PARTICIPANT_PUBKEYS,
    );
    assert.ok(changeParticipantField);
    assert.strictEqual(
      uint8ArrayToHex(changeParticipantField!.key.slice(1)),
      uint8ArrayToHex(wallet.getAddressAggregatePublicKey(1, 0)),
    );
  });

  it('exports a versioned legacy public coordinator backup suitable for QR transport', () => {
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
    assert.strictEqual(payload.derivationMode, 'legacy-bip328');
    assert.strictEqual(payload.xpub, EXPECTED_XPUB);
    assert.strictEqual(payload.descriptor, undefined);
    assert.deepStrictEqual(payload.participants, [
      { publicKeyHex: SIGNER_1.toLowerCase() },
      { publicKeyHex: SIGNER_2.toLowerCase() },
    ]);
    assert.ok(!wallet.getCoordinatorExport().includes('secret'));
  });

  it('exports derived-participant mode and descriptor without pretending the synthetic root xpub is an address xpub', () => {
    const wallet = createHardwareVectorWallet();
    const payload = JSON.parse(wallet.getCoordinatorExport()) as MuSig2CoordinatorExport;

    assert.strictEqual(payload.derivationMode, 'bip390-derived-participants');
    assert.strictEqual(payload.xpub, undefined);
    assert.strictEqual(payload.descriptor, wallet.getBIP390Descriptor());
    assert.strictEqual(payload.participants.every(participant => Boolean(participant.xpub)), true);
  });

  it('creates and restores a public-key-only 2-of-2 legacy coordinator wallet', () => {
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
    assert.strictEqual(restored.getDerivationMode(), 'legacy-bip328');
    assert.strictEqual(restored.getID(), id);
    assert.strictEqual(restored.getXpub(), EXPECTED_XPUB);
    assert.strictEqual(restored.getMuSig2RootFingerprint(), EXPECTED_ROOT_FINGERPRINT);
    assert.strictEqual(restored.getMasterFingerprintHex(), EXPECTED_ROOT_FINGERPRINT);
    assert.strictEqual(restored._getExternalAddressByIndex(0), address);
    assert.strictEqual(uint8ArrayToHex(restored.getAggregatePublicKey()), aggregate);
    assert.deepStrictEqual(restored.getParticipants(), wallet.getParticipants());
  });

  it('restores a derived-participant wallet without changing its address model', () => {
    const wallet = createHardwareVectorWallet();
    const address = wallet._getExternalAddressByIndex(0);
    const restored = HDTaprootMuSig2Wallet.fromJson(JSON.stringify(wallet));

    assert.strictEqual(restored.getDerivationMode(), 'bip390-derived-participants');
    assert.strictEqual(restored._getExternalAddressByIndex(0), address);
    assert.strictEqual(restored.getBIP390Descriptor(), wallet.getBIP390Descriptor());
  });

  it('keeps signer fingerprints separate from the synthetic MuSig2 root fingerprint', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setDerivationMode('legacy-bip328');
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

  it('rejects mixed hardware-xpub and bare-public-key signer modes', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    assert.throws(() => wallet.setParticipantKeyExpressions([BIP390_KEY_EXPRESSION_1, SIGNER_2]), /mixed MuSig2 signer modes/);
  });

  it('rejects duplicate public keys', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    assert.throws(() => wallet.setParticipantPublicKeys([SIGNER_1, SIGNER_1]), /must be distinct/);
  });
});
