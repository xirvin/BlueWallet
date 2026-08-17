import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';

import {
  MuSig2Tweak,
  applyTweak,
  bytesEqual,
  concatBytes,
  getPlainPublicKey,
  keyAgg,
  serializePlainPublicKey,
} from './key-aggregation';
import { getMuSig2ParticipantSetsForInput, getMuSig2PublicNonces } from './psbt';
import { MuSig2SessionContext, createSession, getSessionValues } from './session';

const BIP328_CHAIN_CODE = Uint8Array.from([
  0x86, 0x80, 0x87, 0xca, 0x02, 0xa6, 0xf9, 0x74,
  0xc4, 0x59, 0x89, 0x24, 0xc3, 0x6b, 0x57, 0x76,
  0x2d, 0x32, 0xcb, 0x45, 0x71, 0x71, 0x67, 0xe3,
  0x00, 0x62, 0x2c, 0x71, 0x67, 0xe3, 0x89, 0x65,
]);

export type MuSig2KeyPathSigningContext = {
  session: MuSig2SessionContext;
  participantPublicKeys: Uint8Array[];
  publicNonces: Uint8Array[];
  signingAggregatePublicKey: Uint8Array;
  message: Uint8Array;
  sighashType: number;
};

function uint32be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('MuSig2 derivation index is out of range');
  }
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function parseUnhardenedPath(path: string): number[] {
  if (path === 'm') return [];
  if (!path.startsWith('m/')) throw new Error('MuSig2 aggregate derivation path must start with m/');

  return path
    .slice(2)
    .split('/')
    .map(component => {
      if (!/^(0|[1-9][0-9]*)$/.test(component)) {
        throw new Error('BIP328 MuSig2 aggregate derivation must contain only unhardened child indexes');
      }
      const index = Number(component);
      if (!Number.isSafeInteger(index) || index > 0x7fffffff) {
        throw new Error('BIP328 MuSig2 aggregate derivation index must be between 0 and 2^31-1');
      }
      return index;
    });
}

function validateSighashType(sighashType: number) {
  const valid = new Set([
    bitcoin.Transaction.SIGHASH_DEFAULT,
    bitcoin.Transaction.SIGHASH_ALL,
    bitcoin.Transaction.SIGHASH_NONE,
    bitcoin.Transaction.SIGHASH_SINGLE,
    bitcoin.Transaction.SIGHASH_ALL | bitcoin.Transaction.SIGHASH_ANYONECANPAY,
    bitcoin.Transaction.SIGHASH_NONE | bitcoin.Transaction.SIGHASH_ANYONECANPAY,
    bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY,
  ]);
  if (!valid.has(sighashType)) throw new Error(`Unsupported Taproot sighash type 0x${sighashType.toString(16)}`);
}

function getPrevouts(psbt: Psbt): { scripts: Uint8Array[]; values: bigint[] } {
  const scripts: Uint8Array[] = [];
  const values: bigint[] = [];

  psbt.data.inputs.forEach((input, inputIndex) => {
    if (!input.witnessUtxo) {
      throw new Error(`MuSig2 signing requires witness UTXO data for input ${inputIndex}`);
    }
    scripts.push(new Uint8Array(input.witnessUtxo.script));
    values.push(input.witnessUtxo.value);
  });

  return { scripts, values };
}

function findAggregateDerivation(psbt: Psbt, inputIndex: number, rootAggregatePublicKey: Uint8Array): string {
  const input = psbt.data.inputs[inputIndex];
  if (!input?.tapInternalKey || input.tapInternalKey.length !== 32) {
    throw new Error(`MuSig2 key-path signing requires a Taproot internal key on input ${inputIndex}`);
  }

  const rootFingerprint = bitcoin.crypto.hash160(rootAggregatePublicKey).slice(0, 4);
  const matches = (input.tapBip32Derivation ?? []).filter(
    derivation =>
      derivation.leafHashes.length === 0 &&
      bytesEqual(derivation.pubkey, input.tapInternalKey!) &&
      bytesEqual(derivation.masterFingerprint, rootFingerprint),
  );

  if (matches.length !== 1) {
    throw new Error(`MuSig2 input ${inputIndex} must identify exactly one BIP328 aggregate derivation`);
  }
  return matches[0].path;
}

