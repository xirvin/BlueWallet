import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { BlueSpacing10 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import SaveFileButton from '../../components/SaveFileButton';
import { SettingsFootnote, SettingsListItem, SettingsScrollView, SettingsSection } from '../../components/SettingsSection';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'MuSig2DescriptorExport'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'MuSig2DescriptorExport'>;

const MuSig2DescriptorExport: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { wallets } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
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
      <View style={[styles.errorContainer, { backgroundColor: colors.elevated }]}>
        <BlueText h4 style={styles.centerText}>
          Descriptor unavailable
        </BlueText>
        <BlueSpacing10 />
        <BlueText style={[styles.centerText, { color: colors.alternativeTextColor }]}>
          This MuSig2 wallet does not contain the complete signer xpub metadata required to build its BIP390 descriptor.
        </BlueText>
      </View>
    );
  }

  return (
    <SettingsScrollView style={{ backgroundColor: colors.elevated }}>
      <View style={styles.intro}>
        <BlueText h4>Export Vault Descriptor</BlueText>
        <BlueSpacing10 />
        <SettingsFootnote>
          Export the checksummed BIP390 MuSig2 descriptor for wallet recovery or watch-only access. This contains public wallet data, not signer seeds or private keys.
        </SettingsFootnote>
      </View>

      <SettingsSection title="Choose destination">
        <SettingsListItem
          iconName="paperPlane"
          title="Nunchuk"
          subtitle="Choose BBQr or review URv2 compatibility"
          testID="MuSig2DescriptorExportNunchuk"
          chevron
          onPress={() => navigation.navigate('MuSig2NunchukExport', { walletID })}
        />
        <SettingsListItem
          iconName="tools"
          title="Standard descriptor QR"
          subtitle="Plain checksummed BIP390 descriptor"
          testID="MuSig2DescriptorExportStandardQR"
          chevron
          bottomDivider={false}
          onPress={() => navigation.navigate('MuSig2DescriptorQR', { walletID })}
        />
      </SettingsSection>

      <SettingsSection title="Descriptor file">
        <View style={styles.fileContent}>
          <SettingsFootnote>
            Save the exact checksummed descriptor as a text file for Bitcoin Core and other BIP390-compatible software.
          </SettingsFootnote>
          <View style={styles.fileButtonSpacer} />
          <SaveFileButton fileName={fileName} fileContent={`${descriptor}\n`} style={[styles.exportButton, { backgroundColor: colors.mainColor }]}>
            <View style={styles.exportButtonContent}>
              <BlueText style={[styles.exportButtonText, { color: colors.buttonTextColor }]}>Save descriptor file</BlueText>
            </View>
          </SaveFileButton>
        </View>
      </SettingsSection>
    </SettingsScrollView>
  );
};

const styles = StyleSheet.create({
  intro: { paddingHorizontal: 20, paddingBottom: 20 },
  centerText: { textAlign: 'center' },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  fileContent: { padding: 16 },
  fileButtonSpacer: { height: 16 },
  exportButton: { minHeight: 48, borderRadius: 24, justifyContent: 'center', paddingHorizontal: 16 },
  exportButtonContent: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  exportButtonText: { fontSize: 16, fontWeight: '600' },
});

export default MuSig2DescriptorExport;
