import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';
import ecc from '../noble_ecc';
import { bytesEqual, concatBytes, getPlainPublicKey, keyAgg, parsePlainPublicKey } from './key-aggregation';

export const PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS = 0x1a;
export const PSBT_IN_MUSIG2_PUB_NONCE = 0x1b;
export const PSBT_IN_MUSIG2_PARTIAL_SIG = 0x1c;
export const PSBT_OUT_MUSIG2_PARTICIPANT_PUBKEYS = 0x08;

export type MuSig2ParticipantSet = {
  aggregatePublicKey: Uint8Array;
  participantPublicKeys: Uint8Array[];
};

export type MuSig2PublicNonceRecord = {
  inputIndex: number;
  participantPublicKey: Uint8Array;
  aggregatePublicKey: Uint8Array;
  publicNonce: Uint8Array;
  tapLeafHash?: Uint8Array;
};

export type MuSig2NonceProgress = {
  collected: number;
  expected: number;
  complete: boolean;
};

export type MuSig2Round1MergeResult = MuSig2NonceProgress & {
  psbt: Psbt;
  added: number;
};

function assertAggregateMatchesParticipants(aggregatePublicKey: Uint8Array, participantPublicKeys: Uint8Array[]) {
  parsePlainPublicKey(aggregatePublicKey);
  if (participantPublicKeys.length === 0) throw new Error('MuSig2 participant list cannot be empty');
  participantPublicKeys.forEach(parsePlainPublicKey);

  const computed = getPlainPublicKey(keyAgg(participantPublicKeys));
  if (!bytesEqual(computed, aggregatePublicKey)) {
    throw new Error('MuSig2 aggregate public key does not match the participant list');
  }
}

