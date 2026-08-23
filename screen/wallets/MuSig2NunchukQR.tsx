import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { BlueSpacing10, BlueSpacing20 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import Button from '../../components/Button';
import CopyTextToClipboard from '../../components/CopyTextToClipboard';
import { DynamicQRCode } from '../../components/DynamicQRCode';
import SafeArea from '../../components/SafeArea';
import SaveFileButton from '../../components/SaveFileButton';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'MuSig2NunchukQR'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'MuSig2NunchukQR'>;

const MuSig2NunchukQR: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { wallets } = useStorage();
  const { walletID, format } = useRoute<RouteProps>().params;
  const { isPrivacyBlurEnabled } = useSettings();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();

  const wallet = wallets.find(candidate => candidate.getID() === walletID);
  const muSig2Wallet = wallet?.type === HDTaprootMuSig2Wallet.type ? (wallet as HDTaprootMuSig2Wallet) : undefined;

  useFocusEffect(
    useCallback(() => {
      if (isPrivacyBlurEnabled) enableScreenProtect();
      return () => disableScreenProtect();
    }, [disableScreenProtect, enableScreenProtect, isPrivacyBlurEnabled]),
  );

  const descriptor = useMemo(() => {
    if (!muSig2Wallet) return undefined;
    try {
      return muSig2Wallet.getBIP390Descriptor();
    } catch {
      return undefined;
    }
  }, [muSig2Wallet]);

  const fileName = useMemo(() => {
    const safeLabel = (muSig2Wallet?.getLabel() ?? 'musig2-wallet')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${safeLabel || 'musig2-wallet'}-descriptor.txt`;
  }, [muSig2Wallet]);

  if (!descriptor) {
    return (
      <SafeArea style={[styles.root, { backgroundColor: colors.elevated }]}>
        <View style={styles.centered}>
          <BlueText h4 style={styles.centerText}>
            Descriptor unavailable
          </BlueText>
          <BlueSpacing10 />
          <BlueText style={[styles.centerText, { color: colors.alternativeTextColor }]}>
            This MuSig2 wallet does not contain the complete signer metadata required for Nunchuk export.
          </BlueText>
        </View>
      </SafeArea>
    );
  }

  if (format === 'urv2') {
    return (
      <SafeArea style={[styles.root, { backgroundColor: colors.elevated }]}>
        <View style={styles.compatibilityContent}>
          <BlueText h4 style={styles.centerText}>
            URv2 is not lossless for this vault
          </BlueText>
          <BlueSpacing10 />
          <BlueText style={[styles.compatibilityText, { color: colors.alternativeTextColor }]}>
            Nunchuk accepts URv2 wallet information, but its current URv2 wallet representations do not encode the BIP390 musig(...)/&lt;0;1&gt;/* aggregate-key derivation used by this BlueWallet vault. Exporting it as Nunchuk's URv2 multisig format would reconstruct a different Taproot wallet with different addresses.
          </BlueText>
          <BlueSpacing20 />
          <View style={[styles.warningCard, { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor }]}>
            <BlueText style={styles.warningTitle}>BlueWallet will not rewrite the wallet to make URv2 fit.</BlueText>
            <BlueSpacing10 />
            <BlueText style={{ color: colors.alternativeTextColor }}>
              Use BBQr instead. BBQr transports the exact checksummed BIP390 descriptor without changing the wallet definition.
            </BlueText>
          </View>
          <BlueSpacing20 />
          <Button title="Use BBQr" testID="MuSig2NunchukUseBBQRInstead" onPress={() => navigation.setParams({ format: 'bbqr' })} />
        </View>
      </SafeArea>
    );
  }

  return (
    <SafeArea style={[styles.root, { backgroundColor: colors.elevated }]}>
      <View style={styles.bbqrContent}>
        <BlueText h4 style={styles.centerText}>
          Nunchuk · BBQr
        </BlueText>
        <BlueSpacing10 />
        <BlueText style={[styles.description, { color: colors.alternativeTextColor }]}>
          In Nunchuk, choose wallet information import and scan BBQr. Keep the camera on this animated code until all frames are collected.
        </BlueText>
        <BlueSpacing20 />

        <View style={styles.dynamicQrContainer}>
          <DynamicQRCode
            key={`nunchuk-bbqr-${walletID}`}
            value={descriptor}
            walletID={walletID}
            protocol="BBQR"
            hideControls={false}
            showProtocolControls={false}
          />
        </View>

        <View style={[styles.descriptorCard, { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor }]}>
          <CopyTextToClipboard text={descriptor} selectable style={styles.descriptorText} />
        </View>
      </View>

      <View style={styles.footer}>
        <SaveFileButton fileName={fileName} fileContent={`${descriptor}\n`} style={[styles.exportButton, { backgroundColor: colors.mainColor }]}>
          <View style={styles.exportButtonContent}>
            <BlueText style={[styles.exportButtonText, { color: colors.buttonTextColor }]}>Save descriptor file</BlueText>
          </View>
        </SaveFileButton>
      </View>
    </SafeArea>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  centerText: { textAlign: 'center' },
  compatibilityContent: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  compatibilityText: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  warningCard: { borderWidth: 1, borderRadius: 12, padding: 16 },
  warningTitle: { fontSize: 15, fontWeight: '600' },
  bbqrContent: { flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 18 },
  description: { maxWidth: 540, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  dynamicQrContainer: { width: '100%', flex: 1, minHeight: 300, maxHeight: 500 },
  descriptorCard: { width: '100%', maxWidth: 620, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12 },
  descriptorText: { fontSize: 11, lineHeight: 16 },
  footer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 12 },
  exportButton: { minHeight: 48, borderRadius: 24, justifyContent: 'center', paddingHorizontal: 16 },
  exportButtonContent: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  exportButtonText: { fontSize: 16, fontWeight: '600' },
});

export default MuSig2NunchukQR;
