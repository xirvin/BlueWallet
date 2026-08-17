import { Psbt } from 'bitcoinjs-lib';

import { CURVE_N, bytesEqual, concatBytes, parsePlainPublicKey, scalarFromBytes } from './key-aggregation';
import {
  getMuSig2NonceProgress,
  getMuSig2PublicNonces,
  PSBT_IN_MUSIG2_PARTIAL_SIG,
} from './psbt';
import { createMuSig2KeyPathSigningContext } from './signing-context';
import { partialSigVerify } from './session';

export type MuSig2PartialSignatureRecord = {
  inputIndex: number;
  participantPublicKey: Uint8Array;
  aggregatePublicKey: Uint8Array;
  partialSignature: Uint8Array;
  tapLeafHash?: Uint8Array;
};

export type MuSig2PartialSignatureProgress = {
  collected: number;
  expected: number;
  complete: boolean;
};

export type MuSig2Round2MergeResult = MuSig2PartialSignatureProgress & {
  psbt: Psbt;
  added: number;
};

function byteId(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function recordId(
  inputIndex: number,
  participantPublicKey: Uint8Array,
  aggregatePublicKey: Uint8Array,
  tapLeafHash?: Uint8Array,
): string {
  return `${inputIndex}:${byteId(participantPublicKey)}:${byteId(aggregatePublicKey)}:${tapLeafHash ? byteId(tapLeafHash) : ''}`;
}

function assertSameUnsignedTransaction(basePsbt: Psbt, returnedPsbt: Psbt) {
  const baseUnsignedTransaction = basePsbt.data.globalMap.unsignedTx.toBuffer();
  const returnedUnsignedTransaction = returnedPsbt.data.globalMap.unsignedTx.toBuffer();
  if (!bytesEqual(baseUnsignedTransaction, returnedUnsignedTransaction)) {
    throw new Error('Returned MuSig2 PSBT contains a different unsigned transaction');
  }
}

function parsePartialSignatureRecord(
  inputIndex: number,
  key: Uint8Array,
  value: Uint8Array,
): MuSig2PartialSignatureRecord {
  if (key.length !== 67 && key.length !== 99) {
    throw new Error('Invalid BIP373 MuSig2 partial-signature key length');
  }
  if (value.length !== 32) throw new Error('MuSig2 partial signature must be 32 bytes');

  const participantPublicKey = key.slice(1, 34);
  const aggregatePublicKey = key.slice(34, 67);
  const tapLeafHash = key.length === 99 ? key.slice(67, 99) : undefined;
  parsePlainPublicKey(participantPublicKey);
  parsePlainPublicKey(aggregatePublicKey);
  if (tapLeafHash && tapLeafHash.length !== 32) throw new Error('MuSig2 tapleaf hash must be 32 bytes');

  const scalar = scalarFromBytes(value);
  if (scalar >= CURVE_N) throw new Error('MuSig2 partial signature scalar is out of range');

  return {
    inputIndex,
    participantPublicKey,
    aggregatePublicKey,
    partialSignature: new Uint8Array(value),
    ...(tapLeafHash ? { tapLeafHash } : {}),
  };
}

export function getMuSig2PartialSignatures(psbt: Psbt): MuSig2PartialSignatureRecord[] {
  const records: MuSig2PartialSignatureRecord[] = [];
  psbt.data.inputs.forEach((input, inputIndex) => {
    for (const item of input.unknownKeyVals ?? []) {
      if (item.key[0] === PSBT_IN_MUSIG2_PARTIAL_SIG) {
        records.push(parsePartialSignatureRecord(inputIndex, item.key, item.value));
      }
    }
  });
  return records;
}

function getExpectedRound2Records(psbt: Psbt) {
  const nonceProgress = getMuSig2NonceProgress(psbt);
  if (!nonceProgress.complete) {
    throw new Error('MuSig2 Round 2 requires all public nonces before collecting partial signatures');
  }

  const expected = new Map<string, ReturnType<typeof getMuSig2PublicNonces>[number]>();
  for (const nonce of getMuSig2PublicNonces(psbt)) {
    const id = recordId(nonce.inputIndex, nonce.participantPublicKey, nonce.aggregatePublicKey, nonce.tapLeafHash);
    expected.set(id, nonce);
  }
  return expected;
}

function assertReturnedNonceSetMatches(basePsbt: Psbt, returnedPsbt: Psbt) {
  const baseNonces = getMuSig2PublicNonces(basePsbt);
  const returnedNonces = getMuSig2PublicNonces(returnedPsbt);
  if (returnedNonces.length !== baseNonces.length) {
    throw new Error('Returned Round 2 PSBT does not contain the complete original MuSig2 nonce set');
  }

  const expected = new Map<string, Uint8Array>();
  for (const nonce of baseNonces) {
    expected.set(
      recordId(nonce.inputIndex, nonce.participantPublicKey, nonce.aggregatePublicKey, nonce.tapLeafHash),
      nonce.publicNonce,
    );
  }

  for (const nonce of returnedNonces) {
    const id = recordId(nonce.inputIndex, nonce.participantPublicKey, nonce.aggregatePublicKey, nonce.tapLeafHash);
    const original = expected.get(id);
    if (!original || !bytesEqual(original, nonce.publicNonce)) {
      throw new Error(`Returned Round 2 PSBT changed the MuSig2 nonce session on input ${nonce.inputIndex}`);
    }
  }
}

function assertPartialSignatureCryptographicallyValid(psbt: Psbt, record: MuSig2PartialSignatureRecord) {
  if (record.tapLeafHash) {
    throw new Error('MuSig2 coordinator currently supports key-path partial signatures only');
  }

  const context = createMuSig2KeyPathSigningContext(psbt, record.inputIndex);
  if (!bytesEqual(record.aggregatePublicKey, context.signingAggregatePublicKey)) {
    throw new Error(`MuSig2 partial signature on input ${record.inputIndex} targets the wrong signing key`);
  }

  const participantIndex = context.participantPublicKeys.findIndex(key => bytesEqual(key, record.participantPublicKey));
  if (participantIndex < 0) {
    throw new Error(`MuSig2 partial signature on input ${record.inputIndex} is not from an expected participant or signing key`);
  }

  if (
    !partialSigVerify(
      record.partialSignature,
      context.publicNonces[participantIndex],
      context.participantPublicKeys[participantIndex],
      context.session,
    )
  ) {
    throw new Error(`MuSig2 partial signature failed cryptographic verification on input ${record.inputIndex}`);
  }
}

export function verifyMuSig2PartialSignatures(psbt: Psbt): number {
  const records = getMuSig2PartialSignatures(psbt);
  records.forEach(record => assertPartialSignatureCryptographicallyValid(psbt, record));
  return records.length;
}

export function getMuSig2PartialSignatureProgress(psbt: Psbt): MuSig2PartialSignatureProgress {
  const expected = getExpectedRound2Records(psbt);
  const collected = new Set<string>();

  for (const record of getMuSig2PartialSignatures(psbt)) {
    const id = recordId(record.inputIndex, record.participantPublicKey, record.aggregatePublicKey, record.tapLeafHash);
    if (!expected.has(id)) {
      throw new Error(`MuSig2 partial signature on input ${record.inputIndex} is not from an expected participant or signing key`);
    }
    collected.add(id);
  }

  return {
    collected: collected.size,
    expected: expected.size,
    complete: expected.size > 0 && collected.size === expected.size,
  };
}

export function getMuSig2Round2SignerPsbt(coordinatorPsbt: Psbt): Psbt {
  getExpectedRound2Records(coordinatorPsbt);
  const signerPsbt = coordinatorPsbt.clone();

  signerPsbt.data.inputs.forEach(input => {
    if (input.unknownKeyVals) {
      input.unknownKeyVals = input.unknownKeyVals.filter(item => item.key[0] !== PSBT_IN_MUSIG2_PARTIAL_SIG);
    }
    delete (input as { tapKeySig?: Uint8Array }).tapKeySig;
  });

  return signerPsbt;
}

export function mergeMuSig2Round2Psbt(basePsbt: Psbt, returnedPsbt: Psbt): MuSig2Round2MergeResult {
  assertSameUnsignedTransaction(basePsbt, returnedPsbt);
  const expected = getExpectedRound2Records(basePsbt);
  assertReturnedNonceSetMatches(basePsbt, returnedPsbt);

  if (returnedPsbt.data.inputs.some(input => Boolean(input.tapKeySig))) {
    throw new Error('Round 2 signer returned a final Taproot signature instead of a BIP373 partial signature');
  }

  const returnedSignatures = getMuSig2PartialSignatures(returnedPsbt);
  if (returnedSignatures.length === 0) {
    throw new Error('Returned PSBT does not contain a BIP373 MuSig2 partial signature');
  }

  const merged = basePsbt.clone();
  const existing = new Map<string, Uint8Array>();
  for (const record of getMuSig2PartialSignatures(merged)) {
    existing.set(
      recordId(record.inputIndex, record.participantPublicKey, record.aggregatePublicKey, record.tapLeafHash),
      record.partialSignature,
    );
  }

  let added = 0;
  for (const record of returnedSignatures) {
    const id = recordId(record.inputIndex, record.participantPublicKey, record.aggregatePublicKey, record.tapLeafHash);
    if (!expected.has(id)) {
      throw new Error(`MuSig2 partial signature on input ${record.inputIndex} is not from an expected participant or signing key`);
    }

    // Never let an unverified 0x1c enter coordinator state. Verification is
    // against the exact BIP341 sighash, participant public nonce, BIP328
    // derivation and TapTweak reconstructed from the frozen Round 2 PSBT.
    assertPartialSignatureCryptographicallyValid(basePsbt, record);

    const prior = existing.get(id);
    if (prior) {
      if (!bytesEqual(prior, record.partialSignature)) {
        throw new Error(`Conflicting MuSig2 partial signature for input ${record.inputIndex}; restart the signing session`);
      }
      continue;
    }

    merged.addUnknownKeyValToInput(record.inputIndex, {
      key: concatBytes(
        Uint8Array.of(PSBT_IN_MUSIG2_PARTIAL_SIG),
        record.participantPublicKey,
        record.aggregatePublicKey,
        record.tapLeafHash ?? new Uint8Array(),
      ),
      value: record.partialSignature,
    });
    existing.set(id, record.partialSignature);
    added++;
  }

  const progress = getMuSig2PartialSignatureProgress(merged);
  return { psbt: merged, added, ...progress };
}
