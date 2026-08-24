import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import LottieView from 'lottie-react-native';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  MUSIG2_DEFAULT_COMPATIBILITY_MODE,
  getMuSig2CompatibilityLabel,
} from '../../blue_modules/musig2/compatibility';
import {
  MUSIG2_DEFAULT_SIGNERS,
  MUSIG2_WALLET_TYPE_LABEL,
  assertMuSig2SignerCount,
} from '../../blue_modules/musig2/vault';
import type { MuSig2DerivationMode } from '../../class/wallets/hd-taproot-musig2-wallet';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import Button from '../../components/Button';
import ListItem from '../../components/ListItem';
import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';

type NavigationProps = NativeStackNavigationProp<AddWalletStackParamList, 'WalletsAddMuSig2'>;
type RouteProps = RouteProp<AddWalletStackParamList, 'WalletsAddMuSig2'>;
type MuSig2AdvancedParams = AddWalletStackParamList['MuSig2Advanced'] & {
  derivationMode: MuSig2DerivationMode;
  onDerivationModeSave: (mode: MuSig2DerivationMode) => void;
};
type MuSig2Step2Params = AddWalletStackParamList['WalletsAddMuSig2Step2'] & {
  derivationMode: MuSig2DerivationMode;
};

const WalletsAddMuSig2: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { walletLabel } = useRoute<RouteProps>().params;
  const [signerCount, setSignerCount] = useState(MUSIG2_DEFAULT_SIGNERS);
  const [derivationMode, setDerivationMode] = useState<MuSig2DerivationMode>(MUSIG2_DEFAULT_COMPATIBILITY_MODE);

  const openSettings = useCallback(() => {
    const params: MuSig2AdvancedParams = {
      signerCount,
      derivationMode,
      onSave: count => {
        assertMuSig2SignerCount(count);
        setSignerCount(count);
      },
      onDerivationModeSave: setDerivationMode,
    };
    navigation.navigate('MuSig2Advanced', params);
  }, [derivationMode, navigation, signerCount]);

  const importNunchuk = useCallback(() => {
    navigation.navigate('ImportWallet', { label: '' });
  }, [navigation]);

  const start = useCallback(() => {
    const params: MuSig2Step2Params = { signerCount, walletLabel, derivationMode };
    navigation.navigate('WalletsAddMuSig2Step2', params);
  }, [derivationMode, navigation, signerCount, walletLabel]);

  const stylesHook = StyleSheet.create({
    root: { backgroundColor: colors.elevated },
    text: { color: colors.alternativeTextColor },
  });

  return (
    <SafeArea style={[styles.root, stylesHook.root]}>
      <View style={styles.descriptionContainer}>
        <View style={styles.imageWrapper}>
          <LottieView source={require('../../img/msvault.json')} style={styles.lottie} autoPlay loop={false} />
        </View>
        <BlueSpacing20 />
        <Text style={[styles.text, stylesHook.text]}>
          A MuSig2 Vault combines{' '}
          <Text style={styles.bold}>{signerCount} independent Taproot keys</Text> into one compact Taproot wallet. All{' '}
          <Text style={styles.bold}>{signerCount} of {signerCount}</Text> signers participate when spending.
        </Text>
        <BlueSpacing20 />
        <Text style={[styles.text, stylesHook.text]}>
          Choose the MuSig2 derivation model before creating the vault. Participant-first is used by Nunchuk. Aggregate-first (BIP328) is used by COLDCARD (Coinkite) and Ledger. Bitcoin Core 31 supports both models.
        </Text>
      </View>

      <View>
        <ListItem
          testID="MuSig2VaultSettings"
          onPress={openSettings}
          title="Vault settings"
          subtitle={`${MUSIG2_WALLET_TYPE_LABEL} · ${getMuSig2CompatibilityLabel(derivationMode)} · ${signerCount} of ${signerCount}`}
          chevron
        />
        <ListItem
          testID="MuSig2ImportNunchuk"
          onPress={importNunchuk}
          title="Import Nunchuk MuSig2 wallet"
          subtitle="BSMS 1.0, descriptor QR, BBQr, or file"
          chevron
        />
      </View>

      <View style={styles.buttonContainer}>
        <Button testID="MuSig2LetsStart" title="Let's Start" onPress={start} />
      </View>
    </SafeArea>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between' },
  descriptionContainer: { alignContent: 'center', justifyContent: 'center', flex: 0.8, paddingHorizontal: 24 },
  buttonContainer: { padding: 24 },
  text: { fontWeight: '500', alignSelf: 'center', textAlign: 'center', lineHeight: 21 },
  bold: { fontWeight: '700' },
  lottie: { width: 233, height: 176 },
  imageWrapper: { borderWidth: 0, alignItems: 'center' },
});

export default WalletsAddMuSig2;
