import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as bitcoin from 'bitcoinjs-lib';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import {
  MuSig2CoordinatorState,
  MuSig2PersistedFinalization,
  clearMuSig2CoordinatorSession,
  deriveMuSig2ActiveState,
  isMuSig2TerminalState,
  loadMuSig2CoordinatorSession,
  saveMuSig2CoordinatorSession,
  transitionMuSig2State,
} from '../../blue_modules/musig2/coordinator-session';
import { MUSIG2_DRY_RUN_FAKE_TXID } from '../../blue_modules/musig2/dry-run';
import { finalizeMuSig2Psbt } from '../../blue_modules/musig2/finalize';
import {
  LocalMuSig2NonceState,
  createLocalMuSig2Round1Response,
  createLocalMuSig2Round2Response,
  getLocalMuSig2SignerMatches,
} from '../../blue_modules/musig2/local-signer';
import {
  getMuSig2NonceProgress,
  getMuSig2ParticipantSetsForInput,
  getMuSig2PublicNonces,
  mergeMuSig2Round1Psbt,
} from '../../blue_modules/musig2/psbt';
import {
  getMuSig2PartialSignatureProgress,
  getMuSig2PartialSignatures,
  getMuSig2Round2SignerPsbt,
  mergeMuSig2Round2Psbt,
} from '../../blue_modules/musig2/round2';
import { HDSegwitBech32Wallet } from '../../class/wallets/hd-segwit-bech32-wallet';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import presentAlert from '../../components/Alert';
import { BlueSpacing10, BlueSpacing20 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import Button from '../../components/Button';
import { DynamicQRCode } from '../../components/DynamicQRCode';
import Icon from '../../components/Icon';
import MuSig2SigningProgress, { MuSig2SignerProgressItem } from '../../components/MuSig2SigningProgress';
import SaveFileButton from '../../components/SaveFileButton';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';

type RouteParams = RouteProp<SendDetailsStackParamList, 'MuSig2Round1QRCode'>;
type NavigationProps = NativeStackNavigationProp<SendDetailsStackParamList, 'MuSig2Round1QRCode'>;
type FinalizationState = MuSig2PersistedFinalization;
type SignerMetadata = {
  publicKeyHex: string;
  xpub?: string;
  masterFingerprint?: string;
};

type ParticipantRecord = {
  inputIndex: number;
  participantPublicKey: Uint8Array;
};

function parseReturnedPsbt(data: string): bitcoin.Psbt {
  const payload = data.trim();
  try {
    return bitcoin.Psbt.fromHex(payload);
  } catch (_) {}

  try {
    return bitcoin.Psbt.fromBase64(payload);
  } catch (_) {}

  throw new Error('Scanned or imported data is not a valid PSBT');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function participantInputCount(records: ParticipantRecord[], publicKeyHex: string): number {
  return new Set(
    records.filter(record => bytesToHex(record.participantPublicKey) === publicKeyHex.toLowerCase()).map(record => record.inputIndex),
  ).size;
}

function discardLocalNonceStates(store: Map<string, LocalMuSig2NonceState[]>): void {
  for (const states of store.values()) {
    for (const state of states) {
      if (state.secretNonce.isConsumed()) continue;
      const material = state.secretNonce.consume();
      material.fill(0);
    }
  }
  store.clear();
}

function hasLiveLocalNonceStates(store: Map<string, LocalMuSig2NonceState[]>): boolean {
  for (const states of store.values()) {
    if (states.some(state => !state.secretNonce.isConsumed())) return true;
  }
  return false;
}

function isSyntheticDryRunPsbt(psbt: bitcoin.Psbt): boolean {
  try {
    const tx = bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
    return tx.ins.some(input => bytesToHex(new Uint8Array(input.hash).reverse()) === MUSIG2_DRY_RUN_FAKE_TXID);
  } catch {
    return false;
  }
}

function finalizationFromResult(result: ReturnType<typeof finalizeMuSig2Psbt>): FinalizationState {
  return {
    psbtBase64: result.psbt.toBase64(),
    rawTransactionHex: result.rawTransactionHex,
    txid: result.txid,
    verifiedPartialSignatures: result.verifiedPartialSignatures,
    finalSignatureCount: result.finalSignatures.length,
  };
}

function terminalTitle(state: MuSig2CoordinatorState): string {
  switch (state) {
    case 'CANCELLED':
      return 'Signing session cancelled';
    case 'NONCE_INVALIDATED':
      return 'Nonce session invalidated';
    case 'FAILED':
      return 'Signing session stopped';
    default:
      return 'Signing session stopped';
  }
}

const MuSig2Round1QRCode: React.FC = () => {
  const { colors } = useTheme();
  const { wallets } = useStorage();
  const navigation = useNavigation<NavigationProps>();
  const { params } = useRoute<RouteParams>();
  const { psbtBase64, walletID, onBarScanned, isDryRun: routeIsDryRun } = params;
  const dynamicQRCode = useRef<DynamicQRCode>(null);
  const persistenceWarningShown = useRef(false);
  const localRound1Running = useRef(false);
  const sessionClosing = useRef(false);
  const localNonceStates = useRef<Map<string, LocalMuSig2NonceState[]>>(new Map());
  const isFocused = useIsFocused();
  const [isSaving, setIsSaving] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isPreparingLocalNonces, setIsPreparingLocalNonces] = useState(false);
  const [isLocalSigning, setIsLocalSigning] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [coordinatorPsbtBase64, setCoordinatorPsbtBase64] = useState(psbtBase64);
  const [coordinatorState, setCoordinatorState] = useState<MuSig2CoordinatorState>('CREATED');
  const [lastError, setLastError] = useState<string>();
  const [finalization, setFinalization] = useState<FinalizationState>();

  const round1Psbt = useMemo(() => bitcoin.Psbt.fromBase64(psbtBase64), [psbtBase64]);
  const coordinatorPsbt = useMemo(() => bitcoin.Psbt.fromBase64(coordinatorPsbtBase64), [coordinatorPsbtBase64]);
  const nonceProgress = useMemo(() => getMuSig2NonceProgress(coordinatorPsbt), [coordinatorPsbt]);
  const partialSignatureProgress = useMemo(
    () => (nonceProgress.complete ? getMuSig2PartialSignatureProgress(coordinatorPsbt) : undefined),
    [coordinatorPsbt, nonceProgress.complete],
  );
  const round2SignerPsbt = useMemo(
    () => (nonceProgress.complete ? getMuSig2Round2SignerPsbt(coordinatorPsbt) : undefined),
    [coordinatorPsbt, nonceProgress.complete],
  );
  const phase: 1 | 2 | 3 = finalization ? 3 : nonceProgress.complete ? 2 : 1;
  const signingComplete = partialSignatureProgress?.complete ?? false;
  const blockedTerminalState =
    coordinatorState === 'CANCELLED' || coordinatorState === 'NONCE_INVALIDATED' || coordinatorState === 'FAILED';
  const isDryRun = routeIsDryRun === true || isSyntheticDryRunPsbt(round1Psbt);
  const signerFacingPsbt = phase === 2 && round2SignerPsbt ? round2SignerPsbt : round1Psbt;

  const muSig2Wallet = useMemo(
    () =>
      wallets.find(candidate => candidate.getID() === walletID && candidate.type === HDTaprootMuSig2Wallet.type) as
        | HDTaprootMuSig2Wallet
        | undefined,
    [walletID, wallets],
  );

  const localTaprootWallets = useMemo(
    () => wallets.filter(candidate => candidate.type === HDTaprootWallet.type) as HDTaprootWallet[],
    [wallets],
  );

  const signingParticipants = useMemo<SignerMetadata[]>(() => {
    if (muSig2Wallet) return muSig2Wallet.getParticipants();

    try {
      const participantSet = getMuSig2ParticipantSetsForInput(round1Psbt, 0)[0];
      return (participantSet?.participantPublicKeys ?? []).map(publicKey => ({ publicKeyHex: bytesToHex(publicKey) }));
    } catch {
      return [];
    }
  }, [muSig2Wallet, round1Psbt]);

  const localSignerMatches = useMemo(
    () => (muSig2Wallet ? getLocalMuSig2SignerMatches(muSig2Wallet, localTaprootWallets) : []),
    [localTaprootWallets, muSig2Wallet],
  );
  const localSignerIds = useMemo(
    () => new Set(localSignerMatches.map(match => match.participant.publicKeyHex.toLowerCase())),
    [localSignerMatches],
  );
  const localSignerByPublicKey = useMemo(
    () => new Map(localSignerMatches.map(match => [match.participant.publicKeyHex.toLowerCase(), match])),
    [localSignerMatches],
  );

  const nonceRecords = useMemo(() => getMuSig2PublicNonces(coordinatorPsbt), [coordinatorPsbt]);
  const partialSignatureRecords = useMemo(
    () => (nonceProgress.complete ? getMuSig2PartialSignatures(coordinatorPsbt) : []),
    [coordinatorPsbt, nonceProgress.complete],
  );

  const signerProgress = useMemo<MuSig2SignerProgressItem[]>(() => {
    return signingParticipants.map((participant, index) => {
      const publicKeyHex = participant.publicKeyHex.toLowerCase();
      const nonceInputs = participantInputCount(nonceRecords, publicKeyHex);
      const signatureInputs = participantInputCount(partialSignatureRecords, publicKeyHex);
      const localMatch = localSignerByPublicKey.get(publicKeyHex);
      const localReadyToPrepareNonce = Boolean(localMatch && phase === 1 && nonceInputs < round1Psbt.inputCount);
      const localReadyToSign = Boolean(localMatch && phase === 2 && signatureInputs < round1Psbt.inputCount);

      const subtitle = localMatch
        ? `${localMatch.wallet.getLabel()} · On this device`
        : participant.masterFingerprint
          ? `Fingerprint ${participant.masterFingerprint.toUpperCase()}`
          : `${publicKeyHex.slice(0, 12)}…`;
      const complete = phase === 1 ? nonceInputs === round1Psbt.inputCount : signatureInputs === round1Psbt.inputCount;

      return {
        id: publicKeyHex,
        title: `Vault Key ${index + 1}`,
        subtitle,
        complete,
        pendingLabel: localReadyToPrepareNonce ? 'Ready to prepare nonce' : localReadyToSign ? 'Ready to sign' : undefined,
        completeLabel: localMatch && phase === 1 ? 'Nonce prepared' : undefined,
      };
    });
  }, [localSignerByPublicKey, nonceRecords, partialSignatureRecords, phase, round1Psbt.inputCount, signingParticipants]);

  const completedSignerCount = signerProgress.filter(signer => signer.complete).length;
  const remainingExternalSignerCount = signerProgress.filter(
    signer => !signer.complete && !localSignerIds.has(signer.id.toLowerCase()),
  ).length;
  const pendingLocalRound1SignerCount = signerProgress.filter(
    signer => phase === 1 && !signer.complete && localSignerIds.has(signer.id.toLowerCase()),
  ).length;
  const pendingLocalSignerCount = signerProgress.filter(
    signer => phase === 2 && !signer.complete && localSignerIds.has(signer.id.toLowerCase()),
  ).length;
  const needsExternalSignerInteraction = remainingExternalSignerCount > 0;
  const needsLocalRound1Approval = pendingLocalRound1SignerCount > 0;
  const needsLocalRound2Approval = pendingLocalSignerCount > 0;

  const transitionTo = useCallback((nextState: MuSig2CoordinatorState, error?: string) => {
    setCoordinatorState(currentState => {
      try {
        return transitionMuSig2State(currentState, nextState);
      } catch (transitionError) {
        if (__DEV__) console.log('[MuSig2] invalid coordinator transition:', transitionError);
        return 'FAILED';
      }
    });
    setLastError(error);
  }, []);

  useEffect(() => {
    const nonceStates = localNonceStates.current;
    return () => {
      discardLocalNonceStates(nonceStates);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const stored = await loadMuSig2CoordinatorSession(walletID, round1Psbt);
        if (!mounted) return;

        if (!stored) {
          setCoordinatorState('COLLECTING_NONCES');
          setLastError(undefined);
          return;
        }

        const restoredPsbt = bitcoin.Psbt.fromBase64(stored.coordinatorPsbtBase64);
        setCoordinatorPsbtBase64(stored.coordinatorPsbtBase64);
        setLastError(stored.lastError);

        if (stored.state === 'FINALIZED') {
          const activeState = deriveMuSig2ActiveState(restoredPsbt);
          if (activeState !== 'SIGNATURES_COMPLETE') {
            throw new Error(`Stored finalized session has inconsistent coordinator state ${activeState}`);
          }
          const recomputed = finalizationFromResult(finalizeMuSig2Psbt(restoredPsbt));
          if (
            !stored.finalization ||
            stored.finalization.txid !== recomputed.txid ||
            stored.finalization.rawTransactionHex !== recomputed.rawTransactionHex
          ) {
            throw new Error('Stored MuSig2 final transaction does not match fresh cryptographic finalization');
          }
          setFinalization(recomputed);
          setCoordinatorState('FINALIZED');
          return;
        }

        if (isMuSig2TerminalState(stored.state)) {
          setCoordinatorState(stored.state);
          return;
        }

        setCoordinatorState(deriveMuSig2ActiveState(restoredPsbt));
      } catch (error: any) {
        if (!mounted) return;
        const message = `Could not safely restore the MuSig2 session: ${error?.message ?? String(error)}`;
        if (__DEV__) console.log('[MuSig2] session restore failed:', error);
        setCoordinatorPsbtBase64(psbtBase64);
        setCoordinatorState('FAILED');
        setFinalization(undefined);
        setLastError(message);
      } finally {
        if (mounted) setSessionReady(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [psbtBase64, round1Psbt, walletID]);

  useEffect(() => {
    if (!sessionReady || sessionClosing.current) return;

    saveMuSig2CoordinatorSession(
      walletID,
      round1Psbt,
      coordinatorState,
      coordinatorPsbtBase64,
      coordinatorState === 'FINALIZED' ? finalization : undefined,
      lastError,
    ).catch(error => {
      if (__DEV__) console.log('[MuSig2] coordinator persistence failed:', error);
      if (!persistenceWarningShown.current) {
        persistenceWarningShown.current = true;
        presentAlert({
          title: 'Signing session warning',
          message: 'BlueWallet could not save the current signing progress. Keep the app open until this session is complete.',
        });
      }
    });
  }, [coordinatorPsbtBase64, coordinatorState, finalization, lastError, round1Psbt, sessionReady, walletID]);

  useEffect(() => {
    setShowQr(false);
  }, [phase]);

  useEffect(() => {
    if (!sessionReady || blockedTerminalState || !showQr) {
      dynamicQRCode.current?.stopAutoMove();
      return;
    }
    if (isFocused) {
      dynamicQRCode.current?.forceUseBBQR();
      dynamicQRCode.current?.startAutoMove();
    } else {
      dynamicQRCode.current?.stopAutoMove();
    }
  }, [blockedTerminalState, isFocused, phase, sessionReady, showQr]);

  useEffect(() => {
    if (!sessionReady || blockedTerminalState || finalization || !muSig2Wallet || localSignerMatches.length === 0) return;

    const inputCount = coordinatorPsbt.inputCount;
    const currentNonces = getMuSig2PublicNonces(coordinatorPsbt);
    const currentPartials = getMuSig2NonceProgress(coordinatorPsbt).complete ? getMuSig2PartialSignatures(coordinatorPsbt) : [];

    for (const match of localSignerMatches) {
      const publicKeyHex = match.participant.publicKeyHex.toLowerCase();
      const nonceCount = participantInputCount(currentNonces, publicKeyHex);
      const partialCount = participantInputCount(currentPartials, publicKeyHex);
      const inMemoryNonces = localNonceStates.current.get(publicKeyHex);
      const hasUsableInMemoryNonces =
        inMemoryNonces?.length === inputCount && inMemoryNonces.every(state => !state.secretNonce.isConsumed());

      if ((nonceCount > 0 && nonceCount < inputCount) || (partialCount > 0 && partialCount < inputCount)) {
        const message = 'A local BlueWallet signer has incomplete MuSig2 session state. Start a fresh signing session.';
        discardLocalNonceStates(localNonceStates.current);
        setCoordinatorState('NONCE_INVALIDATED');
        setLastError(message);
        presentAlert({ title: 'Local MuSig2 signer', message });
        return;
      }

      if (nonceCount === inputCount && partialCount < inputCount && !hasUsableInMemoryNonces) {
        const message =
          'A local signer public nonce was restored without its one-time secret nonce. For safety, BlueWallet will not regenerate it. Start a fresh Round 1 session.';
        discardLocalNonceStates(localNonceStates.current);
        setCoordinatorState('NONCE_INVALIDATED');
        setLastError(message);
        presentAlert({ title: 'Local MuSig2 nonce expired', message });
        return;
      }
    }
  }, [blockedTerminalState, coordinatorPsbt, finalization, localSignerMatches, muSig2Wallet, sessionReady]);

  const prepareLocalRound1Nonces = useCallback(() => {
    if (blockedTerminalState || finalization || phase !== 1 || isPreparingLocalNonces || localRound1Running.current) return;

    localRound1Running.current = true;
    setIsPreparingLocalNonces(true);

    try {
      let workingPsbt = coordinatorPsbt;
      const inputCount = workingPsbt.inputCount;
      const currentNonces = getMuSig2PublicNonces(workingPsbt);
      const pendingMatches = localSignerMatches.filter(
        match => participantInputCount(currentNonces, match.participant.publicKeyHex) === 0,
      );

      if (pendingMatches.length === 0) return;

      for (const match of pendingMatches) {
        const response = createLocalMuSig2Round1Response(workingPsbt, match);
        workingPsbt = mergeMuSig2Round1Psbt(workingPsbt, response.psbt).psbt;
        localNonceStates.current.set(match.participant.publicKeyHex.toLowerCase(), response.nonces);
      }

      for (const match of pendingMatches) {
        const nonceCount = participantInputCount(getMuSig2PublicNonces(workingPsbt), match.participant.publicKeyHex);
        if (nonceCount !== inputCount) {
          throw new Error('Local MuSig2 Round 1 did not produce a complete nonce set for a local signer');
        }
      }

      setCoordinatorPsbtBase64(workingPsbt.toBase64());
      setCoordinatorState(deriveMuSig2ActiveState(workingPsbt));
      setLastError(undefined);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      discardLocalNonceStates(localNonceStates.current);
      if (__DEV__) console.log('[MuSig2] local Round 1 preparation failed:', error);
      setCoordinatorState('NONCE_INVALIDATED');
      setLastError(message);
      presentAlert({ title: 'Local MuSig2 signer stopped', message });
    } finally {
      localRound1Running.current = false;
      setIsPreparingLocalNonces(false);
    }
  }, [blockedTerminalState, coordinatorPsbt, finalization, isPreparingLocalNonces, localSignerMatches, phase]);

  const signWithBlueWallet = useCallback(() => {
    if (blockedTerminalState || finalization || phase !== 2 || isLocalSigning) return;

    setIsLocalSigning(true);
    try {
      let workingPsbt = coordinatorPsbt;
      const inputCount = workingPsbt.inputCount;
      const currentPartials = getMuSig2PartialSignatures(workingPsbt);
      const pendingMatches = localSignerMatches.filter(
        match => participantInputCount(currentPartials, match.participant.publicKeyHex) < inputCount,
      );

      if (pendingMatches.length === 0) return;

      for (const match of pendingMatches) {
        const publicKeyHex = match.participant.publicKeyHex.toLowerCase();
        const nonces = localNonceStates.current.get(publicKeyHex);
        if (!nonces || nonces.length !== inputCount || nonces.some(state => state.secretNonce.isConsumed())) {
          throw new Error('Local signer nonce state is unavailable. Start a fresh Round 1 signing session.');
        }

        const response = createLocalMuSig2Round2Response(workingPsbt, match, nonces);
        workingPsbt = mergeMuSig2Round2Psbt(workingPsbt, response).psbt;
        localNonceStates.current.delete(publicKeyHex);
      }

      setCoordinatorPsbtBase64(workingPsbt.toBase64());
      setCoordinatorState(deriveMuSig2ActiveState(workingPsbt));
      setLastError(undefined);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      discardLocalNonceStates(localNonceStates.current);
      if (__DEV__) console.log('[MuSig2] local Round 2 signing failed:', error);
      setCoordinatorState('NONCE_INVALIDATED');
      setLastError(message);
      presentAlert({ title: 'Local MuSig2 signing stopped', message });
    } finally {
      setIsLocalSigning(false);
    }
  }, [blockedTerminalState, coordinatorPsbt, finalization, isLocalSigning, localSignerMatches, phase]);

  const handleReturnedSignerPsbt = useCallback(
    (data: string) => {
      try {
        if (isMuSig2TerminalState(coordinatorState)) {
          throw new Error(`This MuSig2 signing session is ${coordinatorState.toLowerCase()}`);
        }

        const returnedPsbt = parseReturnedPsbt(data);
        const currentNonceProgress = getMuSig2NonceProgress(coordinatorPsbt);
        if (!currentNonceProgress.complete) {
          const result = mergeMuSig2Round1Psbt(coordinatorPsbt, returnedPsbt);
          setCoordinatorPsbtBase64(result.psbt.toBase64());
          if (result.complete) transitionTo('NONCES_COMPLETE');
          if (result.added === 0) {
            presentAlert({ title: 'Round 1', message: 'This signer nonce was already imported.' });
          }
          return;
        }

        const result = mergeMuSig2Round2Psbt(coordinatorPsbt, returnedPsbt);
        setCoordinatorPsbtBase64(result.psbt.toBase64());
        if (result.complete) {
          transitionTo('SIGNATURES_COMPLETE');
        } else if (result.added > 0 && coordinatorState === 'NONCES_COMPLETE') {
          transitionTo('COLLECTING_PARTIAL_SIGNATURES');
        }

        if (result.added === 0) {
          presentAlert({ title: 'Round 2', message: 'This partial signature was already imported.' });
        }
      } catch (error: any) {
        const message = error?.message ?? String(error);
        if (__DEV__) console.log('[MuSig2] returned signer PSBT rejected:', error);

        if (message.includes('Conflicting MuSig2 public nonce')) {
          transitionTo('NONCE_INVALIDATED', message);
        } else if (message.includes('Conflicting MuSig2 partial signature')) {
          transitionTo('FAILED', message);
        }

        presentAlert({
          title: nonceProgress.complete ? 'Round 2 response rejected' : 'Round 1 response rejected',
          message,
        });
      }
    },
    [coordinatorPsbt, coordinatorState, nonceProgress.complete, transitionTo],
  );

  useEffect(() => {
    if (!onBarScanned || !sessionReady) return;

    navigation.setParams({ onBarScanned: undefined });
    handleReturnedSignerPsbt(onBarScanned);
  }, [handleReturnedSignerPsbt, navigation, onBarScanned, sessionReady]);

  const importReturnedSignerPsbt = useCallback(() => {
    navigation.navigate('ScanQRCode', {
      launchedBy: 'MuSig2Round1QRCode',
      showFileImportButton: true,
    });
  }, [navigation]);

  const verifyAndFinalize = useCallback(() => {
    try {
      if (coordinatorState !== 'SIGNATURES_COMPLETE') {
        throw new Error(`MuSig2 cannot finalize from coordinator state ${coordinatorState}`);
      }
      const result = finalizeMuSig2Psbt(coordinatorPsbt);
      const nextFinalization = finalizationFromResult(result);
      setFinalization(nextFinalization);
      transitionTo('FINALIZED');
    } catch (error: any) {
      const message = error?.message ?? String(error);
      if (__DEV__) console.log('[MuSig2] finalization rejected:', error);
      transitionTo('FAILED', message);
      presentAlert({ title: 'Could not finalize MuSig2 transaction', message });
    }
  }, [coordinatorPsbt, coordinatorState, transitionTo]);

  const broadcastFinalTransaction = useCallback(async () => {
    if (!finalization || isDryRun || isBroadcasting) return;

    setIsBroadcasting(true);
    try {
      if (!(await BlueElectrum.ensureConnected())) {
        throw new Error('Could not connect to the Bitcoin network.');
      }
      const broadcaster = new HDSegwitBech32Wallet();
      const broadcasted = await broadcaster.broadcastTx(finalization.rawTransactionHex);
      if (!broadcasted) throw new Error('The transaction was not accepted for broadcast.');

      navigation.navigate('Success', {
        amount: 0,
        txid: finalization.txid,
      });
    } catch (error: any) {
      presentAlert({ title: 'Broadcast failed', message: error?.message ?? String(error) });
    } finally {
      setIsBroadcasting(false);
    }
  }, [finalization, isBroadcasting, isDryRun, navigation]);

  const returnToWalletView = useCallback(() => {
    const parent = navigation.getParent();
    if (parent?.canGoBack()) {
      parent.goBack();
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const persistAndCloseSession = useCallback(
    async (resetToFreshRound1: boolean) => {
      if (sessionClosing.current) return;
      sessionClosing.current = true;
      dynamicQRCode.current?.stopAutoMove();

      try {
        if (resetToFreshRound1) {
          discardLocalNonceStates(localNonceStates.current);
          await saveMuSig2CoordinatorSession(
            walletID,
            round1Psbt,
            'COLLECTING_NONCES',
            psbtBase64,
            undefined,
            'Local one-time nonce state was discarded when the session was closed. Fresh Round 1 is required.',
          );
        } else {
          await saveMuSig2CoordinatorSession(
            walletID,
            round1Psbt,
            coordinatorState,
            coordinatorPsbtBase64,
            coordinatorState === 'FINALIZED' ? finalization : undefined,
            lastError,
          );
          discardLocalNonceStates(localNonceStates.current);
        }
        returnToWalletView();
      } catch (error: any) {
        sessionClosing.current = false;
        presentAlert({ title: 'Could not close MuSig2 session', message: error?.message ?? String(error) });
      }
    },
    [coordinatorPsbtBase64, coordinatorState, finalization, lastError, psbtBase64, returnToWalletView, round1Psbt, walletID],
  );

  const closeSigningSession = useCallback(() => {
    if (hasLiveLocalNonceStates(localNonceStates.current)) {
      presentAlert({
        title: 'Close session and reset Round 1?',
        message:
          'This session has a local BlueWallet one-time nonce that exists only in memory. Closing cannot safely preserve that nonce. The transaction will remain pending, but signing progress will reset to fresh Round 1.',
        buttons: [
          { text: 'Keep signing', style: 'cancel' },
          {
            text: 'Close & reset Round 1',
            onPress: () => {
              void persistAndCloseSession(true);
            },
          },
        ],
      });
      return;
    }

    void persistAndCloseSession(false);
  }, [persistAndCloseSession]);

  const restartSigningSession = useCallback(async () => {
    try {
      localRound1Running.current = false;
      discardLocalNonceStates(localNonceStates.current);
      setIsPreparingLocalNonces(false);
      setIsLocalSigning(false);
      await clearMuSig2CoordinatorSession(walletID, round1Psbt);
      setCoordinatorPsbtBase64(psbtBase64);
      setFinalization(undefined);
      setLastError(undefined);
      setShowQr(false);
      setCoordinatorState(currentState =>
        currentState === 'FINALIZED' ? 'COLLECTING_NONCES' : transitionMuSig2State(currentState, 'COLLECTING_NONCES'),
      );
      presentAlert({
        title: 'Fresh signing session started',
        message:
          'Discard the old signer session and generate fresh Round 1 nonces on every external signer. Local BlueWallet signers will wait for you to tap Sign with BlueWallet before preparing fresh nonces.',
      });
    } catch (error: any) {
      presentAlert({ title: 'Could not restart MuSig2 session', message: error?.message ?? String(error) });
    }
  }, [psbtBase64, round1Psbt, walletID]);

  const beforeExportPsbt = useCallback(async () => {
    dynamicQRCode.current?.stopAutoMove();
    setIsSaving(true);
  }, []);

  const afterExportPsbt = useCallback(() => {
    setIsSaving(false);
    if (showQr) dynamicQRCode.current?.startAutoMove();
  }, [showQr]);

  const helperText = useMemo(() => {
    if (isPreparingLocalNonces) {
      return 'BlueWallet is preparing fresh Round 1 nonces for the local Vault Keys. Secret nonces remain only in memory.';
    }
    if (isLocalSigning) {
      return 'BlueWallet is signing Round 2 with the local Vault Keys and verifying each partial signature.';
    }

    if (phase === 1) {
      if (localSignerMatches.length > 0) {
        if (needsLocalRound1Approval && needsExternalSignerInteraction) {
          return `Review the transaction above, then tap Sign with BlueWallet to prepare ${pendingLocalRound1SignerCount} local Round 1 nonce${pendingLocalRound1SignerCount === 1 ? '' : 's'}. Use the Round 1 QR or file for the remaining external signer${remainingExternalSignerCount === 1 ? '' : 's'}.`;
        }
        if (needsLocalRound1Approval) {
          return `Review the transaction above, then tap Sign with BlueWallet to prepare ${pendingLocalRound1SignerCount} local Round 1 nonce${pendingLocalRound1SignerCount === 1 ? '' : 's'}. No transaction signature is created in Round 1.`;
        }
        if (needsExternalSignerInteraction) {
          return `Local Round 1 nonce${localSignerMatches.length === 1 ? ' is' : 's are'} prepared. Use the Round 1 QR or file for the remaining external signer${remainingExternalSignerCount === 1 ? '' : 's'}.`;
        }
      }
      return 'Show the same Round 1 PSBT to each signer, then import each response.';
    }

    if (signingComplete) return 'All partial signatures are collected. Verify and finalize the transaction.';
    if (needsLocalRound2Approval) {
      if (needsExternalSignerInteraction) {
        return `Round 1 complete. Local nonces are prepared. Review the transaction, then tap Sign with BlueWallet to authorize ${pendingLocalSignerCount} local signer${pendingLocalSignerCount === 1 ? '' : 's'}. External signers can use the frozen Round 2 PSBT independently.`;
      }
      return `Round 1 complete. Local nonces are prepared. Review the transaction, then tap Sign with BlueWallet to authorize ${pendingLocalSignerCount} local signer${pendingLocalSignerCount === 1 ? '' : 's'}.`;
    }
    return 'Use the frozen Round 2 PSBT for every remaining external signer.';
  }, [
    isLocalSigning,
    isPreparingLocalNonces,
    localSignerMatches.length,
    needsExternalSignerInteraction,
    needsLocalRound1Approval,
    needsLocalRound2Approval,
    pendingLocalRound1SignerCount,
    pendingLocalSignerCount,
    phase,
    remainingExternalSignerCount,
    signingComplete,
  ]);

  const stylesHook = StyleSheet.create({
    root: { backgroundColor: colors.elevated },
    subtitle: { color: colors.alternativeTextColor },
    helper: { color: colors.alternativeTextColor },
    helperCard: { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor },
    secondaryButton: { backgroundColor: colors.buttonDisabledBackgroundColor },
    secondaryButtonText: { color: colors.foregroundColor },
    closeSessionText: { color: colors.newBlue },
    warningCard: { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor },
    warning: { color: colors.redText },
    successCard: { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor },
    successIcon: { backgroundColor: colors.receiveBackground },
  });

  if (!sessionReady) {
    return (
      <View style={[styles.loading, stylesHook.root]}>
        <ActivityIndicator color={colors.newBlue} />
        <BlueText style={[styles.loadingText, stylesHook.subtitle]}>Restoring signing session…</BlueText>
      </View>
    );
  }

  if (blockedTerminalState) {
    return (
      <ScrollView style={stylesHook.root} contentContainerStyle={styles.container}>
        <View style={[styles.warningCard, stylesHook.warningCard]}>
          <View style={[styles.stateIcon, { backgroundColor: colors.redBG }]}>
            <Icon name="exclamation" type="font-awesome" size={18} color={colors.redText} />
          </View>
          <BlueText h4 style={styles.centerText}>
            {terminalTitle(coordinatorState)}
          </BlueText>
          <BlueText style={[styles.stateMessage, stylesHook.helper]}>
            This signing session cannot be reused. Start a fresh session only after discarding the old signer nonce state.
          </BlueText>
          {lastError ? <BlueText style={[styles.stateMessage, stylesHook.warning]}>{lastError}</BlueText> : null}
        </View>
        <BlueSpacing20 />
        <Button
          testID="MuSig2RestartSession"
          title="Start fresh MuSig2 session"
          onPress={restartSigningSession}
          backgroundColor={colors.newBlue}
          buttonTextColor={colors.inverseForegroundColor}
        />
      </ScrollView>
    );
  }

  if (finalization) {
    return (
      <ScrollView style={stylesHook.root} contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <BlueText h4>MuSig2 Signing</BlueText>
          <BlueText style={[styles.subtitle, stylesHook.subtitle]}>{isDryRun ? 'Signing test complete' : 'Ready to broadcast'}</BlueText>
        </View>

        <MuSig2SigningProgress
          phase={3}
          collected={signerProgress.length}
          expected={signerProgress.length}
          label="Signatures verified"
          signers={signerProgress.map(signer => ({ ...signer, complete: true }))}
        />

        <View style={[styles.successCard, stylesHook.successCard]}>
          <View style={[styles.stateIcon, stylesHook.successIcon]}>
            <Icon name="check" type="font-awesome" size={18} color={colors.successColor} />
          </View>
          <BlueText bold style={styles.centerText}>
            {isDryRun ? 'MuSig2 signing works' : 'Transaction finalized'}
          </BlueText>
          <BlueText style={[styles.stateMessage, stylesHook.helper]}>
            {isDryRun
              ? 'No bitcoin was spent. This test uses a nonexistent input and cannot be broadcast.'
              : 'All signer responses were verified and the final Taproot signature is ready for broadcast.'}
          </BlueText>
          {!isDryRun && (
            <BlueText selectable style={[styles.txid, stylesHook.helper]}>
              {finalization.txid}
            </BlueText>
          )}
        </View>

        <BlueSpacing20 />
        {isDryRun ? (
          <Button
            testID="MuSig2RestartFinalizedSession"
            title="Start another signing test"
            onPress={restartSigningSession}
            backgroundColor={colors.newBlue}
            buttonTextColor={colors.inverseForegroundColor}
          />
        ) : (
          <>
            <Button
              testID="MuSig2BroadcastTransaction"
              title="Broadcast transaction"
              onPress={broadcastFinalTransaction}
              showActivityIndicator={isBroadcasting}
              disabled={isBroadcasting}
              backgroundColor={colors.newBlue}
              buttonTextColor={colors.inverseForegroundColor}
            />
            <BlueSpacing10 />
            <SaveFileButton
              fileName={`${Date.now()}-musig2-final-transaction.hex`}
              fileContent={finalization.rawTransactionHex}
              style={[styles.fileButton, stylesHook.secondaryButton]}
            >
              <View style={styles.fileButtonContent}>
                <Icon name="download" type="font-awesome" size={15} color={colors.foregroundColor} />
                <BlueText style={[styles.fileButtonText, stylesHook.secondaryButtonText]}>Export raw transaction</BlueText>
              </View>
            </SaveFileButton>
          </>
        )}

        <TouchableOpacity
          testID="MuSig2CloseSession"
          accessibilityRole="button"
          onPress={closeSigningSession}
          style={styles.closeSessionButton}
        >
          <BlueText style={[styles.closeSessionText, stylesHook.closeSessionText]}>Close session</BlueText>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      automaticallyAdjustContentInsets
      contentInsetAdjustmentBehavior="automatic"
      style={stylesHook.root}
      contentContainerStyle={styles.container}
      testID="MuSig2Round1QRCodeScrollView"
    >
      <View style={styles.header}>
        <BlueText h4>MuSig2 Signing</BlueText>
        <BlueText style={[styles.subtitle, stylesHook.subtitle]}>
          {phase === 1 ? 'Collect public nonces' : needsLocalRound2Approval ? 'Authorize local signatures' : 'Collect partial signatures'}
        </BlueText>
      </View>

      <MuSig2SigningProgress
        phase={phase}
        collected={completedSignerCount}
        expected={signerProgress.length}
        label={phase === 1 ? 'Nonces collected' : 'Partial signatures'}
        signers={signerProgress}
      />

      <View style={[styles.helperCard, stylesHook.helperCard]}>
        <Icon name="info-circle" type="font-awesome" size={17} color={colors.newBlue} />
        <BlueText style={[styles.helperText, stylesHook.helper]}>{helperText}</BlueText>
      </View>

      {(isPreparingLocalNonces || isLocalSigning) && (
        <View style={styles.localSigningProgress}>
          <ActivityIndicator color={colors.newBlue} />
          <BlueText style={[styles.localSigningText, stylesHook.helper]}>
            {isPreparingLocalNonces ? 'Preparing local Round 1 nonces…' : 'Signing local Vault Keys…'}
          </BlueText>
        </View>
      )}

      {phase === 1 && needsLocalRound1Approval && (
        <>
          <BlueSpacing20 />
          <Button
            testID="MuSig2PrepareRound1WithBlueWallet"
            title="Sign with BlueWallet"
            onPress={prepareLocalRound1Nonces}
            showActivityIndicator={isPreparingLocalNonces}
            disabled={isPreparingLocalNonces}
            icon={{ name: 'pencil', type: 'font-awesome', color: colors.inverseForegroundColor }}
            backgroundColor={colors.newBlue}
            buttonTextColor={colors.inverseForegroundColor}
          />
          <BlueText style={[styles.localApprovalNote, stylesHook.helper]}>
            Round 1 prepares fresh one-time nonces only. BlueWallet will not create them automatically, and no transaction signature is created until Round 2.
          </BlueText>
        </>
      )}

      {phase === 2 && needsLocalRound2Approval && !isPreparingLocalNonces && (
        <>
          <BlueSpacing20 />
          <Button
            testID="MuSig2SignWithBlueWallet"
            title="Sign with BlueWallet"
            onPress={signWithBlueWallet}
            showActivityIndicator={isLocalSigning}
            disabled={isLocalSigning}
            icon={{ name: 'check-circle', type: 'font-awesome', color: colors.inverseForegroundColor }}
            backgroundColor={colors.newBlue}
            buttonTextColor={colors.inverseForegroundColor}
          />
          <BlueText style={[styles.localApprovalNote, stylesHook.helper]}>
            This authorizes Round 2 for every matching signer stored in this BlueWallet installation. Round 1 nonces are not regenerated.
          </BlueText>
        </>
      )}

      {needsExternalSignerInteraction && !isPreparingLocalNonces && !isLocalSigning && (
        <>
          <BlueSpacing20 />
          <Button
            testID="MuSig2ToggleSignerQr"
            title={showQr ? `Hide Round ${phase} QR` : `Show Round ${phase} QR`}
            onPress={() => setShowQr(current => !current)}
            icon={{ name: 'qrcode', type: 'font-awesome', color: colors.inverseForegroundColor }}
            backgroundColor={colors.newBlue}
            buttonTextColor={colors.inverseForegroundColor}
          />

          {showQr && (
            <View style={styles.qrSection}>
              <DynamicQRCode
                key={`musig2-round-${phase}`}
                value={signerFacingPsbt.toHex()}
                ref={dynamicQRCode}
                walletID={walletID}
                hideControls={false}
              />
            </View>
          )}

          <BlueSpacing10 />
          <Button
            testID="MuSig2ImportReturnedSignerPsbt"
            title={phase === 1 ? 'Import signer response' : 'Import signed PSBT'}
            onPress={importReturnedSignerPsbt}
            icon={{ name: 'upload', type: 'font-awesome', color: colors.foregroundColor }}
            backgroundColor={colors.buttonDisabledBackgroundColor}
            buttonTextColor={colors.foregroundColor}
          />

          <BlueSpacing10 />
          {isSaving ? (
            <ActivityIndicator color={colors.newBlue} />
          ) : (
            <SaveFileButton
              fileName={`${Date.now()}-musig2-round${phase}-signer.psbt`}
              fileContent={signerFacingPsbt.toBase64()}
              beforeOnPress={beforeExportPsbt}
              afterOnPress={afterExportPsbt}
              style={[styles.fileButton, stylesHook.secondaryButton]}
            >
              <View style={styles.fileButtonContent}>
                <Icon name="download" type="font-awesome" size={15} color={colors.foregroundColor} />
                <BlueText style={[styles.fileButtonText, stylesHook.secondaryButtonText]}>Export PSBT file</BlueText>
              </View>
            </SaveFileButton>
          )}
        </>
      )}

      {phase === 2 && (
        <>
          <BlueSpacing20 />
          <Button
            testID="MuSig2VerifyAndFinalize"
            title="Verify & Finalize"
            onPress={verifyAndFinalize}
            disabled={!signingComplete || isLocalSigning || needsLocalRound2Approval}
            icon={{
              name: 'check-circle',
              type: 'font-awesome',
              color: signingComplete ? colors.inverseForegroundColor : colors.buttonDisabledTextColor,
            }}
            backgroundColor={colors.newBlue}
            buttonTextColor={colors.inverseForegroundColor}
          />
        </>
      )}

      <TouchableOpacity
        testID="MuSig2CloseSession"
        accessibilityRole="button"
        onPress={closeSigningSession}
        style={styles.closeSessionButton}
      >
        <BlueText style={[styles.closeSessionText, stylesHook.closeSessionText]}>Close session</BlueText>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  loadingText: { marginTop: 12, textAlign: 'center' },
  header: { alignItems: 'center', marginBottom: 22 },
  subtitle: { marginTop: 5, fontSize: 14 },
  helperCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  helperText: { flex: 1, marginLeft: 10, fontSize: 13, lineHeight: 19 },
  localSigningProgress: { marginTop: 18, alignItems: 'center', justifyContent: 'center' },
  localSigningText: { marginTop: 8, fontSize: 13 },
  localApprovalNote: { marginTop: 9, paddingHorizontal: 8, textAlign: 'center', fontSize: 12, lineHeight: 17 },
  qrSection: { marginTop: 18, alignItems: 'center' },
  fileButton: { minHeight: 48, borderRadius: 24, justifyContent: 'center', paddingHorizontal: 16 },
  fileButtonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  fileButtonText: { marginLeft: 8, fontSize: 15, fontWeight: '600' },
  closeSessionButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 18 },
  closeSessionText: { fontSize: 14, fontWeight: '600' },
  warningCard: { borderWidth: 1, borderRadius: 14, padding: 18, alignItems: 'center' },
  successCard: { borderWidth: 1, borderRadius: 14, padding: 18, alignItems: 'center' },
  stateIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  centerText: { textAlign: 'center' },
  stateMessage: { textAlign: 'center', marginTop: 8, fontSize: 13, lineHeight: 19 },
  txid: { textAlign: 'center', marginTop: 12, fontSize: 11, lineHeight: 16 },
});

export default MuSig2Round1QRCode;
