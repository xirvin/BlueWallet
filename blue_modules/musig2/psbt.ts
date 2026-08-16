import { Psbt } from 'bitcoinjs-lib';
import { concatBytes, getPlainPublicKey, keyAgg, parsePlainPublicKey } from './key-aggregation';

export const PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS = 0x1a;
export const PSBT_IN_MUSIG2_PUB_NONCE = 0x1b;
export const PSBT_IN_MUSIG2_PARTIAL_SIG = 0x1c;
export const PSBT_OUT_MUSIG2_PARTICIPANT_PUBKEYS = 0x08;

function assertAggregateMatchesParticipants(aggregatePublicKey: Uint8Array, participantPublicKeys: Uint8Array[]) {
  parsePlainPublicKey(aggregatePublicKey);
  if (participantPublicKeys.length === 0) throw new Error('MuSig2 participant list cannot be empty');
  participantPublicKeys.forEach(parsePlainPublicKey);

  const computed = getPlainPublicKey(keyAgg(participantPublicKeys));
  if (computed.length !== aggregatePublicKey.length || computed.some((byte, index) => byte !== aggregatePublicKey[index])) {
    throw new Error('MuSig2 aggregate public key does not match the participant list');
  }
}

function participantKeyData(
  participantPublicKey: Uint8Array,
  aggregatePublicKey: Uint8Array,
  tapLeafHash?: Uint8Array,
): Uint8Array {
  parsePlainPublicKey(participantPublicKey);
  parsePlainPublicKey(aggregatePublicKey);
  if (tapLeafHash && tapLeafHash.length !== 32) throw new Error('MuSig2 tapleaf hash must be 32 bytes');
  return concatBytes(participantPublicKey, aggregatePublicKey, tapLeafHash ?? new Uint8Array());
}

export function addMuSig2ParticipantsToInput(
  psbt: Psbt,
  inputIndex: number,
  aggregatePublicKey: Uint8Array,
  participantPublicKeys: Uint8Array[],
): Psbt {
  assertAggregateMatchesParticipants(aggregatePublicKey, participantPublicKeys);
  psbt.addUnknownKeyValToInput(inputIndex, {
    key: concatBytes(Uint8Array.of(PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS), aggregatePublicKey),
    value: concatBytes(...participantPublicKeys),
  });
  return psbt;
}

export function addMuSig2ParticipantsToOutput(
  psbt: Psbt,
  outputIndex: number,
  aggregatePublicKey: Uint8Array,
  participantPublicKeys: Uint8Array[],
): Psbt {
  assertAggregateMatchesParticipants(aggregatePublicKey, participantPublicKeys);
  psbt.addUnknownKeyValToOutput(outputIndex, {
    key: concatBytes(Uint8Array.of(PSBT_OUT_MUSIG2_PARTICIPANT_PUBKEYS), aggregatePublicKey),
    value: concatBytes(...participantPublicKeys),
  });
  return psbt;
}

export function addMuSig2PublicNonceToInput(
  psbt: Psbt,
  inputIndex: number,
  participantPublicKey: Uint8Array,
  aggregatePublicKey: Uint8Array,
  publicNonce: Uint8Array,
  tapLeafHash?: Uint8Array,
): Psbt {
  if (publicNonce.length !== 66) throw new Error('MuSig2 public nonce must be 66 bytes');
  psbt.addUnknownKeyValToInput(inputIndex, {
    key: concatBytes(
      Uint8Array.of(PSBT_IN_MUSIG2_PUB_NONCE),
      participantKeyData(participantPublicKey, aggregatePublicKey, tapLeafHash),
    ),
    value: publicNonce,
  });
  return psbt;
}

export function addMuSig2PartialSignatureToInput(
  psbt: Psbt,
  inputIndex: number,
  participantPublicKey: Uint8Array,
  aggregatePublicKey: Uint8Array,
  partialSignature: Uint8Array,
  tapLeafHash?: Uint8Array,
): Psbt {
  if (partialSignature.length !== 32) throw new Error('MuSig2 partial signature must be 32 bytes');
  psbt.addUnknownKeyValToInput(inputIndex, {
    key: concatBytes(
      Uint8Array.of(PSBT_IN_MUSIG2_PARTIAL_SIG),
      participantKeyData(participantPublicKey, aggregatePublicKey, tapLeafHash),
    ),
    value: partialSignature,
  });
  return psbt;
}