function assertValidPublicNonce(publicNonce: Uint8Array) {
  if (publicNonce.length !== 66) throw new Error('MuSig2 public nonce must be 66 bytes');
  try {
    parsePlainPublicKey(publicNonce.slice(0, 33));
    parsePlainPublicKey(publicNonce.slice(33, 66));
  } catch (_) {
    throw new Error('MuSig2 public nonce must contain two valid compressed secp256k1 points');
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

function byteId(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function nonceRecordId(inputIndex: number, participantPublicKey: Uint8Array, aggregatePublicKey: Uint8Array): string {
  return `${inputIndex}:${byteId(participantPublicKey)}:${byteId(aggregatePublicKey)}`;
}

function getInputUnknownKeyVals(psbt: Psbt, inputIndex: number) {
  const input = psbt.data.inputs[inputIndex];
  if (!input) throw new Error(`MuSig2 PSBT input ${inputIndex} does not exist`);
  return input.unknownKeyVals ?? [];
}

export function getMuSig2ParticipantSetsForInput(psbt: Psbt, inputIndex: number): MuSig2ParticipantSet[] {
  const sets: MuSig2ParticipantSet[] = [];

  for (const item of getInputUnknownKeyVals(psbt, inputIndex)) {
    if (item.key[0] !== PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS) continue;
    if (item.key.length !== 34) throw new Error('Invalid BIP373 MuSig2 participant aggregate key length');
    if (item.value.length === 0 || item.value.length % 33 !== 0) {
      throw new Error('Invalid BIP373 MuSig2 participant public-key list length');
    }

    const aggregatePublicKey = item.key.slice(1, 34);
    const participantPublicKeys: Uint8Array[] = [];
    for (let offset = 0; offset < item.value.length; offset += 33) {
      participantPublicKeys.push(item.value.slice(offset, offset + 33));
    }
    assertAggregateMatchesParticipants(aggregatePublicKey, participantPublicKeys);
    sets.push({ aggregatePublicKey, participantPublicKeys });
  }

  return sets;
}

function parsePublicNonceRecord(inputIndex: number, key: Uint8Array, value: Uint8Array): MuSig2PublicNonceRecord {
  if (key.length !== 67 && key.length !== 99) {
    throw new Error('Invalid BIP373 MuSig2 public-nonce key length');
  }

  const participantPublicKey = key.slice(1, 34);
  const aggregatePublicKey = key.slice(34, 67);
  const tapLeafHash = key.length === 99 ? key.slice(67, 99) : undefined;
  parsePlainPublicKey(participantPublicKey);
  parsePlainPublicKey(aggregatePublicKey);
  assertValidPublicNonce(value);

  return {
    inputIndex,
    participantPublicKey,
    aggregatePublicKey,
    publicNonce: new Uint8Array(value),
    ...(tapLeafHash ? { tapLeafHash } : {}),
  };
}

export function getMuSig2PublicNonces(psbt: Psbt): MuSig2PublicNonceRecord[] {
  const records: MuSig2PublicNonceRecord[] = [];
  psbt.data.inputs.forEach((input, inputIndex) => {
    for (const item of input.unknownKeyVals ?? []) {
      if (item.key[0] === PSBT_IN_MUSIG2_PUB_NONCE) {
        records.push(parsePublicNonceRecord(inputIndex, item.key, item.value));
      }
    }
  });
  return records;
}

function getKeyPathSigningAggregatePublicKey(psbt: Psbt, inputIndex: number, participantSet: MuSig2ParticipantSet): Uint8Array {
  const input = psbt.data.inputs[inputIndex];
  if (!input) throw new Error(`MuSig2 PSBT input ${inputIndex} does not exist`);

  // Direct BIP327 aggregates can use the participant-set aggregate itself.
  // For Taproot key-path spends, BIP373/Bitcoin Core/COLDCARD key the nonce by
  // the actual signing key after BIP328 derivation and the BIP341 TapTweak.
  if (!input.tapInternalKey) return participantSet.aggregatePublicKey;
  if (input.tapInternalKey.length !== 32) throw new Error(`Invalid Taproot internal key on input ${inputIndex}`);

  const tweakData = input.tapMerkleRoot ? concatBytes(input.tapInternalKey, input.tapMerkleRoot) : input.tapInternalKey;
  const tweak = bitcoin.crypto.taggedHash('TapTweak', tweakData);
  const tweaked = ecc.xOnlyPointAddTweak(input.tapInternalKey, tweak);
  if (!tweaked) throw new Error(`Could not derive Taproot output key for MuSig2 input ${inputIndex}`);

  const compressed = new Uint8Array(33);
  compressed[0] = tweaked.parity === 1 ? 0x03 : 0x02;
  compressed.set(tweaked.xOnlyPubkey, 1);

  const witnessScript = input.witnessUtxo?.script;
  if (witnessScript) {
    const isP2tr = witnessScript.length === 34 && witnessScript[0] === 0x51 && witnessScript[1] === 0x20;
    if (!isP2tr || !bytesEqual(witnessScript.slice(2), tweaked.xOnlyPubkey)) {
      throw new Error(`MuSig2 Taproot output key does not match witness UTXO on input ${inputIndex}`);
    }
  }

  return compressed;
}

function getExpectedKeyPathNonces(psbt: Psbt) {
  const expected = new Map<string, { inputIndex: number; participantPublicKey: Uint8Array; aggregatePublicKey: Uint8Array }>();

  for (let inputIndex = 0; inputIndex < psbt.inputCount; inputIndex++) {
    const sets = getMuSig2ParticipantSetsForInput(psbt, inputIndex);
    if (sets.length !== 1) {
      throw new Error(`MuSig2 key-path coordinator requires exactly one BIP373 participant set on input ${inputIndex}`);
    }

    const set = sets[0];
    const signingAggregatePublicKey = getKeyPathSigningAggregatePublicKey(psbt, inputIndex, set);
    for (const participantPublicKey of set.participantPublicKeys) {
      const id = nonceRecordId(inputIndex, participantPublicKey, signingAggregatePublicKey);
      expected.set(id, { inputIndex, participantPublicKey, aggregatePublicKey: signingAggregatePublicKey });
    }
  }

  return expected;
}

export function getMuSig2NonceProgress(psbt: Psbt): MuSig2NonceProgress {
  const expected = getExpectedKeyPathNonces(psbt);
  const collected = new Set<string>();

  for (const record of getMuSig2PublicNonces(psbt)) {
    if (record.tapLeafHash) {
      throw new Error('MuSig2 coordinator currently supports key-path public nonces only');
    }
    const id = nonceRecordId(record.inputIndex, record.participantPublicKey, record.aggregatePublicKey);
    if (!expected.has(id)) {
      throw new Error(`MuSig2 public nonce on input ${record.inputIndex} is not from an expected participant or signing key`);
    }
    collected.add(id);
  }

  return {
    collected: collected.size,
    expected: expected.size,
    complete: expected.size > 0 && collected.size === expected.size,
  };
}

function assertSameUnsignedTransaction(basePsbt: Psbt, returnedPsbt: Psbt) {
  const baseUnsignedTransaction = basePsbt.data.globalMap.unsignedTx.toBuffer();
  const returnedUnsignedTransaction = returnedPsbt.data.globalMap.unsignedTx.toBuffer();
  if (!bytesEqual(baseUnsignedTransaction, returnedUnsignedTransaction)) {
    throw new Error('Returned MuSig2 PSBT contains a different unsigned transaction');
  }
}

export function mergeMuSig2Round1Psbt(basePsbt: Psbt, returnedPsbt: Psbt): MuSig2Round1MergeResult {
  assertSameUnsignedTransaction(basePsbt, returnedPsbt);

  const hasRound2Signature = returnedPsbt.data.inputs.some(
    input =>
      Boolean(input.tapKeySig) ||
      Boolean(input.unknownKeyVals?.some(item => item.key[0] === PSBT_IN_MUSIG2_PARTIAL_SIG)),
  );
  if (hasRound2Signature) {
    throw new Error('Round 1 response unexpectedly contains a MuSig2 or Taproot signature');
  }

  const returnedNonces = getMuSig2PublicNonces(returnedPsbt);
  if (returnedNonces.length === 0) throw new Error('Returned PSBT does not contain a BIP373 MuSig2 public nonce');

  const expected = getExpectedKeyPathNonces(basePsbt);
  const merged = basePsbt.clone();
  const existing = new Map<string, Uint8Array>();

  for (const record of getMuSig2PublicNonces(merged)) {
    if (record.tapLeafHash) throw new Error('MuSig2 coordinator currently supports key-path public nonces only');
    existing.set(nonceRecordId(record.inputIndex, record.participantPublicKey, record.aggregatePublicKey), record.publicNonce);
  }

  let added = 0;
  for (const record of returnedNonces) {
    if (record.tapLeafHash) {
      throw new Error('MuSig2 coordinator currently supports key-path public nonces only');
    }

    const id = nonceRecordId(record.inputIndex, record.participantPublicKey, record.aggregatePublicKey);
    if (!expected.has(id)) {
      throw new Error(`MuSig2 public nonce on input ${record.inputIndex} is not from an expected participant or signing key`);
    }

    const prior = existing.get(id);
    if (prior) {
      if (!bytesEqual(prior, record.publicNonce)) {
        throw new Error(`Conflicting MuSig2 public nonce for input ${record.inputIndex}; restart the signing session`);
      }
      continue;
    }

    addMuSig2PublicNonceToInput(
      merged,
      record.inputIndex,
      record.participantPublicKey,
      record.aggregatePublicKey,
      record.publicNonce,
    );
    existing.set(id, record.publicNonce);
    added++;
  }

  const progress = getMuSig2NonceProgress(merged);
  return { psbt: merged, added, ...progress };
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
