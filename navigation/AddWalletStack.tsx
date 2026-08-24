import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import React, { lazy, useCallback, useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import { StyleSheet } from 'react-native';

import { useTheme } from '../components/themes';
import withLazySuspense from '../components/withLazySuspense';
import loc from '../loc';
import { ScanQRCodeParamList } from '../screen/send/ScanQRCode';
import { navigationStyle } from './NavigationStyle';
import { triggerHapticFeedback } from '../blue_modules/hapticFeedback';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback';
import { useSettings } from '../hooks/context/useSettings';
import HeaderRightButton from '../components/HeaderRightButton';

export type AddWalletStackParamList = {
  WalletsAdd: {
    entropy?: number;
    words?: number;
    selectedIndex?: number;
    entropyGenerated?: boolean;
  };
  ImportWallet: {
    triggerImport?: boolean;
    label?: string;
    words?: number;
    passphrase?: string;
    searchAccounts?: boolean;
  };
  ImportWalletDiscovery: {
    importText: string;
    label: string;
    askPassphrase?: boolean;
    searchAccounts?: boolean;
  };
  ImportCustomDerivationPath: {
    importText: string;
    label: string;
    askPassphrase?: boolean;
  };
  ImportSpeed: {
    importText: string;
    label: string;
    askPassphrase?: boolean;
    searchAccounts?: boolean;
  };
  PleaseBackup: {
    walletID: string;
  };
  PleaseBackupLNDHub: {
    walletID: string;
  };
  ProvideEntropy: {
    entropy?: number;
    words?: number;
    generated?: boolean;
    onGenerated?: (entropy: string) => void;
  };
  WalletsAddMultisig: { entropy?: number; words?: number };
  MultisigAdvanced: {
    m: number;
    n: number;
    format: string;
    onSave: (m: number, n: number, format: string) => void;
    headerRight?: HeaderRightRenderer;
  };
  WalletsAddMultisigStep2: {
    m: number;
    n: number;
    walletLabel: string;
    format: string;
  };
  WalletsAddMultisigVaultKeySheet: {
    keyIndex: number;
    seed: string;
    sheetAction?: string;
    sheetImportText?: string;
    sheetAskPassphrase?: boolean;
    headerRight?: HeaderRightRenderer;
  };
  WalletsAddMultisigProvideMnemonicsSheet: { importText: string; askPassphrase: boolean };
  WalletsAddMultisigCosignerXpubSheet: { cosignerXpub: string; cosignerXpubURv2: string; cosignerXpubFilename: string };
  WalletsAddMultisigHelp: undefined;
  WalletsAddMuSig2: { walletLabel: string };
  MuSig2Advanced: {
    signerCount: number;
    onSave: (signerCount: number) => void;
    headerRight?: HeaderRightRenderer;
  };
  WalletsAddMuSig2Step2: {
    signerCount: number;
    walletLabel: string;
  };
  MuSig2VaultKey: {
    keyIndex: number;
    walletLabel: string;
    initialValue?: string;
    onSave: (keyExpression: string, label?: string) => void;
    onBarScanned?: { data?: string } | string;
  };
  MuSig2DescriptorReview: {
    signerCount: number;
    walletLabel: string;
    signerExpressions: string[];
  };
  ScanQRCode: ScanQRCodeParamList;
};

type HeaderRightRenderer = () => React.ReactNode;

const Stack = createNativeStackNavigator<AddWalletStackParamList>();

const WalletsAdd = lazy(() => import('../screen/wallets/Add'));
const ImportCustomDerivationPath = lazy(() => import('../screen/wallets/ImportCustomDerivationPath'));
const ImportWalletDiscovery = lazy(() => import('../screen/wallets/ImportWalletDiscovery'));
const ImportSpeed = lazy(() => import('../screen/wallets/ImportSpeed'));
const ImportWallet = lazy(() => import('../screen/wallets/ImportWallet'));
const PleaseBackup = lazy(() => import('../screen/wallets/PleaseBackup'));
const PleaseBackupLNDHub = lazy(() => import('../screen/wallets/pleaseBackupLNDHub'));
const ProvideEntropy = lazy(() => import('../screen/wallets/ProvideEntropy'));
const WalletsAddMultisig = lazy(() => import('../screen/wallets/WalletsAddMultisig'));
const MultisigAdvanced = lazy(() => import('../screen/wallets/MultisigAdvanced'));
const WalletsAddMultisigStep2 = lazy(() => import('../screen/wallets/addMultisigStep2'));
const WalletsAddMultisigHelp = lazy(() => import('../screen/wallets/addMultisigHelp'));
const WalletsAddMultisigVaultKeySheet = lazy(() => import('../screen/wallets/WalletsAddMultisigVaultKeySheet'));
const WalletsAddMultisigProvideMnemonicsSheet = lazy(() => import('../screen/wallets/WalletsAddMultisigProvideMnemonicSheet'));
const WalletsAddMultisigCosignerXpubSheet = lazy(() => import('../screen/wallets/WalletsAddMultisigCosignerXpubSheet'));
const WalletsAddMuSig2 = lazy(() => import('../screen/wallets/WalletsAddMuSig2'));
const MuSig2Advanced = lazy(() => import('../screen/wallets/MuSig2Advanced'));
const WalletsAddMuSig2Step2 = lazy(() => import('../screen/wallets/WalletsAddMuSig2Step2'));
const MuSig2VaultKey = lazy(() => import('../screen/wallets/MuSig2VaultKey'));
const MuSig2DescriptorReview = lazy(() => import('../screen/wallets/MuSig2DescriptorReview'));
const ScanQRCode = lazy(() => import('../screen/send/ScanQRCode'));

const AddComponent = withLazySuspense(WalletsAdd);
const ImportWalletDiscoveryComponent = withLazySuspense(ImportWalletDiscovery);
const ImportCustomDerivationPathComponent = withLazySuspense(ImportCustomDerivationPath);
const ImportWalletComponent = withLazySuspense(ImportWallet);
const ImportSpeedComponent = withLazySuspense(ImportSpeed);
const PleaseBackupComponent = withLazySuspense(PleaseBackup);
const PleaseBackupLNDHubComponent = withLazySuspense(PleaseBackupLNDHub);
const ProvideEntropyComponent = withLazySuspense(ProvideEntropy);
const WalletsAddMultisigComponent = withLazySuspense(WalletsAddMultisig);
const MultisigAdvancedComponent = withLazySuspense(MultisigAdvanced);
const WalletsAddMultisigStep2Component = withLazySuspense(WalletsAddMultisigStep2);
const WalletsAddMultisigHelpComponent = withLazySuspense(WalletsAddMultisigHelp);
const WalletsAddMultisigVaultKeySheetComponent = withLazySuspense(WalletsAddMultisigVaultKeySheet);
const WalletsAddMultisigProvideMnemonicsSheetComponent = withLazySuspense(WalletsAddMultisigProvideMnemonicsSheet);
const WalletsAddMultisigCosignerXpubSheetComponent = withLazySuspense(WalletsAddMultisigCosignerXpubSheet);
const WalletsAddMuSig2Component = withLazySuspense(WalletsAddMuSig2);
const MuSig2AdvancedComponent = withLazySuspense(MuSig2Advanced);
const WalletsAddMuSig2Step2Component = withLazySuspense(WalletsAddMuSig2Step2);
const MuSig2VaultKeyComponent = withLazySuspense(MuSig2VaultKey);
const MuSig2DescriptorReviewComponent = withLazySuspense(MuSig2DescriptorReview);
const ScanQRCodeComponent = withLazySuspense(ScanQRCode);

const styles = StyleSheet.create({
  headerRightButton: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const AddWalletStack = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { isPrivacyBlurEnabled } = useSettings();

  const screenOptions = useMemo<NativeStackNavigationOptions>(() => ({
    ...navigationStyle({ colors, closeButton: true, isPrivacyBlurEnabled }),
    headerBackVisible: false,
    headerBackTitle: '',
  }), [colors, isPrivacyBlurEnabled]);

  const dismiss = useCallback(() => {
    triggerHapticFeedback(HapticFeedbackTypes.Selection);
    navigation.goBack();
  }, [navigation]);

  const addWalletOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      title: loc.wallets.addWallet,
      headerRight: () => (
        <HeaderRightButton
          title={loc._.cancel}
          onPress={dismiss}
          style={styles.headerRightButton}
          testID="AddWalletCancelButton"
        />
      ),
    }),
    [dismiss],
  );

  return (
    <Stack.Navigator initialRouteName="WalletsAdd" screenOptions={screenOptions}>
      <Stack.Screen name="WalletsAdd" component={AddComponent} options={addWalletOptions} />
      <Stack.Screen name="ImportWallet" component={ImportWalletComponent} options={{ title: loc.wallets.importWallet }} />
      <Stack.Screen name="ImportWalletDiscovery" component={ImportWalletDiscoveryComponent} options={{ title: loc.wallets.importWallet }} />
      <Stack.Screen name="ImportCustomDerivationPath" component={ImportCustomDerivationPathComponent} options={{ title: loc.wallets.importWallet }} />
      <Stack.Screen name="ImportSpeed" component={ImportSpeedComponent} options={{ title: loc.wallets.importWallet }} />
      <Stack.Screen name="PleaseBackup" component={PleaseBackupComponent} options={{ title: loc.wallets.backup }} />
      <Stack.Screen name="PleaseBackupLNDHub" component={PleaseBackupLNDHubComponent} options={{ title: loc.wallets.backup }} />
      <Stack.Screen name="ProvideEntropy" component={ProvideEntropyComponent} options={{ title: loc.wallets.provideEntropy }} />
      <Stack.Screen name="WalletsAddMultisig" component={WalletsAddMultisigComponent} options={{ title: loc.multisig.multisig_vault }} />
      <Stack.Screen name="MultisigAdvanced" component={MultisigAdvancedComponent} options={{ title: loc.multisig.advanced }} />
      <Stack.Screen name="WalletsAddMultisigStep2" component={WalletsAddMultisigStep2Component} options={{ title: loc.multisig.multisig_vault }} />
      <Stack.Screen name="WalletsAddMultisigVaultKeySheet" component={WalletsAddMultisigVaultKeySheetComponent} options={{ title: loc.multisig.vault_key }} />
      <Stack.Screen name="WalletsAddMultisigProvideMnemonicsSheet" component={WalletsAddMultisigProvideMnemonicsSheetComponent} options={{ title: loc.multisig.provide_mnemonics }} />
      <Stack.Screen name="WalletsAddMultisigCosignerXpubSheet" component={WalletsAddMultisigCosignerXpubSheetComponent} options={{ title: loc.multisig.cosigner_xpub }} />
      <Stack.Screen name="WalletsAddMultisigHelp" component={WalletsAddMultisigHelpComponent} options={{ title: loc.multisig.help }} />
      <Stack.Screen name="WalletsAddMuSig2" component={WalletsAddMuSig2Component} options={{ title: 'MuSig2 Vault' }} />
      <Stack.Screen name="MuSig2Advanced" component={MuSig2AdvancedComponent} options={{ title: 'MuSig2 Settings' }} />
      <Stack.Screen name="WalletsAddMuSig2Step2" component={WalletsAddMuSig2Step2Component} options={{ title: 'MuSig2 Vault' }} />
      <Stack.Screen name="MuSig2VaultKey" component={MuSig2VaultKeyComponent} options={{ title: 'Vault Key' }} />
      <Stack.Screen name="MuSig2DescriptorReview" component={MuSig2DescriptorReviewComponent} options={{ title: 'Review Vault' }} />
      <Stack.Screen name="ScanQRCode" component={ScanQRCodeComponent} options={{ title: loc.send.scan_qr }} />
    </Stack.Navigator>
  );
};

export default AddWalletStack;
