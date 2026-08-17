import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as bitcoin from 'bitcoinjs-lib';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

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
import { finalizeMuSig2Psbt } from '../../blue_modules/musig2/finalize';
import {
  getMuSig2NonceProgress,
  mergeMuSig2Round1Psbt,
  PSBT_IN_MUSIG2_PARTIAL_SIG,
  PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS,
  PSBT_IN_MUSIG2_PUB_NONCE,
} from '../../blue_modules/musig2/psbt';
import {
  getMuSig2PartialSignatureProgress,
  getMuSig2Round2SignerPsbt,
  mergeMuSig2Round2Psbt,
} from '../../blue_modules/musig2/round2';
import presentAlert from '../../components/Alert';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import { DynamicQRCode } from '../../components/DynamicQRCode';
import SaveFileButton from '../../components/SaveFileButton';
import { SquareButton } from '../../components/SquareButton';
import TipBox from '../../components/TipBox';
import { useTheme } from '../../components/themes';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';

type RouteParams = RouteProp<SendDetailsStackParamList, 'MuSig2Round1QRCode'>;
type NavigationProps = NativeStackNavigationProp<SendDetailsStackParamList, 'MuSig2Round1QRCode'>;
type FinalizationState = MuSig2PersistedFinalization;

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

function compactHex(bytes: Uint8Array, maxCharacters = 160): string {
  const hex = bytesToHex(bytes);
  return hex.length <= maxCharacters ? hex : `${hex.slice(0, maxCharacters)}... (${bytes.length} bytes)`;
}

function describeReturnedPsbt(returnedPsbt: bitcoin.Psbt, originalPsbt: bitcoin.Psbt): string {
  const returnedTx = bytesToHex(returnedPsbt.data.globalMap.unsignedTx.toBuffer());
  const originalTx = bytesToHex(originalPsbt.data.globalMap.unsignedTx.toBuffer());
  const globalXpubs = returnedPsbt.data.globalMap.globalXpub ?? [];
  const lines = [
    `Unsigned transaction: ${returnedTx === originalTx ? 'UNCHANGED' : 'CHANGED'}`,
    `Global XPUB records: ${globalXpubs.length}`,
  ];

  globalXpubs.forEach((item, index) => {
    lines.push(
      `  XPUB ${index + 1}: fp=${bytesToHex(item.masterFingerprint)} path=${item.path} extendedPubkeyBytes=${item.extendedPubkey.length}`,
    );
  });

  returnedPsbt.data.inputs.forEach((input, inputIndex) => {
    const unknown = input.unknownKeyVals ?? [];
    const participantFields = unknown.filter(item => item.key[0] === PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS);
    const nonceFields = unknown.filter(item => item.key[0] === PSBT_IN_MUSIG2_PUB_NONCE);
    const partialSigFields = unknown.filter(item => item.key[0] === PSBT_IN_MUSIG2_PARTIAL_SIG);
    const tapDerivations = input.tapBip32Derivation ?? [];

    lines.push(`Input ${inputIndex}:`);
    lines.push(`  BIP373 0x1a participant fields: ${participantFields.length}`);
    lines.push(`  BIP373 0x1b public nonce fields: ${nonceFields.length}`);
    lines.push(`  BIP373 0x1c partial signature fields: ${partialSigFields.length}`);
    lines.push(`  Taproot key signature: ${input.tapKeySig ? `present (${input.tapKeySig.length} bytes)` : 'absent'}`);
    lines.push(`  Taproot internal key: ${input.tapInternalKey ? compactHex(input.tapInternalKey) : 'absent'}`);
    lines.push(`  Taproot BIP32 derivations: ${tapDerivations.length}`);

    tapDerivations.forEach((item, index) => {
      lines.push(
        `    derivation ${index + 1}: pubkey=${compactHex(item.pubkey)} fp=${bytesToHex(item.masterFingerprint)} path=${item.path} leafHashes=${item.leafHashes.length}`,
      );
    });

    lines.push(`  Unknown input records: ${unknown.length}`);
    unknown.forEach((item, index) => {
      const type = `0x${item.key[0].toString(16).padStart(2, '0')}`;
      lines.push(
        `    ${index + 1}. type=${type} keyLen=${item.key.length} valueLen=${item.value.length} key=${compactHex(item.key)} value=${compactHex(item.value)}`,
      );
    });
  });

  return lines.join('\n');
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
      return 'MuSig2 session cancelled';
    case 'NONCE_INVALIDATED':
      return 'MuSig2 nonce session invalidated';
    case 'FAILED':
      return 'MuSig2 session failed';
    default:
      return 'MuSig2 session stopped';
  }
}

