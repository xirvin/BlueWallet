import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { BlueSpacing10, BlueSpacing20 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import CopyTextToClipboard from '../../components/CopyTextToClipboard';
import QRCode from '../../components/QRCode';
import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'MuSig2DescriptorQR'>;

const MuSig2DescriptorQR: React.FC = () => {
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

  const onLayout = (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = event.nativeEvent.layout;
    const maxQRSize = 430;
    const isPortrait = height > width;
    const nextSize = isPortrait ? Math.min(width * 0.78, height * 0.48, maxQRSize) : Math.min(width * 0.38, height * 0.58, maxQRSize);
    setQRCodeSize(Math.max(160, nextSize));
  };

  return (
    <SafeArea style={[styles.root, { backgroundColor: colors.elevated }]} onLayout={onLayout}>
      {!descriptor ? (
        <View style={styles.errorContainer}>
          <BlueText h4 style={styles.centerText}>
            Descriptor unavailable
          </BlueText>
          <BlueSpacing10 />
          <BlueText style={[styles.centerText, { color: colors.alternativeTextColor }]}>
            This MuSig2 wallet does not contain the complete signer xpub metadata required to build its BIP390 descriptor.
          </BlueText>
        </View>
      ) : (
        <View style={styles.content}>
          <BlueText h4 style={styles.centerText}>
            Standard BIP390 descriptor
          </BlueText>
          <BlueSpacing10 />
          <BlueText style={[styles.description, { color: colors.alternativeTextColor }]}>
            Scan this plain QR with software that accepts a checksummed BIP390 MuSig2 descriptor.
          </BlueText>
          <BlueSpacing20 />
          <QRCode value={descriptor} size={qrCodeSize} />
          <BlueSpacing20 />
          <View style={[styles.descriptorCard, { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor }]}>
            <CopyTextToClipboard text={descriptor} selectable style={styles.descriptorText} />
          </View>
        </View>
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
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
});

export default MuSig2DescriptorQR;