function deriveKeyPathTweaks(
  psbt: Psbt,
  inputIndex: number,
  participantPublicKeys: Uint8Array[],
  rootAggregatePublicKey: Uint8Array,
): { tweaks: MuSig2Tweak[]; signingAggregatePublicKey: Uint8Array } {
  const input = psbt.data.inputs[inputIndex];
  if (!input?.tapInternalKey) throw new Error(`Missing Taproot internal key on input ${inputIndex}`);

  let context = keyAgg(participantPublicKeys);
  if (!bytesEqual(getPlainPublicKey(context), rootAggregatePublicKey)) {
    throw new Error(`MuSig2 root aggregate key does not match participant set on input ${inputIndex}`);
  }

  let chainCode = new Uint8Array(BIP328_CHAIN_CODE);
  const tweaks: MuSig2Tweak[] = [];
  const path = findAggregateDerivation(psbt, inputIndex, rootAggregatePublicKey);

  for (const index of parseUnhardenedPath(path)) {
    const digest = hmac(sha512, chainCode, concatBytes(serializePlainPublicKey(context.point), uint32be(index)));
    const tweak = new Uint8Array(digest.slice(0, 32));
    chainCode = new Uint8Array(digest.slice(32, 64));
    const item: MuSig2Tweak = { tweak, isXOnly: false };
    context = applyTweak(context, item.tweak, item.isXOnly);
    tweaks.push(item);
  }

  if (!bytesEqual(serializePlainPublicKey(context.point).slice(1), input.tapInternalKey)) {
    throw new Error(`BIP328-derived MuSig2 internal key does not match input ${inputIndex}`);
  }

  if (input.tapMerkleRoot && input.tapMerkleRoot.length !== 32) {
    throw new Error(`Invalid Taproot merkle root on input ${inputIndex}`);
  }
  const tapTweak = bitcoin.crypto.taggedHash(
    'TapTweak',
    input.tapMerkleRoot ? concatBytes(input.tapInternalKey, input.tapMerkleRoot) : input.tapInternalKey,
  );
  const tapTweakItem: MuSig2Tweak = { tweak: new Uint8Array(tapTweak), isXOnly: true };
  context = applyTweak(context, tapTweakItem.tweak, tapTweakItem.isXOnly);
  tweaks.push(tapTweakItem);

  const signingAggregatePublicKey = getPlainPublicKey(context);
  const witnessScript = input.witnessUtxo?.script;
  const xOnlySigningKey = signingAggregatePublicKey.slice(1);
  if (
    !witnessScript ||
    witnessScript.length !== 34 ||
    witnessScript[0] !== 0x51 ||
    witnessScript[1] !== 0x20 ||
    !bytesEqual(witnessScript.slice(2), xOnlySigningKey)
  ) {
    throw new Error(`MuSig2 signing key does not match the Taproot witness UTXO on input ${inputIndex}`);
  }

  return { tweaks, signingAggregatePublicKey };
}

export function createMuSig2KeyPathSigningContext(psbt: Psbt, inputIndex: number): MuSig2KeyPathSigningContext {
  const participantSets = getMuSig2ParticipantSetsForInput(psbt, inputIndex);
  if (participantSets.length !== 1) {
    throw new Error(`MuSig2 key-path signing requires exactly one participant set on input ${inputIndex}`);
  }

  const participantSet = participantSets[0];
  const participantPublicKeys = participantSet.participantPublicKeys.map(key => new Uint8Array(key));
  const { tweaks, signingAggregatePublicKey } = deriveKeyPathTweaks(
    psbt,
    inputIndex,
    participantPublicKeys,
    participantSet.aggregatePublicKey,
  );

  const inputNonces = getMuSig2PublicNonces(psbt).filter(record => record.inputIndex === inputIndex);
  const publicNonces = participantPublicKeys.map(participantPublicKey => {
    const matches = inputNonces.filter(
      record =>
        !record.tapLeafHash &&
        bytesEqual(record.participantPublicKey, participantPublicKey) &&
        bytesEqual(record.aggregatePublicKey, signingAggregatePublicKey),
    );
    if (matches.length !== 1) {
      throw new Error(`MuSig2 input ${inputIndex} does not contain exactly one public nonce for every participant`);
    }
    return matches[0].publicNonce;
  });

  if (inputNonces.length !== participantPublicKeys.length) {
    throw new Error(`MuSig2 input ${inputIndex} contains an unexpected public nonce record`);
  }

  const input = psbt.data.inputs[inputIndex];
  const sighashType = input.sighashType ?? bitcoin.Transaction.SIGHASH_DEFAULT;
  validateSighashType(sighashType);

  const unsignedTx = bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
  const prevouts = getPrevouts(psbt);
  const message = unsignedTx.hashForWitnessV1(inputIndex, prevouts.scripts, prevouts.values, sighashType);
  const session = createSession(publicNonces, participantPublicKeys, message, tweaks);
  const sessionValues = getSessionValues(session);
  if (!bytesEqual(serializePlainPublicKey(sessionValues.aggregatePublicKey), signingAggregatePublicKey)) {
    throw new Error(`MuSig2 session aggregate key mismatch on input ${inputIndex}`);
  }

  return {
    session,
    participantPublicKeys,
    publicNonces,
    signingAggregatePublicKey,
    message,
    sighashType,
  };
}