const MuSig2Round1QRCode: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { params } = useRoute<RouteParams>();
  const { psbtBase64, walletID, onBarScanned } = params;
  const dynamicQRCode = useRef<DynamicQRCode>(null);
  const persistenceWarningShown = useRef(false);
  const isFocused = useIsFocused();
  const [isSaving, setIsSaving] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [coordinatorPsbtBase64, setCoordinatorPsbtBase64] = useState(psbtBase64);
  const [coordinatorState, setCoordinatorState] = useState<MuSig2CoordinatorState>('CREATED');
  const [lastError, setLastError] = useState<string>();
  const [returnedPsbtDebug, setReturnedPsbtDebug] = useState<string>();
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
  const finalizedPsbt = useMemo(
    () => (finalization ? bitcoin.Psbt.fromBase64(finalization.psbtBase64) : undefined),
    [finalization],
  );
  const displayedPsbt = finalizedPsbt ?? round2SignerPsbt ?? round1Psbt;
  const phase = finalization ? 3 : nonceProgress.complete ? 2 : 1;
  const signingComplete = partialSignatureProgress?.complete ?? false;
  const blockedTerminalState =
    coordinatorState === 'CANCELLED' || coordinatorState === 'NONCE_INVALIDATED' || coordinatorState === 'FAILED';

  const hasBip373Participants = useMemo(
    () =>
      round1Psbt.data.inputs.length > 0 &&
      round1Psbt.data.inputs.every(input =>
        input.unknownKeyVals?.some(item => item.key[0] === PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS),
      ),
    [round1Psbt],
  );

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

        // The PSBT is the source of truth for active progress. This also
        // cryptographically re-verifies every persisted partial signature.
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
    if (!sessionReady) return;

    saveMuSig2CoordinatorSession(
      walletID,
      round1Psbt,
      coordinatorState,
      coordinatorPsbtBase64,
      finalization,
      lastError,
    ).catch(error => {
      if (__DEV__) console.log('[MuSig2] coordinator persistence failed:', error);
      if (!persistenceWarningShown.current) {
        persistenceWarningShown.current = true;
        presentAlert({
          title: 'MuSig2 session persistence warning',
          message:
            'BlueWallet could not save the current coordinator session. Keep the app open and export the current PSBT before continuing.',
        });
      }
    });
  }, [coordinatorPsbtBase64, coordinatorState, finalization, lastError, round1Psbt, sessionReady, walletID]);

  useEffect(() => {
    if (!sessionReady || blockedTerminalState) {
      dynamicQRCode.current?.stopAutoMove();
      return;
    }
    if (isFocused) {
      dynamicQRCode.current?.forceUseBBQR();
      dynamicQRCode.current?.startAutoMove();
    } else {
      dynamicQRCode.current?.stopAutoMove();
    }
  }, [blockedTerminalState, isFocused, phase, sessionReady]);

  const handleReturnedSignerPsbt = useCallback(
    (data: string) => {
      try {
        if (isMuSig2TerminalState(coordinatorState)) {
          throw new Error(`This MuSig2 signing session is ${coordinatorState.toLowerCase()}`);
        }

        const returnedPsbt = parseReturnedPsbt(data);
        if (__DEV__) {
          const debug = describeReturnedPsbt(returnedPsbt, round1Psbt);
          setReturnedPsbtDebug(debug);
          console.log('[MuSig2] returned signer PSBT diagnostics:\n' + debug);
          console.log('[MuSig2] returned signer PSBT base64:', returnedPsbt.toBase64());
        }

        const currentNonceProgress = getMuSig2NonceProgress(coordinatorPsbt);
        if (!currentNonceProgress.complete) {
          const result = mergeMuSig2Round1Psbt(coordinatorPsbt, returnedPsbt);
          setCoordinatorPsbtBase64(result.psbt.toBase64());
          if (result.complete) transitionTo('NONCES_COMPLETE');
          if (result.added === 0) {
            presentAlert({ title: 'MuSig2 Round 1', message: 'This public nonce was already imported.' });
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
          presentAlert({ title: 'MuSig2 Round 2', message: 'This partial signature was already imported.' });
        } else if (result.complete) {
          presentAlert({
            title: 'MuSig2 Round 2 complete',
            message: 'All expected and cryptographically valid BIP373 partial signatures have been collected.',
          });
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
          title: nonceProgress.complete ? 'MuSig2 Round 2 rejected' : 'MuSig2 Round 1 rejected',
          message,
        });
      }
    },
    [coordinatorPsbt, coordinatorState, nonceProgress.complete, round1Psbt, transitionTo],
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
      presentAlert({
        title: 'MuSig2 finalized',
        message: `Verified ${result.verifiedPartialSignatures} partial signatures and created ${result.finalSignatures.length} valid BIP340 Schnorr signature(s).`,
      });
    } catch (error: any) {
      const message = error?.message ?? String(error);
      if (__DEV__) console.log('[MuSig2] finalization rejected:', error);
      transitionTo('FAILED', message);
      presentAlert({ title: 'MuSig2 finalization rejected', message });
    }
  }, [coordinatorPsbt, coordinatorState, transitionTo]);

  const cancelSigningSession = useCallback(() => {
    presentAlert({
      title: 'Cancel MuSig2 signing session?',
      message:
        'Any collected nonce session will be abandoned. To sign again, start a fresh session and make each hardware signer generate fresh nonces.',
      buttons: [
        { text: 'Keep signing', style: 'cancel' },
        {
          text: 'Cancel session',
          style: 'destructive',
          onPress: () => transitionTo('CANCELLED', 'Signing session cancelled by user'),
        },
      ],
    });
  }, [transitionTo]);

  const restartSigningSession = useCallback(async () => {
    try {
      await clearMuSig2CoordinatorSession(walletID, round1Psbt);
      setCoordinatorPsbtBase64(psbtBase64);
      setFinalization(undefined);
      setReturnedPsbtDebug(undefined);
      setLastError(undefined);
      setCoordinatorState(currentState => transitionMuSig2State(currentState, 'COLLECTING_NONCES'));
      presentAlert({
        title: 'Fresh MuSig2 session started',
        message:
          'Discard the old signer session. If a COLDCARD generated a nonce in the previous session, restart that signer before creating the new Round 1 nonce.',
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
    dynamicQRCode.current?.startAutoMove();
  }, []);

  const stylesHook = StyleSheet.create({
    root: { backgroundColor: colors.elevated },
    warning: { color: colors.redText },
    exportButton: { backgroundColor: colors.buttonDisabledBackgroundColor },
  });

  if (!sessionReady) {
    return (
      <View style={[styles.loading, stylesHook.root]}>
        <ActivityIndicator />
        <BlueText style={styles.loadingText}>Restoring and validating MuSig2 signing session…</BlueText>
      </View>
    );
  }

  return (
    <ScrollView
      centerContent
      automaticallyAdjustContentInsets
      contentInsetAdjustmentBehavior="automatic"
      style={stylesHook.root}
      contentContainerStyle={styles.container}
      testID="MuSig2Round1QRCodeScrollView"
    >
      {blockedTerminalState ? (
        <TipBox
          number="!"
          title={terminalTitle(coordinatorState)}
          description="Signer QR, export, import, and finalization controls are disabled so this session cannot be reused accidentally."
          additionalDescription="Start a fresh session only after discarding the previous hardware-signer nonce state."
        />
      ) : finalization ? (
        <TipBox
          number="3"
          title="MuSig2 finalized"
          description="BlueWallet cryptographically verified every BIP373 partial signature, aggregated the final BIP340 Schnorr signature, finalized the Taproot key-path witness, and re-verified the completed witness."
          additionalDescription="This experimental dry-run transaction uses a nonexistent input. Broadcast remains intentionally unavailable."
        />
      ) : nonceProgress.complete ? (
        <TipBox
          number="2"
          title={signingComplete ? 'MuSig2 Round 2: partial signatures complete' : 'MuSig2 Round 2: collect partial signatures'}
          description={
            signingComplete
              ? 'BlueWallet has already cryptographically verified every imported BIP373 partial signature. Final aggregation performs a second verification pass.'
              : 'Give this same frozen Round 2 PSBT to either signer by scanning the BBQr or exporting the signer PSBT file. Import each signed response by QR/BBQr or file.'
          }
          additionalDescription="Keep each COLDCARD that created a nonce powered on until it has produced its Round 2 partial signature."
        />
      ) : (
        <TipBox
          number="1"
          title="MuSig2 Round 1: collect public nonces"
          description="Give the same clean Round 1 PSBT to either signer by scanning the BBQr below or exporting the signer PSBT file. Import each returned signer PSBT by QR/BBQr or file."
          additionalDescription="Do not move to Round 2 until BlueWallet reports NONCES_COMPLETE. Keep any COLDCARD that produced a nonce powered on until Round 2 is finished."
        />
      )}

      {!hasBip373Participants && (
        <BlueText style={[styles.warning, stylesHook.warning]}>
          Warning: this PSBT is missing BIP373 participant fields and must not be used for MuSig2 signing.
        </BlueText>
      )}

      {!blockedTerminalState && (
        <DynamicQRCode
          key={`musig2-round-${phase}`}
          value={displayedPsbt.toHex()}
          ref={dynamicQRCode}
          walletID={walletID}
          hideControls={false}
        />
      )}

      <View style={styles.details}>
        <BlueText bold>Coordinator state</BlueText>
        <BlueText>{coordinatorState}</BlueText>
        <BlueText>Inputs: {displayedPsbt.inputCount}</BlueText>
        <BlueText>
          BIP373 public nonces: {nonceProgress.collected}/{nonceProgress.expected}
        </BlueText>
        {partialSignatureProgress && (
          <BlueText>
            BIP373 partial signatures: {partialSignatureProgress.collected}/{partialSignatureProgress.expected}
          </BlueText>
        )}
        {finalization && (
          <>
            <BlueText>Cryptographically verified partial signatures: {finalization.verifiedPartialSignatures}</BlueText>
            <BlueText>Final BIP340 signatures: {finalization.finalSignatureCount}</BlueText>
            <BlueText selectable>TXID: {finalization.txid}</BlueText>
          </>
        )}
        {lastError && <BlueText style={[styles.warning, stylesHook.warning]}>{lastError}</BlueText>}
        <BlueText>BIP373 participants: {hasBip373Participants ? 'present' : 'missing'}</BlueText>
        <BlueText>Session persistence: public coordinator state only</BlueText>
        <BlueText>Transport: BBQr QR or PSBT file, either signer</BlueText>
      </View>

      {blockedTerminalState && (
        <>
          <BlueSpacing20 />
          <SquareButton
            testID="MuSig2RestartSession"
            title="Start fresh MuSig2 session"
            onPress={restartSigningSession}
            style={[styles.exportButton, stylesHook.exportButton]}
          />
        </>
      )}

      {!blockedTerminalState && !signingComplete && !finalization && (
        <View style={styles.signerTransport}>
          <BlueText bold>Signer transport</BlueText>
          <BlueText style={styles.signerHint}>
            {phase === 1
              ? 'The exported Round 1 PSBT is signer-agnostic. Use the same file for Signer 1 or Signer 2.'
              : 'The exported Round 2 PSBT is signer-agnostic and frozen to the complete nonce set. Use the same file for either signer.'}
          </BlueText>
          {isSaving ? (
            <ActivityIndicator />
          ) : (
            <SaveFileButton
              fileName={`${Date.now()}-musig2-round${phase}-signer.psbt`}
              fileContent={displayedPsbt.toBase64()}
              beforeOnPress={beforeExportPsbt}
              afterOnPress={afterExportPsbt}
              style={[styles.exportButton, stylesHook.exportButton]}
            >
              <SquareButton title="Export signer PSBT" />
            </SaveFileButton>
          )}
        </View>
      )}

      {__DEV__ && returnedPsbtDebug && (
        <View style={styles.debugBox}>
          <BlueText bold>Returned signer PSBT debug</BlueText>
          <BlueText selectable style={styles.debugText}>
            {returnedPsbtDebug}
          </BlueText>
        </View>
      )}

      {!blockedTerminalState && !signingComplete && !finalization && (
        <>
          <BlueSpacing20 />
          <SquareButton
            testID="MuSig2ImportReturnedSignerPsbt"
            title={phase === 1 ? 'Import signer PSBT' : 'Import signed Round 2 PSBT'}
            onPress={importReturnedSignerPsbt}
            style={[styles.exportButton, stylesHook.exportButton]}
          />
          <BlueText style={styles.importHint}>
            {phase === 1
              ? 'Accepts the returned nonce-bearing PSBT from either signer. Scan QR/BBQr or choose a PSBT file on the next screen.'
              : 'Accepts a BIP373 partial-signature PSBT from either signer. Each partial signature is cryptographically verified before BlueWallet stores it.'}
          </BlueText>
        </>
      )}

      {!blockedTerminalState && signingComplete && !finalization && (
        <>
          <BlueSpacing20 />
          <SquareButton
            testID="MuSig2VerifyAndFinalize"
            title="Verify & finalize MuSig2"
            onPress={verifyAndFinalize}
            style={[styles.exportButton, stylesHook.exportButton]}
          />
          <BlueText style={styles.importHint}>
            Re-verifies every partial signature, aggregates the final Schnorr signature, verifies it immediately before Taproot finalization, and verifies the completed witness again afterward.
          </BlueText>
        </>
      )}

      {finalization && (
        <View style={styles.finalExports}>
          <BlueText bold>Final transaction exports</BlueText>
          {isSaving ? (
            <ActivityIndicator />
          ) : (
            <>
              <SaveFileButton
                fileName={`${Date.now()}-musig2-final.psbt`}
                fileContent={finalization.psbtBase64}
                beforeOnPress={beforeExportPsbt}
                afterOnPress={afterExportPsbt}
                style={[styles.exportButton, stylesHook.exportButton]}
              >
                <SquareButton title="Export final PSBT" />
              </SaveFileButton>
              <BlueSpacing20 />
              <SaveFileButton
                fileName={`${Date.now()}-musig2-final-transaction.hex`}
                fileContent={finalization.rawTransactionHex}
                beforeOnPress={beforeExportPsbt}
                afterOnPress={afterExportPsbt}
                style={[styles.exportButton, stylesHook.exportButton]}
              >
                <SquareButton title="Export raw transaction" />
              </SaveFileButton>
            </>
          )}
        </View>
      )}

      {!blockedTerminalState && !finalization && (
        <>
          <BlueSpacing20 />
          <SquareButton
            testID="MuSig2CancelSession"
            title="Cancel MuSig2 session"
            onPress={cancelSigningSession}
            style={[styles.exportButton, stylesHook.exportButton]}
          />
        </>
      )}

      <BlueText style={styles.note}>
        {blockedTerminalState
          ? 'This session is a hard stop. Do not reuse any secret nonce associated with it.'
          : finalization
            ? 'Final Schnorr verification passed, the Taproot witness is complete, and the completed witness was re-verified. Broadcast is deliberately disabled for this dry-run flow because its input outpoint does not exist.'
            : !nonceProgress.complete
              ? 'Each signer receives the unchanged clean Round 1 PSBT. BlueWallet identifies the returning signer from the validated BIP373 participant key, not from the filename or transport method.'
              : signingComplete
                ? 'All imported partial signatures already passed individual cryptographic verification. Finalization performs the verification again before aggregation.'
                : 'BlueWallet stores verified partial signatures internally but keeps the signer-facing Round 2 QR/file unchanged so both signers receive the same nonce-complete PSBT.'}
      </BlueText>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 12,
    textAlign: 'center',
  },
  details: {
    gap: 6,
    marginTop: 16,
  },
  signerTransport: {
    gap: 8,
    marginTop: 20,
  },
  signerHint: {
    lineHeight: 20,
    marginBottom: 4,
  },
  importHint: {
    marginTop: 8,
    lineHeight: 20,
  },
  finalExports: {
    gap: 8,
    marginTop: 20,
  },
  debugBox: {
    marginTop: 16,
    paddingVertical: 12,
  },
  debugText: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 15,
  },
  note: {
    marginTop: 16,
    lineHeight: 20,
  },
  warning: {
    marginVertical: 12,
    fontWeight: '600',
  },
  exportButton: {
    minHeight: 48,
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
});

export default MuSig2Round1QRCode;
