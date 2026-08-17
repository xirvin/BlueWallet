import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';

import ecc from '../noble_ecc';
import { bytesEqual, concatBytes } from './key-aggregation';
import { getMuSig2PartialSignatureProgress, getMuSig2PartialSignatures } from './round2';
import { createMuSig2KeyPathSigningContext, MuSig2KeyPathSigningContext } from './signing-context';
import { partialSigAgg, partialSigVerify, verifyFinalSignature } from './session';

// bitcoinjs-lib requires an explicit secp256k1 backend for Taproot PSBT
// finalization. Use BlueWallet's existing noble adapter so this module is safe
// when invoked directly, including after a cold app start or in unit tests.
bitcoin.initEccLib(ecc);

export { createMuSig2KeyPathSigningContext } from './signing-context';
export type { MuSig2KeyPathSigningContext } from './signing-context';

export type MuSig2FinalizationResult = {
  psbt: Psbt;
  finalSignatures: Uint8Array[];
  rawTransactionHex: string;
  txid: string;
  verifiedPartialSignatures: number;
};

type FinalizedInputCheck = {
  inputIndex: number;
  context: MuSig2KeyPathSigningContext;
  finalSignature: Uint8Array;
  tapKeySig: Uint8Array;
};

function assertFinalizedKeyPathWitness(transaction: bitcoin.Transaction, check: FinalizedInputCheck) {
  const witness = transaction.ins[check.inputIndex]?.witness;
  if (!witness || witness.length !== 1) {
    throw new Error(`Final MuSig2 Taproot witness on input ${check.inputIndex} must contain exactly one key-path signature`);
  }
  if (!bytesEqual(witness[0], check.tapKeySig)) {
    throw new Error(`Final MuSig2 Taproot witness does not match the verified signature on input ${check.inputIndex}`);
  }

  // Verify again after PSBT finalization so the exact 64-byte Schnorr signature
  // committed into the witness is proven against the same BIP341 sighash and
  // fully tweaked BIP328/BIP390 aggregate signing key.
  if (!verifyFinalSignature(check.finalSignature, check.context.session)) {
    throw new Error(`Final MuSig2 Schnorr witness failed post-finalization verification on input ${check.inputIndex}`);
  }
}

export function finalizeMuSig2Psbt(psbt: Psbt): MuSig2FinalizationResult {
  const progress = getMuSig2PartialSignatureProgress(psbt);
  if (!progress.complete) throw new Error('MuSig2 finalization requires all expected partial signatures');

  const finalized = psbt.clone();
  const finalSignatures: Uint8Array[] = [];
  const finalizedInputChecks: FinalizedInputCheck[] = [];
  let verifiedPartialSignatures = 0;

  for (let inputIndex = 0; inputIndex < psbt.inputCount; inputIndex++) {
    const context = createMuSig2KeyPathSigningContext(psbt, inputIndex);
    const partialRecords = getMuSig2PartialSignatures(psbt).filter(record => record.inputIndex === inputIndex);

    const orderedPartials = context.participantPublicKeys.map((participantPublicKey, participantIndex) => {
      const matches = partialRecords.filter(
        record =>
          !record.tapLeafHash &&
          bytesEqual(record.participantPublicKey, participantPublicKey) &&
          bytesEqual(record.aggregatePublicKey, context.signingAggregatePublicKey),
      );
      if (matches.length !== 1) {
        throw new Error(`MuSig2 input ${inputIndex} does not contain exactly one partial signature for every participant`);
      }

      const record = matches[0];
      if (!partialSigVerify(record.partialSignature, context.publicNonces[participantIndex], participantPublicKey, context.session)) {
        throw new Error(`MuSig2 partial signature failed cryptographic verification on input ${inputIndex}`);
      }
      verifiedPartialSignatures++;
      return record.partialSignature;
    });

    if (partialRecords.length !== context.participantPublicKeys.length) {
      throw new Error(`MuSig2 input ${inputIndex} contains an unexpected partial-signature record`);
    }

    const finalSignature = partialSigAgg(orderedPartials, context.session);

    // This is the last cryptographic gate before bitcoinjs-lib is allowed to
    // transform the PSBT into a finalized Taproot key-path witness.
    if (!verifyFinalSignature(finalSignature, context.session)) {
      throw new Error(`Final MuSig2 Schnorr signature failed verification on input ${inputIndex}`);
    }

    const tapKeySig =
      context.sighashType === bitcoin.Transaction.SIGHASH_DEFAULT
        ? finalSignature
        : concatBytes(finalSignature, Uint8Array.of(context.sighashType));

    finalized.updateInput(inputIndex, { tapKeySig });
    finalized.finalizeTaprootInput(inputIndex);
    finalSignatures.push(finalSignature);
    finalizedInputChecks.push({ inputIndex, context, finalSignature, tapKeySig });
  }

  const transaction = finalized.extractTransaction();
  finalizedInputChecks.forEach(check => assertFinalizedKeyPathWitness(transaction, check));

  return {
    psbt: finalized,
    finalSignatures,
    rawTransactionHex: transaction.toHex(),
    txid: transaction.getId(),
    verifiedPartialSignatures,
  };
}
