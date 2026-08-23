import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { BlueSpacing10 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import { SettingsFootnote, SettingsListItem, SettingsScrollView, SettingsSection } from '../../components/SettingsSection';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'MuSig2NunchukExport'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'MuSig2NunchukExport'>;

const MuSig2NunchukExport: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { wallets } = useStorage();
  const { walletID } = useRoute<RouteProps>().params;
  const { isPrivacyBlurEnabled } = useSettings();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();

  const wallet = wallets.find(candidate => candidate.getID() === walletID);
  const muSig2Wallet = wallet?.type === HDTaprootMuSig2Wallet.type ? (wallet as HDTaprootMuSig2Wallet) : undefined;
  const descriptorAvailable = Boolean(muSig2Wallet?.hasCompleteExtendedParticipantMetadata());

  useFocusEffect(
    useCallback(() => {
      if (isPrivacyBlurEnabled) enableScreenProtect();
      return () => disableScreenProtect();
    }, [disableScreenProtect, enableScreenProtect, isPrivacyBlurEnabled]),
  );

  if (!descriptorAvailable) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.elevated }]}>
        <BlueText h4 style={styles.centerText}>
          Descriptor unavailable
        </BlueText>
        <BlueSpacing10 />
        <BlueText style={[styles.centerText, { color: colors.alternativeTextColor }]}>
          Nunchuk export requires complete signer xpub, fingerprint, and derivation metadata for every MuSig2 Vault Key.
        </BlueText>
      </View>
    );
  }

  return (
    <SettingsScrollView style={{ backgroundColor: colors.elevated }}>
      <View style={styles.intro}>
        <BlueText h4>Nunchuk</BlueText>
        <BlueSpacing10 />
        <SettingsFootnote>
          Choose the QR format shown by Nunchuk when importing wallet information. BBQr preserves this exact BIP390 descriptor and is the recommended transport for this vault.
        </SettingsFootnote>
      </View>

      <SettingsSection title="QR format">
        <SettingsListItem
          iconName="paperPlane"
          title="BBQr"
          subtitle="Recommended · exact BIP390 descriptor"
          testID="MuSig2NunchukBBQR"
          chevron
          onPress={() => navigation.navigate('MuSig2NunchukQR', { walletID, format: 'bbqr' })}
        />
        <SettingsListItem
          iconName="tools"
          title="URv2"
          subtitle="Limited for this BIP390 MuSig2 derivation"
          testID="MuSig2NunchukURv2"
          chevron
          bottomDivider={false}
          onPress={() => navigation.navigate('MuSig2NunchukQR', { walletID, format: 'urv2' })}
        />
      </SettingsSection>

      <View style={styles.note}>
        <SettingsFootnote>
          Nunchuk's current URv2 wallet codec uses crypto-output or a Coldcard-style multisig configuration. Neither format records BIP390 derivation after musig(), so converting this vault to that URv2 wallet representation would change its derived Taproot addresses. BlueWallet will not generate that unsafe conversion.
        </SettingsFootnote>
      </View>
    </SettingsScrollView>
  );
};

const styles = StyleSheet.create({
  intro: { paddingHorizontal: 20, paddingBottom: 20 },
  note: { paddingHorizontal: 20, paddingBottom: 32 },
  centerText: { textAlign: 'center' },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
});

export default MuSig2NunchukExport;
