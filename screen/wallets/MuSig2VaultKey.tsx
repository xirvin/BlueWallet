import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, TextInput, View } from 'react-native';

import {
  MUSIG2_SIGNER_INPUT_PLACEHOLDER,
  MUSIG2_SIGNER_DERIVATION,
  createMuSig2TaprootSignerWallet,
  isMuSig2TaprootSignerMnemonic,
  normalizeMuSig2VaultSigner,
  taprootWalletToMuSig2KeyExpression,
} from '../../blue_modules/musig2/vault';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import presentAlert from '../../components/Alert';
import { AddressInputScanButton } from '../../components/AddressInputScanButton';
import { BlueSpacing10, BlueSpacing20 } from '../../components/BlueSpacing';
import BlueText from '../../components/BlueText';
import BlueFormLabel from '../../components/BlueFormLabel';
import Button from '../../components/Button';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { useTheme } from '../../components/themes';
import prompt from '../../helpers/prompt';
import { useStorage } from '../../hooks/context/useStorage';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';
import ActionSheet from '../ActionSheet';

type NavigationProps = NativeStackNavigationProp<AddWalletStackParamList, 'MuSig2VaultKey'>;
type RouteProps = RouteProp<AddWalletStackParamList, 'MuSig2VaultKey'>;

type SignerPreview = {
  kind: 'local-seed' | 'public';
  keyExpression: string;
  fingerprint: string;
  derivationPath: string;
  xpub: string;
  receiveAddress?: string;
};

