import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as bitcoin from 'bitcoinjs-lib';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  getMuSig2NonceProgress,
  mergeMuSig2Round1Psbt,
  PSBT_IN_MUSIG2_PARTIAL_SIG,
  PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS,
  PSBT_IN_MUSIG2_PUB_NONCE,
} from '../../blue_modules/musig2/psbt';
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

function parseReturnedPsbt(data: string): bitcoin.Psbt {
  const payload = data.trim();
  try {
    return bitcoin.Psbt.fromHex(payload);
  } catch (_) {}

  try {
    return bitcoin.Psbt.fromBase64(payload);
  } catch (_) {}

  throw new Error('Scanned data is not a valid PSBT');
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

const MuSig2Round1QRCode: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { params } = useRoute<RouteParams>();
  const { psbtBase64, walletID, onBarScanned } = params;
  const dynamicQRCode = useRef<DynamicQRCode>(null);
  const isFocused = useIsFocused();
  const [isSaving, setIsSaving] = useState(false);
  const [coordinatorPsbtBase64, setCoordinatorPsbtBase64] = useState(psbtBase64);
  const [returnedPsbtDebug, setReturnedPsbtDebug] = useState<string>();

  const round1Psbt = useMemo(() => bitcoin.Psbt.fromBase64(psbtBase64), [psbtBase64]);
  const coordinatorPsbt = useMemo(() => bitcoin.Psbt.fromBase64(coordinatorPsbtBase64), [coordinatorPsbtBase64]);
  const nonceProgress = useMemo(() => getMuSig2NonceProgress(coordinatorPsbt), [coordinatorPsbt]);
  const displayedPsbt = nonceProgress.complete ? coordinatorPsbt : round1Psbt;
  const phase = nonceProgress.complete ? 2 : 1;

  const hasBip373Participants = useMemo(
    () =>
      round1Psbt.data.inputs.length > 0 &&
      round1Psbt.data.inputs.every(input =>
        input.unknownKeyVals?.some(item => item.key[0] === PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS),
      ),
    [round1Psbt],
  );

  useEffect(() => {
    if (isFocused) {
      // COLDCARD Q understands BBQr and it is more efficient for large binary PSBTs.
      dynamicQRCode.current?.forceUseBBQR();
      dynamicQRCode.current?.startAutoMove();
    } else {
      dynamicQRCode.current?.stopAutoMove();
    }
  }, [isFocused, phase]);

  const handleReturnedRound1Psbt = useCallback(
    (data: string) => {
      try {
        const returnedPsbt = parseReturnedPsbt(data);
        if (__DEV__) {
          const debug = describeReturnedPsbt(returnedPsbt, round1Psbt);
          setReturnedPsbtDebug(debug);
          console.log('[MuSig2] returned signer PSBT diagnostics:\n' + debug);
          console.log('[MuSig2] returned signer PSBT base64:', returnedPsbt.toBase64());
        }

        const result = mergeMuSig2Round1Psbt(coordinatorPsbt, returnedPsbt);
        setCoordinatorPsbtBase64(result.psbt.toBase64());

        if (result.added === 0) {
          presentAlert({ title: 'MuSig2 Round 1', message: 'This public nonce was already imported.' });
        }
      } catch (error: any) {
        if (__DEV__) console.log('[MuSig2] returned signer PSBT rejected:', error);
        presentAlert({ title: 'MuSig2 Round 1 rejected', message: error?.message ?? String(error) });
      }
    },
    [coordinatorPsbt, round1Psbt],
  );

  useEffect(() => {
    if (!onBarScanned) return;

    // ScanQRCode returns serializable scan data to this route. Consume it once,
    // then clear the route param so a coordinator state update cannot import the
    // same nonce a second time.
    navigation.setParams({ onBarScanned: undefined });
    handleReturnedRound1Psbt(onBarScanned);
  }, [handleReturnedRound1Psbt, navigation, onBarScanned]);

  const importReturnedRound1Psbt = useCallback(() => {
    // ScanQRCode can either scan QR/BBQr or import a PSBT file and returns the
    // decoded payload to this route via popTo.
    navigation.navigate('ScanQRCode', {
      launchedBy: 'MuSig2Round1QRCode',
      showFileImportButton: true,
    });
  }, [navigation]);

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

  return (
    <ScrollView
      centerContent
      automaticallyAdjustContentInsets
      contentInsetAdjustmentBehavior="automatic"
      style={stylesHook.root}
      contentContainerStyle={styles.container}
      testID="MuSig2Round1QRCodeScrollView"
    >
      {nonceProgress.complete ? (
        <TipBox
          number="2"
          title="MuSig2 Round 2: both public nonces collected"
          description="This BIP373 PSBT now contains every required public nonce. Scan this exact Round 2 PSBT with each signer to request its partial signature."
          additionalDescription="Keep the COLDCARD Q powered on. Its secret nonce is still held only in volatile memory and must remain tied to this exact signing session."
        />
      ) : (
        <TipBox
          number="1"
          title="MuSig2 Round 1: collect public nonces"
          description="Give the same clean BIP373 Round 1 PSBT to each signer by scanning the BBQr below or by exporting a PSBT file. Then import each signer response back into BlueWallet."
          additionalDescription="Do not move to Round 2 until BlueWallet reports NONCES_COMPLETE. Keep any COLDCARD that produced a nonce powered on until Round 2 is finished."
        />
      )}

      {!hasBip373Participants && (
        <BlueText style={[styles.warning, stylesHook.warning]}>
          Warning: this PSBT is missing BIP373 participant fields and must not be used for MuSig2 signing.
        </BlueText>
      )}

      <DynamicQRCode
        key={`musig2-round-${phase}`}
        value={displayedPsbt.toHex()}
        ref={dynamicQRCode}
        walletID={walletID}
        hideControls={false}
      />

      <View style={styles.details}>
        <BlueText bold>Coordinator state</BlueText>
        <BlueText>{nonceProgress.complete ? 'NONCES_COMPLETE' : 'COLLECTING_NONCES'}</BlueText>
        <BlueText>Inputs: {displayedPsbt.inputCount}</BlueText>
        <BlueText>
          BIP373 public nonces: {nonceProgress.collected}/{nonceProgress.expected}
        </BlueText>
        <BlueText>BIP373 participants: {hasBip373Participants ? 'present' : 'missing'}</BlueText>
        <BlueText>Transport: BBQr QR or PSBT file</BlueText>
      </View>

      {!nonceProgress.complete && (
        <View style={styles.signerTransport}>
          <BlueText bold>Signer 1</BlueText>
          <BlueText style={styles.signerHint}>Scan the BBQr above with Signer 1, or export the same Round 1 PSBT for microSD/file signing.</BlueText>
          {!isSaving && (
            <SaveFileButton
              fileName={`${Date.now()}-musig2-round1-signer1.psbt`}
              fileContent={round1Psbt.toBase64()}
              beforeOnPress={beforeExportPsbt}
              afterOnPress={afterExportPsbt}
              style={[styles.exportButton, stylesHook.exportButton]}
            >
              <SquareButton title="Export Signer 1 PSBT" />
            </SaveFileButton>
          )}

          <BlueSpacing20 />
          <BlueText bold>Signer 2</BlueText>
          <BlueText style={styles.signerHint}>Scan the same BBQr above with Signer 2, or export the same Round 1 PSBT for microSD/file signing.</BlueText>
          {!isSaving && (
            <SaveFileButton
              fileName={`${Date.now()}-musig2-round1-signer2.psbt`}
              fileContent={round1Psbt.toBase64()}
              beforeOnPress={beforeExportPsbt}
              afterOnPress={afterExportPsbt}
              style={[styles.exportButton, stylesHook.exportButton]}
            >
              <SquareButton title="Export Signer 2 PSBT" />
            </SaveFileButton>
          )}

          {isSaving && <ActivityIndicator style={styles.exportProgress} />}
          <BlueText style={styles.transportNote}>
            The Signer 1 and Signer 2 files contain identical Round 1 PSBT bytes. The signer number is only in the filename so you can keep the two device workflows separate.
          </BlueText>
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

      {!nonceProgress.complete && (
        <>
          <BlueSpacing20 />
          <SquareButton
            testID="MuSig2ScanReturnedRound1Psbt"
            title="Import returned Round 1 PSBT"
            onPress={importReturnedRound1Psbt}
            style={[styles.exportButton, stylesHook.exportButton]}
          />
          <BlueText style={styles.importHint}>Use the camera for QR/BBQr, or choose file import on the next screen.</BlueText>
        </>
      )}

      <BlueText style={styles.note}>
        {nonceProgress.complete
          ? 'Round 2 PSBT generation is now complete. Partial-signature import and final Schnorr aggregation are the next coordinator milestone, so do not broadcast or fund this experimental flow yet.'
          : 'Each signer must receive the unchanged clean Round 1 PSBT. BlueWallet keeps imported public nonces internally and switches the displayed QR to Round 2 only after every expected nonce is present.'}
      </BlueText>

      {nonceProgress.complete && (
        <>
          <BlueSpacing20 />
          {isSaving ? (
            <ActivityIndicator />
          ) : (
            <SaveFileButton
              fileName={`${Date.now()}-musig2-round2.psbt`}
              fileContent={displayedPsbt.toBase64()}
              beforeOnPress={beforeExportPsbt}
              afterOnPress={afterExportPsbt}
              style={[styles.exportButton, stylesHook.exportButton]}
            >
              <SquareButton title="Share Round 2 PSBT" />
            </SaveFileButton>
          )}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 20,
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
  transportNote: {
    marginTop: 10,
    lineHeight: 20,
  },
  exportProgress: {
    marginTop: 8,
  },
  importHint: {
    marginTop: 8,
    lineHeight: 20,
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
