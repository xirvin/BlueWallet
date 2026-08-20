import React, { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  restoreMuSig2LocalSignerWalletFromWatchOnly,
  watchOnlyWalletMatchesMuSig2Participant,
} from '../../blue_modules/musig2/signer-management';
import {
  createMuSig2TaprootSignerWallet,
  normalizeMuSig2VaultSigner,
  taprootWalletToMuSig2KeyExpression,
} from '../../blue_modules/musig2/vault';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { AddressInputScanButton } from '../../components/AddressInputScanButton';
import presentAlert from '../../components/Alert';
import BlueFormLabel from '../../components/BlueFormLabel';
import BlueFormMultiInput from '../../components/BlueFormMultiInput';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import BlueTextCentered from '../../components/BlueTextCentered';
import Button from '../../components/Button';
import {
  DoneAndDismissKeyboardInputAccessory,
  DoneAndDismissKeyboardInputAccessoryViewID,
} from '../../components/DoneAndDismissKeyboardInputAccessory';
import { useTheme } from '../../components/themes';
import prompt from '../../helpers/prompt';
import { useStorage } from '../../hooks/context/useStorage';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'ViewEditMuSig2ProvideMnemonicSheet'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'ViewEditMuSig2ProvideMnemonicSheet'>;

const ViewEditMuSig2ProvideMnemonicSheet: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { params } = useRoute<RouteProps>();
  const { wallets, setWalletsWithNewOrder, saveToDisk } = useStorage();
  const [importText, setImportText] = useState('');
  const [askPassphrase, setAskPassphrase] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleImport = useCallback(
    async (text?: string) => {
      const mnemonic = (text ?? importText).trim();
      if (!mnemonic || isLoading) return;

      const vault = wallets.find(wallet => wallet.getID() === params.walletID && wallet.type === HDTaprootMuSig2Wallet.type) as
        | HDTaprootMuSig2Wallet
        | undefined;
      if (!vault) {
        presentAlert({ message: 'MuSig2 vault not found.' });
        return;
      }

      const participant = vault.getParticipants()[params.participantIndex];
      if (!participant?.xpub || !participant.masterFingerprint || !participant.derivationPath) {
        presentAlert({ message: 'This MuSig2 Vault Key is missing complete public metadata.' });
        return;
      }

      setIsLoading(true);
      try {
        let passphrase = '';
        if (askPassphrase) {
          try {
            passphrase = await prompt('BIP39 passphrase', 'Enter the passphrase for this signer seed. Leave it blank if none is used.');
          } catch (error) {
            if (error instanceof Error && error.message === 'Cancel Pressed') return;
            throw error;
          }
        }

        let signerWallet = createMuSig2TaprootSignerWallet(mnemonic, passphrase);
        const normalized = normalizeMuSig2VaultSigner(taprootWalletToMuSig2KeyExpression(signerWallet)).participant;
        if (
          normalized.publicKeyHex !== participant.publicKeyHex.toLowerCase() ||
          normalized.xpub !== participant.xpub ||
          normalized.masterFingerprint !== participant.masterFingerprint.toLowerCase() ||
          normalized.derivationPath !== participant.derivationPath
        ) {
          throw new Error('These seed words do not match this MuSig2 Vault Key. Check the mnemonic and BIP39 passphrase.');
        }

        const existingLocal = wallets.find(wallet => {
          if (wallet.type !== HDTaprootWallet.type) return false;
          try {
            return normalizeMuSig2VaultSigner(taprootWalletToMuSig2KeyExpression(wallet as HDTaprootWallet)).participant.publicKeyHex === participant.publicKeyHex;
          } catch {
            return false;
          }
        });
        if (existingLocal) {
          presentAlert({ message: 'This signer seed is already available on this device.' });
          navigation.goBack();
          return;
        }

        const matchingWatchOnly = wallets.find(
          wallet => wallet.type === WatchOnlyWallet.type && watchOnlyWalletMatchesMuSig2Participant(wallet as WatchOnlyWallet, participant),
        ) as WatchOnlyWallet | undefined;

        if (matchingWatchOnly) {
          signerWallet = restoreMuSig2LocalSignerWalletFromWatchOnly(signerWallet, matchingWatchOnly);
        } else {
          signerWallet.setLabel(`${vault.getLabel()} · Vault Key ${params.participantIndex + 1}`);
        }

        const nextWallets = matchingWatchOnly
          ? wallets.map(wallet => (wallet.getID() === matchingWatchOnly.getID() ? signerWallet : wallet))
          : [...wallets, signerWallet];
        setWalletsWithNewOrder(nextWallets);
        await saveToDisk(true);
        presentAlert({
          title: `Vault Key ${params.participantIndex + 1} restored`,
          message: 'This signer is now available for local MuSig2 Round 1 nonce generation and Round 2 signing.',
        });
        navigation.goBack();
      } catch (error: any) {
        presentAlert({ title: 'Could not restore MuSig2 signer', message: error?.message ?? String(error) });
      } finally {
        setIsLoading(false);
      }
    }, [
      askPassphrase,
      importText,
      isLoading,
      navigation,
      params.participantIndex,
      params.walletID,
      saveToDisk,
      setWalletsWithNewOrder,
      wallets,
    ],
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.elevated }]} edges={['bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="always">
        <BlueTextCentered>Enter the BIP39 seed words for Vault Key {params.participantIndex + 1}.</BlueTextCentered>
        <BlueSpacing20 />
        <BlueFormMultiInput
          value={importText}
          onChangeText={setImportText}
          inputAccessoryViewID={DoneAndDismissKeyboardInputAccessoryViewID}
          testID="MuSig2MnemonicInputSheet"
          style={styles.mnemonicInput}
        />
        {Platform.select({
          ios: (
            <DoneAndDismissKeyboardInputAccessory
              onClearTapped={() => setImportText('')}
              onPasteTapped={text => setImportText(text)}
            />
          ),
          default: null,
        })}
        <BlueSpacing20 />
        <View style={styles.toggleRow}>
          <BlueFormLabel>BIP39 passphrase</BlueFormLabel>
          <Switch value={askPassphrase} onValueChange={setAskPassphrase} />
        </View>
        <BlueSpacing20 />
        <Button
          testID="MuSig2DoImportKeyButton"
          title="Import signer seed"
          onPress={() => void handleImport()}
          disabled={!importText.trim() || isLoading}
          showActivityIndicator={isLoading}
        />
        <BlueSpacing20 />
        <AddressInputScanButton
          type="link"
          testID="MuSig2ScanOrOpenSignerSeed"
          isLoading={isLoading}
          onChangeText={text => {
            setImportText(text);
            if (!askPassphrase) void handleImport(text);
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  contentContainer: { flexGrow: 1, paddingHorizontal: 24 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mnemonicInput: { minHeight: 220, maxHeight: 220, flex: 0, marginHorizontal: 0 },
});

export default ViewEditMuSig2ProvideMnemonicSheet;