const MuSig2VaultKey: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const route = useRoute<RouteProps>();
  const { keyIndex, walletLabel, initialValue = '', onSave, onBarScanned } = route.params;
  const saveSigner = onSave as (keyExpression: string, label?: string) => void;
  const { addAndSaveWallet, wallets } = useStorage();
  const [input, setInput] = useState(initialValue);
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const existingTaprootWallets = useMemo(
    () => wallets.filter(wallet => wallet.type === HDTaprootWallet.type) as HDTaprootWallet[],
    [wallets],
  );

  const preview = useMemo<SignerPreview | undefined>(() => {
    if (!input.trim()) return undefined;

    if (isMuSig2TaprootSignerMnemonic(input)) {
      try {
        const wallet = createMuSig2TaprootSignerWallet(input, usePassphrase ? passphrase : '');
        const keyExpression = taprootWalletToMuSig2KeyExpression(wallet);
        const normalized = normalizeMuSig2VaultSigner(keyExpression);
        return {
          kind: 'local-seed',
          keyExpression,
          fingerprint: normalized.participant.masterFingerprint!,
          derivationPath: normalized.participant.derivationPath!,
          xpub: normalized.participant.xpub!,
          receiveAddress: wallet._getExternalAddressByIndex(0),
        };
      } catch {
        return undefined;
      }
    }

    try {
      const normalized = normalizeMuSig2VaultSigner(input);
      return {
        kind: 'public',
        keyExpression: normalized.keyExpression,
        fingerprint: normalized.participant.masterFingerprint!,
        derivationPath: normalized.participant.derivationPath!,
        xpub: normalized.participant.xpub!,
      };
    } catch {
      return undefined;
    }
  }, [input, passphrase, usePassphrase]);

  const validationError = useMemo(() => {
    if (!input.trim() || preview || isMuSig2TaprootSignerMnemonic(input)) return undefined;
    try {
      normalizeMuSig2VaultSigner(input);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [input, preview]);

  const previewIsKnownLocalWallet = useMemo(() => {
    if (!preview) return false;
    return existingTaprootWallets.some(wallet => {
      try {
        return taprootWalletToMuSig2KeyExpression(wallet) === preview.keyExpression;
      } catch {
        return false;
      }
    });
  }, [existingTaprootWallets, preview]);

  const assignPublicExpression = useCallback(
    (expression: string) => {
      const normalized = normalizeMuSig2VaultSigner(expression);
      const signerLabel = `Signer ${normalized.participant.masterFingerprint?.toUpperCase() ?? keyIndex}`;
      saveSigner(normalized.keyExpression, signerLabel);
      navigation.goBack();
    },
    [keyIndex, navigation, saveSigner],
  );

  const useInput = useCallback(async () => {
    if (!preview) return;

    setIsLoading(true);
    try {
      if (isMuSig2TaprootSignerMnemonic(input)) {
        const wallet = createMuSig2TaprootSignerWallet(input, usePassphrase ? passphrase : '');
        const defaultLabel = `${walletLabel} · Vault Key ${keyIndex}`;
        let signerWalletLabel = defaultLabel;

        try {
          const requestedLabel = await prompt('How would you like to name this wallet?', 'Taproot signer wallet', {
            type: 'plain-text',
            defaultValue: defaultLabel,
            continueButtonText: 'Import',
          });
          signerWalletLabel = requestedLabel.trim() || defaultLabel;
        } catch (error) {
          if (error instanceof Error && error.message === 'Cancel Pressed') return;
          throw error;
        }

        wallet.setLabel(signerWalletLabel);
        const expression = taprootWalletToMuSig2KeyExpression(wallet);

        if (!wallets.some(existing => existing.getID() === wallet.getID())) {
          await addAndSaveWallet(wallet);
        }

        saveSigner(expression, signerWalletLabel);
        navigation.goBack();
        return;
      }

      assignPublicExpression(input);
    } catch (error: any) {
      presentAlert({ title: `Vault Key ${keyIndex}`, message: error?.message ?? String(error) });
    } finally {
      setIsLoading(false);
    }
  }, [addAndSaveWallet, assignPublicExpression, input, keyIndex, navigation, passphrase, preview, saveSigner, usePassphrase, walletLabel, wallets]);

  const createNewTaprootKey = useCallback(async () => {
    const defaultLabel = `${walletLabel} · Vault Key ${keyIndex}`;
    let signerWalletLabel = defaultLabel;

    try {
      const requestedLabel = await prompt('How would you like to name this wallet?', 'Taproot signer wallet', {
        type: 'plain-text',
        defaultValue: defaultLabel,
        continueButtonText: 'Create',
      });
      signerWalletLabel = requestedLabel.trim() || defaultLabel;
    } catch (error) {
      if (error instanceof Error && error.message === 'Cancel Pressed') return;
      presentAlert({ title: 'Could not name Taproot signer wallet', message: error instanceof Error ? error.message : String(error) });
      return;
    }

    setIsLoading(true);
    try {
      const wallet = new HDTaprootWallet();
      wallet.setLabel(signerWalletLabel);
      await wallet.generate();
      const expression = taprootWalletToMuSig2KeyExpression(wallet);
      await addAndSaveWallet(wallet);

      saveSigner(expression, signerWalletLabel);
      setInput(expression);
      setUsePassphrase(false);
      setPassphrase('');

      navigation.navigate('WalletsAddMultisigVaultKeySheet', {
        keyIndex,
        seed: wallet.getSecret(),
      });
    } catch (error: any) {
      presentAlert({ title: 'Could not create Taproot signer wallet', message: error?.message ?? String(error) });
    } finally {
      setIsLoading(false);
    }
  }, [addAndSaveWallet, keyIndex, navigation, saveSigner, walletLabel]);

  const chooseExistingTaprootWallet = useCallback(() => {
    if (existingTaprootWallets.length === 0) {
      presentAlert({ message: 'No existing HD Taproot (BIP86) wallets are available.' });
      return;
    }

    const options = [...existingTaprootWallets.map(wallet => wallet.getLabel()), 'Cancel'];
    const cancelButtonIndex = options.length - 1;
    ActionSheet.showActionSheetWithOptions(
      {
        title: 'Use existing Taproot signer wallet',
        message: `Only standard ${MUSIG2_SIGNER_DERIVATION} HD Taproot wallets can be used as local MuSig2 signers.`,
        options,
        cancelButtonIndex,
      },
      buttonIndex => {
        if (buttonIndex === undefined || buttonIndex === cancelButtonIndex) return;
        const wallet = existingTaprootWallets[buttonIndex];
        if (!wallet) return;
        try {
          const expression = taprootWalletToMuSig2KeyExpression(wallet);
          saveSigner(expression, wallet.getLabel());
          navigation.goBack();
        } catch (error: any) {
          presentAlert({ title: 'Taproot signer wallet', message: error?.message ?? String(error) });
        }
      },
    );
  }, [existingTaprootWallets, navigation, saveSigner]);

  const handleImportedText = useCallback((text: string) => {
    setInput(text);
  }, []);

  useEffect(() => {
    if (!onBarScanned) return;
    const data = typeof onBarScanned === 'string' ? onBarScanned : onBarScanned.data ?? '';
    if (data) handleImportedText(data);
    navigation.setParams({ onBarScanned: undefined });
  }, [handleImportedText, navigation, onBarScanned]);

  return (
    <SafeAreaScrollView
      style={{ backgroundColor: colors.elevated }}
      contentContainerStyle={styles.container}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <BlueText bold style={styles.title}>Vault Key {keyIndex}</BlueText>
      <BlueText style={styles.description}>
        Assign a BIP86 Taproot signer to this MuSig2 slot. Create one in BlueWallet, choose an existing Taproot wallet, or paste/type the complete signer information below.
      </BlueText>

      <BlueText bold style={styles.sectionTitle}>Create or use a local signer wallet</BlueText>
      <BlueText style={styles.sectionDescription}>
        Local signers are normal BlueWallet HD Taproot wallets. The MuSig2 vault stores only their public BIP86 account information.
      </BlueText>
      <Button testID="MuSig2CreateTaprootKey" title="Create new Taproot signer wallet" onPress={createNewTaprootKey} disabled={isLoading} />
      {existingTaprootWallets.length > 0 && (
        <>
          <BlueSpacing10 />
          <Button
            testID="MuSig2UseExistingTaprootKey"
            title="Use existing Taproot wallet"
            onPress={chooseExistingTaprootWallet}
            disabled={isLoading}
          />
        </>
      )}

      <BlueSpacing20 />
      <BlueText bold style={styles.sectionTitle}>Enter signer wallet information</BlueText>
      <BlueText style={styles.sectionDescription}>
        Paste or type seed words, a complete BSMS 1.0 export, a Taproot descriptor, [fingerprint/path]xpub, or compatible JSON. QR, file, photo, and clipboard import are also supported.
      </BlueText>

      <AddressInputScanButton
        type="link"
        testID="MuSig2ScanOrImportKey"
        isLoading={isLoading}
        onChangeText={handleImportedText}
      />
      <BlueSpacing10 />

      <View style={[styles.inputContainer, { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor }]}>
        <TextInput
          testID="MuSig2VaultKeyInput"
          value={input}
          onChangeText={handleImportedText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={MUSIG2_SIGNER_INPUT_PLACEHOLDER}
          placeholderTextColor={colors.alternativeTextColor}
          style={[styles.input, { color: colors.foregroundColor }]}
        />
      </View>

      {isMuSig2TaprootSignerMnemonic(input) && (
        <View style={styles.passphraseSection}>
          <View style={styles.toggleRow}>
            <BlueFormLabel>BIP39 passphrase</BlueFormLabel>
            <Switch
              testID="MuSig2SignerPassphraseToggle"
              value={usePassphrase}
              onValueChange={value => {
                setUsePassphrase(value);
                if (!value) setPassphrase('');
              }}
            />
          </View>
          {usePassphrase && (
            <TextInput
              testID="MuSig2SignerPassphraseInput"
              value={passphrase}
              onChangeText={setPassphrase}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Optional BIP39 passphrase"
              placeholderTextColor={colors.alternativeTextColor}
              style={[
                styles.passphraseInput,
                { color: colors.foregroundColor, borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor },
              ]}
            />
          )}
        </View>
      )}

      {preview ? (
        <View style={styles.validation}>
          <BlueText bold style={{ color: colors.successColor }}>
            {preview.kind === 'local-seed' || previewIsKnownLocalWallet ? 'Valid local Taproot signer wallet' : 'Valid external Taproot signer'}
          </BlueText>
          <BlueText>Type: Taproot (P2TR / BIP86)</BlueText>
          <BlueText>Fingerprint: {preview.fingerprint}</BlueText>
          <BlueText>Derivation: {preview.derivationPath}</BlueText>
          {preview.receiveAddress && <BlueText selectable>First receive: {preview.receiveAddress}</BlueText>}
          <BlueText selectable numberOfLines={3}>XPUB: {preview.xpub}</BlueText>
        </View>
      ) : validationError ? (
        <BlueText style={[styles.validationError, { color: colors.alternativeTextColor }]}>{validationError}</BlueText>
      ) : null}

      <BlueSpacing20 />
      {isLoading ? (
        <ActivityIndicator />
      ) : (
        <Button
          testID="MuSig2UseVaultKey"
          title={`Assign to Vault Key ${keyIndex}`}
          onPress={useInput}
          disabled={!preview}
        />
      )}
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, marginBottom: 8 },
  description: { lineHeight: 20, marginBottom: 24 },
  sectionTitle: { fontSize: 17, marginBottom: 6 },
  sectionDescription: { lineHeight: 20, marginBottom: 14 },
  inputContainer: { minHeight: 300, borderWidth: 1, borderRadius: 8, padding: 12 },
  input: { minHeight: 276, fontSize: 14, textAlignVertical: 'top' },
  validation: { gap: 4, marginTop: 16 },
  validationError: { marginTop: 12, lineHeight: 18 },
  passphraseSection: { marginTop: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  passphraseInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, minHeight: 46, marginTop: 10 },
});

export default MuSig2VaultKey;
