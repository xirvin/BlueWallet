import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { Modal, SafeAreaView, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { createMuSig2WalletBSMSRecord } from '../../blue_modules/musig2/bsms';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { BlueSpacing10, BlueSpacing20 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import CopyTextToClipboard from '../../components/CopyTextToClipboard';
import Icon from '../../components/Icon';
import QRCode from '../../components/QRCode';
import SafeArea from '../../components/SafeArea';
import SaveFileButton from '../../components/SaveFileButton';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'MuSig2NunchukExport'>;
type Detail = { title: string; description: string; text: string; copyLabel: string };

const MuSig2NunchukExport: React.FC = () => {
  const { colors } = useTheme();
  const { wallets } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const { isPrivacyBlurEnabled } = useSettings();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();
  const [qrCodeSize, setQRCodeSize] = useState(90);
  const [selectedDetail, setSelectedDetail] = useState<Detail>();

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

  const firstAddress = useMemo(() => {
    if (!muSig2Wallet) return undefined;
    try {
      return muSig2Wallet._getExternalAddressByIndex(0);
    } catch {
      return undefined;
    }
  }, [muSig2Wallet]);

  const bsmsRecord = useMemo(() => {
    if (!descriptor || !firstAddress) return undefined;
    try {
      return createMuSig2WalletBSMSRecord(descriptor, firstAddress);
    } catch {
      return undefined;
    }
  }, [descriptor, firstAddress]);

  const fileName = useMemo(() => {
    const safeLabel = (muSig2Wallet?.getLabel() ?? 'musig2-wallet')
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `[${safeLabel || 'musig2-wallet'}]_backup.bsms`;
  }, [muSig2Wallet]);

  const onLayout = (event: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = event.nativeEvent.layout;
    const maxQRSize = 430;
    const isPortrait = height > width;
    const nextSize = isPortrait ? Math.min(width * 0.78, height * 0.42, maxQRSize) : Math.min(width * 0.36, height * 0.55, maxQRSize);
    setQRCodeSize(Math.max(160, nextSize));
  };

  const closeDetail = () => setSelectedDetail(undefined);

  if (!descriptor || !firstAddress || !bsmsRecord) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.elevated }]}>
        <BlueText h4 style={styles.centerText}>
          Export unavailable
        </BlueText>
        <BlueSpacing10 />
        <BlueText style={[styles.centerText, { color: colors.alternativeTextColor }]}>
          Nunchuk export requires the complete MuSig2 descriptor and its first receive address.
        </BlueText>
      </View>
    );
  }

  const descriptorDetail: Detail = {
    title: 'Wallet descriptor',
    description: 'Verify the complete checksummed BIP390 descriptor before importing this public wallet definition.',
    text: descriptor,
    copyLabel: 'Copy descriptor',
  };
  const bsmsDetail: Detail = {
    title: 'BSMS 1.0 backup',
    description: 'This is the complete four-line BSMS wallet backup record, including the first receive address used for verification.',
    text: bsmsRecord,
    copyLabel: 'Copy BSMS backup',
  };

  return (
    <SafeArea style={[styles.root, { backgroundColor: colors.elevated }]} onLayout={onLayout}>
      <ScrollView contentContainerStyle={styles.content}>
        <BlueText h4 style={styles.centerText}>
          Nunchuk wallet export
        </BlueText>
        <BlueSpacing10 />
        <BlueText style={[styles.description, { color: colors.alternativeTextColor }]}>
          Nunchuk's wallet-information flow uses a plain descriptor QR or a BSMS 1.0 backup file. Both exports preserve this vault's exact checksummed descriptor.
        </BlueText>
        <BlueSpacing20 />

        <BlueText style={styles.sectionTitle}>Descriptor QR</BlueText>
        <BlueSpacing10 />
        <QRCode value={descriptor} size={qrCodeSize} />
        <BlueSpacing20 />

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="View full MuSig2 wallet descriptor"
          activeOpacity={0.7}
          testID="MuSig2NunchukDescriptorPreview"
          style={[styles.previewCard, { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor }]}
          onPress={() => setSelectedDetail(descriptorDetail)}
        >
          <View style={styles.previewTextColumn}>
            <BlueText style={styles.previewTitle}>Descriptor</BlueText>
            <BlueText
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.previewValue, { color: colors.alternativeTextColor }]}
            >
              {descriptor}
            </BlueText>
          </View>
          <Icon name="external-link" type="font-awesome" size={14} color={colors.newBlue} />
        </TouchableOpacity>

        <BlueSpacing20 />
        <BlueText style={styles.sectionTitle}>BSMS 1.0 backup</BlueText>
        <BlueSpacing10 />
        <BlueText style={[styles.sectionDescription, { color: colors.alternativeTextColor }]}>
          The backup contains four lines: BSMS 1.0, the descriptor, No path restrictions, and receive address #0 for verification.
        </BlueText>
        <BlueSpacing10 />

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="View full BSMS 1.0 backup"
          activeOpacity={0.7}
          testID="MuSig2NunchukBSMSPreview"
          style={[styles.previewCard, { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor }]}
          onPress={() => setSelectedDetail(bsmsDetail)}
        >
          <View style={styles.previewTextColumn}>
            <BlueText style={styles.previewTitle}>BSMS record</BlueText>
            <BlueText
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.previewValue, { color: colors.alternativeTextColor }]}
            >
              {bsmsRecord.replace(/\n/g, ' · ')}
            </BlueText>
          </View>
          <Icon name="external-link" type="font-awesome" size={14} color={colors.newBlue} />
        </TouchableOpacity>

        <BlueSpacing20 />
        <SaveFileButton fileName={fileName} fileContent={bsmsRecord} style={[styles.exportButton, { backgroundColor: colors.mainColor }]}>
          <View style={styles.exportButtonContent}>
            <BlueText style={[styles.exportButtonText, { color: colors.buttonTextColor }]}>Export BSMS backup file</BlueText>
          </View>
        </SaveFileButton>
        <BlueSpacing20 />
      </ScrollView>

      <Modal animationType="slide" presentationStyle="pageSheet" visible={Boolean(selectedDetail)} onRequestClose={closeDetail}>
        <SafeAreaView style={[styles.modalRoot, { backgroundColor: colors.elevated }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to Nunchuk export"
              testID="MuSig2NunchukDetailBack"
              style={styles.backButton}
              onPress={closeDetail}
            >
              <Icon name="arrow-left" type="font-awesome" size={20} color={colors.newBlue} />
            </TouchableOpacity>
            <BlueText h4 style={styles.modalTitle}>
              {selectedDetail?.title}
            </BlueText>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <BlueText style={[styles.modalDescription, { color: colors.alternativeTextColor }]}>
              {selectedDetail?.description}
            </BlueText>

            <View style={[styles.fullTextCard, { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor }]}>
              <BlueText selectable testID="MuSig2NunchukFullExportText" style={styles.fullText}>
                {selectedDetail?.text}
              </BlueText>
            </View>

            {selectedDetail && (
              <View style={[styles.copyButton, { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor }]}>
                <Icon name="copy" type="font-awesome" size={15} color={colors.newBlue} />
                <CopyTextToClipboard
                  text={selectedDetail.text}
                  displayText={selectedDetail.copyLabel}
                  style={[styles.copyText, { color: colors.newBlue }]}
                  containerStyle={styles.copyTextContainer}
                  buttonTestID="MuSig2NunchukCopyExportText"
                  textTestID="MuSig2NunchukCopyExportTextLabel"
                />
              </View>
            )}

            <BlueText style={[styles.returnHint, { color: colors.alternativeTextColor }]}>Tap the back arrow to return to export.</BlueText>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeArea>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 },
  centerText: { textAlign: 'center' },
  description: { maxWidth: 560, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  sectionTitle: { width: '100%', maxWidth: 620, fontSize: 16, fontWeight: '600' },
  sectionDescription: { width: '100%', maxWidth: 620, fontSize: 13, lineHeight: 19 },
  previewCard: {
    width: '100%',
    maxWidth: 620,
    minHeight: 66,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewTextColumn: { flex: 1, marginRight: 12 },
  previewTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  previewValue: { fontSize: 12, lineHeight: 17 },
  exportButton: { width: '100%', maxWidth: 620, minHeight: 48, borderRadius: 24, justifyContent: 'center', paddingHorizontal: 16 },
  exportButtonContent: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  exportButtonText: { fontSize: 16, fontWeight: '600' },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  modalRoot: { flex: 1 },
  modalHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 44 },
  modalContent: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 30 },
  modalDescription: { textAlign: 'center', fontSize: 13, lineHeight: 19, marginBottom: 18 },
  fullTextCard: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 22 },
  fullText: { fontSize: 14, lineHeight: 21 },
  copyButton: {
    marginTop: 14,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  copyTextContainer: { alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  copyText: { marginVertical: 0, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  returnHint: { marginTop: 18, textAlign: 'center', fontSize: 12 },
});

export default MuSig2NunchukExport;
