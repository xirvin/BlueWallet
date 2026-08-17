import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as bitcoin from 'bitcoinjs-lib';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  getMuSig2NonceProgress,
  mergeMuSig2Round1Psbt,
  PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS,
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

const MuSig2Round1QRCode: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { params } = useRoute<RouteParams>();
  const { psbtBase64, walletID, onBarScanned } = params;
  const dynamicQRCode = useRef<DynamicQRCode>(null);
  const isFocused = useIsFocused();
  const [isSaving, setIsSaving] = useState(false);
  const [coordinatorPsbtBase64, setCoordinatorPsbtBase64] = useState(psbtBase64);

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
        const result = mergeMuSig2Round1Psbt(coordinatorPsbt, returnedPsbt);
        setCoordinatorPsbtBase64(result.psbt.toBase64());

        if (result.added === 0) {
          presentAlert({ title: 'MuSig2 Round 1', message: 'This public nonce was already imported.' });
        }
      } catch (error: any) {
        presentAlert({ title: 'MuSig2 Round 1 rejected', message: error?.message ?? String(error) });
      }
    },
    [coordinatorPsbt],
  );

  useEffect(() => {
    if (!onBarScanned) return;

    // ScanQRCode returns serializable scan data to this route. Consume it once,
    // then clear the route param so a coordinator state update cannot import the
    // same nonce a second time.
    navigation.setParams({ onBarScanned: undefined });
    handleReturnedRound1Psbt(onBarScanned);
  }, [handleReturnedRound1Psbt, navigation, onBarScanned]);

  const scanReturnedRound1Psbt = useCallback(() => {
    // Do not pass a function through navigation params. ScanQRCode already
    // supports returning decoded QR/BBQr data to the launching route via popTo.
    navigation.navigate('ScanQRCode', {
      launchedBy: 'MuSig2Round1QRCode',
      showFileImportButton: true,
    });
  }, [navigation]);

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
          description="Scan this same BIP373 PSBT with each MuSig2 signer. Then import each returned PSBT below. BlueWallet copies only validated BIP373 public nonces into the coordinator session."
          additionalDescription="Do not move to Round 2 until BlueWallet reports NONCES_COMPLETE. Keep the COLDCARD Q powered on after it creates its public nonce."
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
        <BlueText>Transport: BBQr animated PSBT</BlueText>
      </View>

      {!nonceProgress.complete && (
        <>
          <BlueSpacing20 />
          <SquareButton
            testID="MuSig2ScanReturnedRound1Psbt"
            title="Scan returned Round 1 PSBT"
            onPress={scanReturnedRound1Psbt}
            style={[styles.exportButton, stylesHook.exportButton]}
          />
        </>
      )}

      <BlueText style={styles.note}>
        {nonceProgress.complete
          ? 'Round 2 PSBT generation is now complete. Partial-signature import and final Schnorr aggregation are the next coordinator milestone, so do not broadcast or fund this experimental flow yet.'
          : 'Each signer should receive the unchanged Round 1 PSBT. BlueWallet keeps imported public nonces internally and switches the displayed QR to Round 2 only after every input has a nonce from every expected participant.'}
      </BlueText>

      <BlueSpacing20 />
      {isSaving ? (
        <ActivityIndicator />
      ) : (
        <SaveFileButton
          fileName={`${Date.now()}-musig2-round${phase}.psbt`}
          fileContent={displayedPsbt.toBase64()}
          beforeOnPress={async () => {
            dynamicQRCode.current?.stopAutoMove();
            setIsSaving(true);
          }}
          afterOnPress={() => {
            setIsSaving(false);
            dynamicQRCode.current?.startAutoMove();
          }}
          style={[styles.exportButton, stylesHook.exportButton]}
        >
          <SquareButton title={`Share Round ${phase} PSBT`} />
        </SaveFileButton>
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
