import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import {
  MUSIG2_SIGNER_INPUT_PLACEHOLDER,
  MUSIG2_SIGNER_DERIVATION,
  normalizeMuSig2VaultSigner,
  taprootWalletToMuSig2KeyExpression,
} from '../../blue_modules/musig2/vault';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import presentAlert from '../../components/Alert';
import BlueText from '../../components/BlueText';
import Button from '../../components/Button';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';

type NavigationProps = NativeStackNavigationProp<AddWalletStackParamList, 'MuSig2VaultKey'>;
type RouteProps = RouteProp<AddWalletStackParamList, 'MuSig2VaultKey'>;

const MuSig2VaultKey: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const route = useRoute<RouteProps>();
  const { keyIndex, walletLabel, initialValue = '', onSave, onBarScanned } = route.params;
  const { addAndSaveWallet } = useStorage();
  const [input, setInput] = useState(initialValue);
  const [isLoading, setIsLoading] = useState(false);

  const normalized = useMemo(() => {
    if (!input.trim()) return undefined;
    try {
      return normalizeMuSig2VaultSigner(input);
    } catch {
      return undefined;
    }
  }, [input]);

  const useInput = useCallback(() => {
    try {
      const result = normalizeMuSig2VaultSigner(input);
      onSave(result.keyExpression);
      navigation.goBack();
    } catch (error: any) {
      presentAlert({ title: `Vault Key ${keyIndex}`, message: error?.message ?? String(error) });
    }
  }, [input, keyIndex, navigation, onSave]);

  const scanOrImport = useCallback(() => {
    navigation.navigate('ScanQRCode', {
      launchedBy: 'MuSig2VaultKey',
      showFileImportButton: true,
    });
  }, [navigation]);

  const createNewTaprootKey = useCallback(async () => {
    setIsLoading(true);
    try {
      const wallet = new HDTaprootWallet();
      wallet.setLabel(`${walletLabel} · Vault Key ${keyIndex}`);
      await wallet.generate();
      const expression = taprootWalletToMuSig2KeyExpression(wallet);
      await addAndSaveWallet(wallet);
      setInput(expression);

      navigation.navigate('WalletsAddMultisigVaultKeySheet', {
        keyIndex,
        seed: wallet.getSecret(),
      });
    } catch (error: any) {
      presentAlert({ title: 'Could not create Taproot Vault Key', message: error?.message ?? String(error) });
    } finally {
      setIsLoading(false);
    }
  }, [addAndSaveWallet, keyIndex, navigation, walletLabel]);

  useEffect(() => {
    if (!onBarScanned) return;
    const data = typeof onBarScanned === 'string' ? onBarScanned : onBarScanned.data ?? '';
    if (data) setInput(data);
    navigation.setParams({ onBarScanned: undefined });
  }, [navigation, onBarScanned]);

  return (
    <SafeAreaScrollView style={{ backgroundColor: colors.elevated }} contentContainerStyle={styles.container} automaticallyAdjustKeyboardInsets>
      <BlueText bold style={styles.title}>Vault Key {keyIndex}</BlueText>
      <BlueText style={styles.description}>
        Use a standard BIP86 Taproot account key at {MUSIG2_SIGNER_DERIVATION}. You can create a new BlueWallet Taproot wallet, scan a signer export, import a file, or type/paste a BSMS key.
      </BlueText>

      <Button testID="MuSig2CreateTaprootKey" title="Create new Taproot wallet" onPress={createNewTaprootKey} disabled={isLoading} />
      <BlueSpacing20 />
      <Button testID="MuSig2ScanOrImportKey" title="Scan QR or import file" onPress={scanOrImport} disabled={isLoading} />
      <BlueSpacing20 />

      <View style={[styles.inputContainer, { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor }]}>
        <TextInput
          testID="MuSig2VaultKeyInput"
          value={input}
          onChangeText={setInput}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={MUSIG2_SIGNER_INPUT_PLACEHOLDER}
          placeholderTextColor={colors.alternativeTextColor}
          style={[styles.input, { color: colors.foregroundColor }]}
        />
      </View>

      {normalized && (
        <View style={styles.validation}>
          <BlueText bold>Valid Taproot signer</BlueText>
          <BlueText>Fingerprint: {normalized.participant.masterFingerprint}</BlueText>
          <BlueText>Derivation: {normalized.participant.derivationPath}</BlueText>
          <BlueText selectable numberOfLines={2}>XPUB: {normalized.participant.xpub}</BlueText>
        </View>
      )}

      <BlueSpacing20 />
      {isLoading ? <ActivityIndicator /> : <Button testID="MuSig2UseVaultKey" title="Use this Vault Key" onPress={useInput} disabled={!normalized} />}
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, marginBottom: 8 },
  description: { lineHeight: 20, marginBottom: 20 },
  inputContainer: { minHeight: 190, borderWidth: 1, borderRadius: 8, padding: 12 },
  input: { minHeight: 165, fontSize: 13, textAlignVertical: 'top' },
  validation: { gap: 4, marginTop: 16 },
});

export default MuSig2VaultKey;
