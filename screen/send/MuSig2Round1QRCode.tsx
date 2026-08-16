import { RouteProp, useIsFocused, useRoute } from '@react-navigation/native';
import * as bitcoin from 'bitcoinjs-lib';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS } from '../../blue_modules/musig2/psbt';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import { DynamicQRCode } from '../../components/DynamicQRCode';
import SaveFileButton from '../../components/SaveFileButton';
import { SquareButton } from '../../components/SquareButton';
import TipBox from '../../components/TipBox';
import { useTheme } from '../../components/themes';
import { SendDetailsStackParamList } from '../../navigation/SendDetailsStackParamList';

type RouteParams = RouteProp<SendDetailsStackParamList, 'MuSig2Round1QRCode'>;

const MuSig2Round1QRCode: React.FC = () => {
  const { colors } = useTheme();
  const { params } = useRoute<RouteParams>();
  const { psbtBase64, walletID } = params;
  const dynamicQRCode = useRef<DynamicQRCode>(null);
  const isFocused = useIsFocused();
  const [isSaving, setIsSaving] = useState(false);

  const psbt = useMemo(() => bitcoin.Psbt.fromBase64(psbtBase64), [psbtBase64]);
  const hasBip373Participants = useMemo(
    () =>
      psbt.data.inputs.length > 0 &&
      psbt.data.inputs.every(input => input.unknownKeyVals?.some(item => item.key[0] === PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS)),
    [psbt],
  );

  useEffect(() => {
    if (isFocused) {
      // COLDCARD Q understands BBQr and it is more efficient for large binary PSBTs.
      dynamicQRCode.current?.forceUseBBQR();
      dynamicQRCode.current?.startAutoMove();
    } else {
      dynamicQRCode.current?.stopAutoMove();
    }
  }, [isFocused]);

  const stylesHook = StyleSheet.create({
    root: { backgroundColor: colors.elevated },
    warning: { color: colors.warningForegroundColor },
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
      <TipBox
        number="1"
        title="MuSig2 Round 1: collect public nonces"
        description="Scan this BIP373 PSBT with each MuSig2 hardware signer. This QR defaults to BBQr for COLDCARD Q."
        additionalDescription="Do not approve Round 2 yet. Keep each signer powered on after it creates its public nonce; its secret nonce must remain tied to this exact transaction."
      />

      {!hasBip373Participants && (
        <BlueText style={[styles.warning, stylesHook.warning]}>
          Warning: this PSBT is missing BIP373 participant fields and must not be used for MuSig2 signing.
        </BlueText>
      )}

      <DynamicQRCode value={psbt.toHex()} ref={dynamicQRCode} walletID={walletID} hideControls={false} />

      <View style={styles.details}>
        <BlueText bold>Coordinator state</BlueText>
        <BlueText>Inputs: {psbt.inputCount}</BlueText>
        <BlueText>BIP373 participants: {hasBip373Participants ? 'present' : 'missing'}</BlueText>
        <BlueText>Transport: BBQr animated PSBT</BlueText>
      </View>

      <BlueText style={styles.note}>
        This milestone exports Round 1 only. After both returned PSBTs contain public nonces, BlueWallet still needs the nonce-merge and Round 2 partial-signature screen before this flow is mainnet-ready.
      </BlueText>

      <BlueSpacing20 />
      {isSaving ? (
        <ActivityIndicator />
      ) : (
        <SaveFileButton
          fileName={`${Date.now()}-musig2-round1.psbt`}
          fileContent={psbt.toBase64()}
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
          <SquareButton title="Share Round 1 PSBT" />
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
