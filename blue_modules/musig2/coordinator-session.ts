import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2';
import { Psbt } from 'bitcoinjs-lib';

import { bytesEqual, concatBytes } from './key-aggregation';
import { getMuSig2NonceProgress } from './psbt';
import { getMuSig2PartialSignatureProgress, verifyMuSig2PartialSignatures } from './round2';

export const MUSIG2_COORDINATOR_SESSION_VERSION = 1;
const STORAGE_PREFIX = 'bluewallet:musig2:coordinator:v1:';

export type MuSig2CoordinatorState =
  | 'CREATED'
  | 'COLLECTING_NONCES'
  | 'NONCES_COMPLETE'
  | 'COLLECTING_PARTIAL_SIGNATURES'
  | 'SIGNATURES_COMPLETE'
  | 'FINALIZED'
  | 'CANCELLED'
  | 'NONCE_INVALIDATED'
  | 'FAILED';

export type MuSig2PersistedFinalization = {
  psbtBase64: string;
  rawTransactionHex: string;
  txid: string;
  verifiedPartialSignatures: number;
  finalSignatureCount: number;
};

export type MuSig2CoordinatorSessionRecord = {
  version: 1;
  sessionId: string;
  walletID: string;
  state: MuSig2CoordinatorState;
  coordinatorPsbtBase64: string;
  finalization?: MuSig2PersistedFinalization;
  lastError?: string;
  updatedAt: number;
};

const VALID_STATES = new Set<MuSig2CoordinatorState>([
  'CREATED',
  'COLLECTING_NONCES',
  'NONCES_COMPLETE',
  'COLLECTING_PARTIAL_SIGNATURES',
  'SIGNATURES_COMPLETE',
  'FINALIZED',
  'CANCELLED',
  'NONCE_INVALIDATED',
  'FAILED',
]);

const TERMINAL_STATES = new Set<MuSig2CoordinatorState>(['FINALIZED', 'CANCELLED', 'NONCE_INVALIDATED', 'FAILED']);

const TRANSITIONS: Record<MuSig2CoordinatorState, Set<MuSig2CoordinatorState>> = {
  CREATED: new Set(['COLLECTING_NONCES', 'CANCELLED', 'FAILED']),
  COLLECTING_NONCES: new Set(['NONCES_COMPLETE', 'CANCELLED', 'NONCE_INVALIDATED', 'FAILED']),
  NONCES_COMPLETE: new Set(['COLLECTING_PARTIAL_SIGNATURES', 'SIGNATURES_COMPLETE', 'CANCELLED', 'NONCE_INVALIDATED', 'FAILED']),
  COLLECTING_PARTIAL_SIGNATURES: new Set(['SIGNATURES_COMPLETE', 'CANCELLED', 'NONCE_INVALIDATED', 'FAILED']),
  SIGNATURES_COMPLETE: new Set(['FINALIZED', 'CANCELLED', 'FAILED']),
  FINALIZED: new Set(),
  CANCELLED: new Set(['COLLECTING_NONCES']),
  NONCE_INVALIDATED: new Set(['COLLECTING_NONCES']),
  FAILED: new Set(['COLLECTING_NONCES']),
};

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(Array.from(value, character => character.charCodeAt(0) & 0xff));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function unsignedTransactionBytes(psbt: Psbt): Uint8Array {
  return new Uint8Array(psbt.data.globalMap.unsignedTx.toBuffer());
}

export function getMuSig2CoordinatorSessionId(walletID: string, round1Psbt: Psbt): string {
  return bytesToHex(sha256(concatBytes(asciiBytes(walletID), unsignedTransactionBytes(round1Psbt))));
}

function storageKey(walletID: string, round1Psbt: Psbt): string {
  return `${STORAGE_PREFIX}${getMuSig2CoordinatorSessionId(walletID, round1Psbt)}`;
}

export function isMuSig2TerminalState(state: MuSig2CoordinatorState): boolean {
  return TERMINAL_STATES.has(state);
}

export function assertMuSig2StateTransition(from: MuSig2CoordinatorState, to: MuSig2CoordinatorState): void {
  if (from === to) return;
  if (!TRANSITIONS[from].has(to)) {
    throw new Error(`Invalid MuSig2 coordinator state transition: ${from} -> ${to}`);
  }
}

export function transitionMuSig2State(from: MuSig2CoordinatorState, to: MuSig2CoordinatorState): MuSig2CoordinatorState {
  assertMuSig2StateTransition(from, to);
  return to;
}

