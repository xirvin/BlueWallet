import assert from 'assert';
import * as secp from '@noble/secp256k1';
import { Psbt } from 'bitcoinjs-lib';

import { getPlainPublicKey, getXOnlyPublicKey, keyAgg } from '../../blue_modules/musig2/key-aggregation';
import {
  addMuSig2ParticipantsToInput,
  addMuSig2PartialSignatureToInput,
  addMuSig2PublicNonceToInput,
  PSBT_IN_MUSIG2_PARTIAL_SIG,
  PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS,
  PSBT_IN_MUSIG2_PUB_NONCE,
} from '../../blue_modules/musig2/psbt';
import {
  createSession,
  nonceGen,
  partialSigAgg,
  partialSigVerify,
  partialSign,
  verifyFinalSignature,
} from '../../blue_modules/musig2/session';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { hexToUint8Array, uint8ArrayToHex } from '../../blue_modules/uint8array-extras';

const BIP327_KEYS = [
  '02F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9',
  '03DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
  '023590A94E768F8E1815C2F24B4D80A8E3149316C3518CE7B7AD338368D038CA66',
].map(hexToUint8Array);

describe('MuSig2 BIP327/BIP328/BIP373', () => {
  it('matches the official BIP327 key aggregation vector', () => {
    const aggregate = keyAgg(BIP327_KEYS);
    assert.strictEqual(
      uint8ArrayToHex(getXOnlyPublicKey(aggregate)).toUpperCase(),
      '90539EEDE565F5D054F32CC0C220126889ED1E5D193BAF15AEF344FE59D4610C',
    );
  });

  it('matches the official BIP327 nonce generation vector', () => {
    const result = nonceGen({
      random32: hexToUint8Array('0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F'),
      secretKey: hexToUint8Array('0202020202020202020202020202020202020202020202020202020202020202'),
      publicKey: hexToUint8Array('024D4B6CD1361032CA9BD2AEB9D900AA4D45D9EAD80AC9423374C451A7254D0766'),
      aggregatePublicKey: hexToUint8Array('0707070707070707070707070707070707070707070707070707070707070707'),
      message: hexToUint8Array('0101010101010101010101010101010101010101010101010101010101010101'),
      extraInput: hexToUint8Array('0808080808080808080808080808080808080808080808080808080808080808'),
    });
    assert.strictEqual(
      uint8ArrayToHex(result.publicNonce).toUpperCase(),
      '02F7BE7089E8376EB355272368766B17E88E7DB72047D05E56AA881EA52B3B35DF02C29C8046FDD0DED4C7E55869137200FBDBFE2EB654267B6D7013602CAED3115A',
    );
  });

  it('matches the official BIP328 synthetic xpub vector', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setAggregatePublicKey('0290539eede565f5d054f32cc0c220126889ed1e5d193baf15aef344fe59d4610c');
    assert.strictEqual(
      wallet.getXpub(),
      'xpub661MyMwAqRbcFt6tk3uaczE1y6EvM1TqXvawXcYmFEWijEM4PDBnuCXwwVk5TFJk8Tw5WAdV3DhrGfbFA216sE9BsQQiSFTdudkETnKdg8k',
    );
    assert.ok(wallet._getExternalAddressByIndex(0).startsWith('bc1p'));
    assert.notStrictEqual(wallet._getExternalAddressByIndex(0), wallet._getExternalAddressByIndex(1));
  });

  it('supports every N-of-N participant count from 2 through 7', () => {
    for (let count = 2; count <= 7; count++) {
      const publicKeys = Array.from({ length: count }, (_, index) => secp.getPublicKey(secp.etc.numberToBytesBE(BigInt(index + 1)), true));
      const wallet = new HDTaprootMuSig2Wallet();
      wallet.setParticipantPublicKeys(publicKeys);

      assert.strictEqual(wallet.getSignerCount(), count);
      assert.strictEqual(wallet.hasParticipantPublicKeys(), true);
      assert.deepStrictEqual(wallet.getAggregatePublicKey(), getPlainPublicKey(keyAgg(publicKeys)));
    }
  });

  it('serializes and restores aggregate key plus coordinator metadata', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setLabel('MuSig2 coordinator test');
    wallet.setParticipants([
      {
        publicKeyHex: uint8ArrayToHex(BIP327_KEYS[0]),
        masterFingerprint: 'A1B2C3D4',
        derivationPath: 'm/86h/0h/0h',
      },
      {
        publicKeyHex: uint8ArrayToHex(BIP327_KEYS[1]),
        masterFingerprint: '01020304',
        derivationPath: "m/86'/0'/1'",
      },
    ]);

    const aggregateHex = uint8ArrayToHex(getPlainPublicKey(keyAgg(BIP327_KEYS.slice(0, 2))));
    const walletId = wallet.getID();
    const firstAddress = wallet._getExternalAddressByIndex(0);
    const serialized = JSON.stringify(wallet);
    const restored = HDTaprootMuSig2Wallet.fromJson(serialized);

    assert.ok(restored instanceof HDTaprootMuSig2Wallet);
    assert.strictEqual(restored.type, HDTaprootMuSig2Wallet.type);
    assert.strictEqual(restored.getLabel(), 'MuSig2 coordinator test');
    assert.strictEqual(uint8ArrayToHex(restored.getAggregatePublicKey()), aggregateHex);
    assert.strictEqual(restored.getID(), walletId);
    assert.strictEqual(restored._getExternalAddressByIndex(0), firstAddress);
    assert.strictEqual(restored.hasCompleteParticipantMetadata(), true);
    assert.deepStrictEqual(restored.getParticipants(), [
      {
        publicKeyHex: uint8ArrayToHex(BIP327_KEYS[0]),
        masterFingerprint: 'a1b2c3d4',
        derivationPath: "m/86'/0'/0'",
      },
      {
        publicKeyHex: uint8ArrayToHex(BIP327_KEYS[1]),
        masterFingerprint: '01020304',
        derivationPath: "m/86'/0'/1'",
      },
    ]);

    const mutableCopy = restored.getParticipants();
    mutableCopy[0].masterFingerprint = 'ffffffff';
    assert.strictEqual(restored.getParticipants()[0].masterFingerprint, 'a1b2c3d4');

    const tampered = JSON.parse(serialized);
    tampered._aggregatePublicKeyHex = uint8ArrayToHex(BIP327_KEYS[2]);
    assert.throws(
      () => HDTaprootMuSig2Wallet.fromJson(JSON.stringify(tampered)),
      /aggregate public key does not match participant metadata/,
    );
  });

  it('rejects out-of-range, duplicate, or malformed participant metadata', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    const signer = {
      publicKeyHex: uint8ArrayToHex(BIP327_KEYS[0]),
      masterFingerprint: 'a1b2c3d4',
      derivationPath: "m/86'/0'/0'",
    };

    assert.throws(() => wallet.setParticipants([signer]), /between 2 and 7 signers/);

    const eightSigners = Array.from({ length: 8 }, (_, index) => ({
      publicKeyHex: uint8ArrayToHex(secp.getPublicKey(secp.etc.numberToBytesBE(BigInt(index + 1)), true)),
    }));
    assert.throws(() => wallet.setParticipants(eightSigners), /between 2 and 7 signers/);
    assert.throws(() => wallet.setParticipants([signer, signer]), /must be distinct/);
    assert.throws(
      () =>
        wallet.setParticipants([
          signer,
          {
            publicKeyHex: uint8ArrayToHex(BIP327_KEYS[1]),
            masterFingerprint: 'not-a-fingerprint',
            derivationPath: "m/86'/0'/1'",
          },
        ]),
      /fingerprint/,
    );
  });

  it('creates and verifies a complete 2-of-2 MuSig2 signature and consumes secret nonces', () => {
    const secretKeys = [1n, 2n].map(value => secp.etc.numberToBytesBE(value));
    const publicKeys = secretKeys.map(secretKey => secp.getPublicKey(secretKey, true));
    const aggregate = keyAgg(publicKeys);
    const aggregateXOnly = getXOnlyPublicKey(aggregate);
    const message = hexToUint8Array('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');

    const signer1 = nonceGen({
      random32: hexToUint8Array('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
      secretKey: secretKeys[0],
      publicKey: publicKeys[0],
      aggregatePublicKey: aggregateXOnly,
      message,
    });
    const signer2 = nonceGen({
      random32: hexToUint8Array('f0e0d0c0b0a090807060504030201000112233445566778899aabbccddeeff00'),
      secretKey: secretKeys[1],
      publicKey: publicKeys[1],
      aggregatePublicKey: aggregateXOnly,
      message,
    });

    const session = createSession([signer1.publicNonce, signer2.publicNonce], publicKeys, message);
    const partial1 = partialSign(signer1.secretNonce, secretKeys[0], session);
    const partial2 = partialSign(signer2.secretNonce, secretKeys[1], session);

    assert.strictEqual(signer1.secretNonce.isConsumed(), true);
    assert.strictEqual(signer2.secretNonce.isConsumed(), true);
    assert.strictEqual(partialSigVerify(partial1, signer1.publicNonce, publicKeys[0], session), true);
    assert.strictEqual(partialSigVerify(partial2, signer2.publicNonce, publicKeys[1], session), true);

    const signature = partialSigAgg([partial1, partial2], session);
    assert.strictEqual(signature.length, 64);
    assert.strictEqual(verifyFinalSignature(signature, session), true);
    assert.strictEqual(secp.schnorr.verify(signature, message, aggregateXOnly), true);
    assert.throws(() => partialSign(signer1.secretNonce, secretKeys[0], session), /already been consumed/);
  });

  it('serializes BIP373 MuSig2 input fields through bitcoinjs-lib unknown key-values', () => {
    const participantPublicKeys = BIP327_KEYS.slice(0, 3);
    const aggregatePublicKey = getPlainPublicKey(keyAgg(participantPublicKeys));
    const psbt = new Psbt();
    psbt.addInput({ hash: '00'.repeat(32), index: 0 });
    psbt.addOutput({ script: Uint8Array.of(0x6a), value: 0n });

    addMuSig2ParticipantsToInput(psbt, 0, aggregatePublicKey, participantPublicKeys);
    addMuSig2PublicNonceToInput(psbt, 0, participantPublicKeys[0], aggregatePublicKey, new Uint8Array(66).fill(1));
    addMuSig2PartialSignatureToInput(psbt, 0, participantPublicKeys[0], aggregatePublicKey, new Uint8Array(32).fill(2));

    const roundTrip = Psbt.fromBuffer(psbt.toBuffer());
    const unknown = roundTrip.data.inputs[0].unknownKeyVals ?? [];
    const types = unknown.map(item => item.key[0]);
    assert.ok(types.includes(PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS));
    assert.ok(types.includes(PSBT_IN_MUSIG2_PUB_NONCE));
    assert.ok(types.includes(PSBT_IN_MUSIG2_PARTIAL_SIG));
  });
});
