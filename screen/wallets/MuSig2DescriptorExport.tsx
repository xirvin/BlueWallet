import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { BlueSpacing10, BlueSpacing20 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import CopyTextToClipboard from '../../components/CopyTextToClipboard';
import QRCode from '../../components/QRCode';
import SafeArea from '../../components/SafeArea';
import SaveFileButton from '../../components/SaveFileButton';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { useSettings } from '../../hooks/context/useSettings';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'MuSig2DescriptorExport'>;

const MuSig2DescriptorExport: React.FC = () => {
  const { colors } = useTheme();
  const { wallets } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const { isPrivacyBlurEnabled } = useSettings();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();
  const [qrCodeSize, setQRCodeSize] = useState(90);

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

  const onLayout = (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = event.nativeEvent.layout;
    const maxQRSize = 430;
    const isPortrait = height > width;
    const nextSize = isPortrait ? Math.min(width * 0.78, height * 0.48, maxQRSize) : Math.min(width * 0.38, height * 0.58, maxQRSize);
    setQRCodeSize(Math.max(160, nextSize));
  };

  const stylesHook = StyleSheet.create({
    root: { backgroundColor: colors.elevated },
    card: { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor },
    secondaryText: { color: colors.alternativeTextColor },
    exportButton: { backgroundColor: colors.mainColor },
    exportButtonText: { color: colors.buttonTextColor },
  });

  return (
    <SafeArea style={[styles.root, stylesHook.root]} onLayout={onLayout}>
      {!descriptor ? (
        <View style={styles.errorContainer}>
          <BlueText h4 style={styles.centerText}>
            Descriptor unavailable
          </BlueText>
          <BlueSpacing10 />
          <BlueText style={[styles.centerText, stylesHook.secondaryText]}>
            This MuSig2 wallet does not contain the complete signer xpub metadata required to build its BIP390 descriptor.
          </BlueText>
        </View>
      ) : (
        <>
          <View style={styles.content}>
            <BlueText h4 style={styles.centerText}>
              Bitcoin Core wallet descriptor
            </BlueText>
            <BlueSpacing10 />
            <BlueText style={[styles.description, stylesHook.secondaryText]}>
              Scan this QR or export the checksummed descriptor file to restore the public MuSig2 wallet definition in compatible software.
            </BlueText>
            <BlueSpacing20 />

            <QRCode value={descriptor} size={qrCodeSize} />

            <BlueSpacing20 />
            <View style={[styles.descriptorCard, stylesHook.card]}>
              <CopyTextToClipboard text={descriptor} selectable style={styles.descriptorText} />
            </View>
          </View>

          <View style={styles.footer}>
            <SaveFileButton fileName={fileName} fileContent={`${descriptor}\n`} style={[styles.exportButton, stylesHook.exportButton]}>
              <View style={styles.exportButtonContent}>
                <BlueText style={[styles.exportButtonText, stylesHook.exportButtonText]}>Export descriptor file</BlueText>
              </View>
            </SaveFileButton>
          </View>
        </>
      )}
    </SafeArea>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 18 },
  centerText: { textAlign: 'center' },
  description: { maxWidth: 520, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  descriptorCard: { width: '100%', maxWidth: 620, borderWidth: 1, borderRadius: 12, padding: 14 },
  descriptorText: { fontSize: 12, lineHeight: 18 },
  footer: { paddingHorizontal: 20, paddingBottom: 20 },
  exportButton: { minHeight: 48, borderRadius: 24, justifyContent: 'center', paddingHorizontal: 16 },
  exportButtonContent: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  exportButtonText: { fontSize: 16, fontWeight: '600' },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
});

export default MuSig2DescriptorExport;
