import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import LottieView from 'lottie-react-native';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  MUSIG2_DEFAULT_SIGNERS,
  MUSIG2_WALLET_TYPE_LABEL,
  assertMuSig2SignerCount,
} from '../../blue_modules/musig2/vault';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import Button from '../../components/Button';
import ListItem from '../../components/ListItem';
import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';

type NavigationProps = NativeStackNavigationProp<AddWalletStackParamList, 'WalletsAddMuSig2'>;
type RouteProps = RouteProp<AddWalletStackParamList, 'WalletsAddMuSig2'>;

const WalletsAddMuSig2: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { walletLabel } = useRoute<RouteProps>().params;
  const [signerCount, setSignerCount] = useState(MUSIG2_DEFAULT_SIGNERS);

  const openSettings = useCallback(() => {
    navigation.navigate('MuSig2Advanced', {
      signerCount,
      onSave: count => {
        assertMuSig2SignerCount(count);
        setSignerCount(count);
      },
    });
  }, [navigation, signerCount]);

  const importNunchuk = useCallback(() => {
    navigation.navigate('ImportWallet', { label: '' });
  }, [navigation]);

  const start = useCallback(() => {
    navigation.navigate('WalletsAddMuSig2Step2', { signerCount, walletLabel });
  }, [navigation, signerCount, walletLabel]);

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
          <Text style={styles.bold}>{signerCount} of {signerCount}</Text> signers participate when spending, while the blockchain sees a
          standard P2TR key-path signature.
        </Text>
        <BlueSpacing20 />
        <Text style={[styles.text, stylesHook.text]}>
          New BIP87 Vaults derive every signer to the address child before MuSig2 KeySort/KeyAgg, matching BIP390 and Nunchuk Value Keyset wallets. BlueWallet coordinates BIP373 signing rounds without storing external signer private keys or secret nonces.
        </Text>
      </View>

      <View>
        <ListItem
          testID="MuSig2VaultSettings"
          onPress={openSettings}
          title="Vault settings"
          subtitle={`${MUSIG2_WALLET_TYPE_LABEL}, ${signerCount} of ${signerCount}`}
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