export function deriveMuSig2ActiveState(psbt: Psbt): MuSig2CoordinatorState {
  const nonceProgress = getMuSig2NonceProgress(psbt);
  if (!nonceProgress.complete) return 'COLLECTING_NONCES';

  const partialProgress = getMuSig2PartialSignatureProgress(psbt);
  if (partialProgress.collected > 0) {
    // Restored coordinator data is not trusted merely because it parses. Every
    // persisted 0x1c is re-verified before its state can be resumed.
    verifyMuSig2PartialSignatures(psbt);
  }
  if (partialProgress.complete) return 'SIGNATURES_COMPLETE';
  if (partialProgress.collected > 0) return 'COLLECTING_PARTIAL_SIGNATURES';
  return 'NONCES_COMPLETE';
}

function assertFinalizationStateConsistency(state: MuSig2CoordinatorState, finalization?: MuSig2PersistedFinalization) {
  if (state === 'FINALIZED' && !finalization) {
    throw new Error('Finalized MuSig2 coordinator state requires finalization data');
  }
  if (state !== 'FINALIZED' && finalization) {
    throw new Error('MuSig2 finalization data can only be stored in FINALIZED state');
  }
}

function parseStoredRecord(raw: string, walletID: string, round1Psbt: Psbt): MuSig2CoordinatorSessionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Stored MuSig2 coordinator session is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('Stored MuSig2 coordinator session is invalid');
  const candidate = parsed as Partial<MuSig2CoordinatorSessionRecord>;
  if (candidate.version !== MUSIG2_COORDINATOR_SESSION_VERSION) {
    throw new Error('Stored MuSig2 coordinator session uses an unsupported version');
  }
  if (candidate.walletID !== walletID) throw new Error('Stored MuSig2 coordinator session belongs to a different wallet');
  if (!candidate.state || !VALID_STATES.has(candidate.state)) throw new Error('Stored MuSig2 coordinator session has an invalid state');
  if (typeof candidate.coordinatorPsbtBase64 !== 'string') throw new Error('Stored MuSig2 coordinator session is missing its PSBT');

  const expectedSessionId = getMuSig2CoordinatorSessionId(walletID, round1Psbt);
  if (candidate.sessionId !== expectedSessionId) throw new Error('Stored MuSig2 coordinator session ID does not match this transaction');

  let restoredPsbt: Psbt;
  try {
    restoredPsbt = Psbt.fromBase64(candidate.coordinatorPsbtBase64);
  } catch {
    throw new Error('Stored MuSig2 coordinator PSBT is invalid');
  }

  if (!bytesEqual(unsignedTransactionBytes(restoredPsbt), unsignedTransactionBytes(round1Psbt))) {
    throw new Error('Stored MuSig2 coordinator PSBT contains a different unsigned transaction');
  }

  assertFinalizationStateConsistency(candidate.state, candidate.finalization);
  return candidate as MuSig2CoordinatorSessionRecord;
}

export async function loadMuSig2CoordinatorSession(
  walletID: string,
  round1Psbt: Psbt,
): Promise<MuSig2CoordinatorSessionRecord | undefined> {
  const raw = await AsyncStorage.getItem(storageKey(walletID, round1Psbt));
  return raw ? parseStoredRecord(raw, walletID, round1Psbt) : undefined;
}

export async function saveMuSig2CoordinatorSession(
  walletID: string,
  round1Psbt: Psbt,
  state: MuSig2CoordinatorState,
  coordinatorPsbtBase64: string,
  finalization?: MuSig2PersistedFinalization,
  lastError?: string,
): Promise<MuSig2CoordinatorSessionRecord> {
  assertFinalizationStateConsistency(state, finalization);

  const sessionId = getMuSig2CoordinatorSessionId(walletID, round1Psbt);
  const record: MuSig2CoordinatorSessionRecord = {
    version: MUSIG2_COORDINATOR_SESSION_VERSION,
    sessionId,
    walletID,
    state,
    coordinatorPsbtBase64,
    ...(finalization ? { finalization } : {}),
    ...(lastError ? { lastError } : {}),
    updatedAt: Date.now(),
  };

  // This deliberately persists public coordinator state only. Signer secret
  // nonces and private keys are never present in the coordinator PSBT or record.
  await AsyncStorage.setItem(storageKey(walletID, round1Psbt), JSON.stringify(record));
  return record;
}

export async function clearMuSig2CoordinatorSession(walletID: string, round1Psbt: Psbt): Promise<void> {
  await AsyncStorage.removeItem(storageKey(walletID, round1Psbt));
}
