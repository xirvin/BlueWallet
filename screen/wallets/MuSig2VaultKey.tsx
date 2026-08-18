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

type ManualSignerValidation = {
  preview?: SignerPreview;
  error?: string;
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
  const [selectedLocalWalletID, setSelectedLocalWalletID] = useState<string>();
  const [manualWalletLabel, setManualWalletLabel] = useState('');
  const [manualFingerprint, setManualFingerprint] = useState('');
  const [manualDerivationPath, setManualDerivationPath] = useState(MUSIG2_SIGNER_DERIVATION);
  const [manualXpub, setManualXpub] = useState('');

  const existingTaprootWallets = useMemo(
    () => wallets.filter(wallet => wallet.type === HDTaprootWallet.type) as HDTaprootWallet[],
    [wallets],
  );

  useEffect(() => {
    if (!initialValue.trim()) return;
    try {
      const normalized = normalizeMuSig2VaultSigner(initialValue);
      setManualFingerprint(normalized.participant.masterFingerprint ?? '');
      setManualDerivationPath(normalized.participant.derivationPath ?? MUSIG2_SIGNER_DERIVATION);
      setManualXpub(normalized.participant.xpub ?? '');
    } catch {
      // The raw import area still handles seeds and other supported formats.
    }
  }, [initialValue]);

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

  const manualValidation = useMemo<ManualSignerValidation>(() => {
    const fingerprint = manualFingerprint.trim().replace(/^0x/i, '').toLowerCase();
    const derivationPath = manualDerivationPath.trim();
    const xpub = manualXpub.trim();

    if (!fingerprint && !xpub) return {};
    if (!fingerprint || !derivationPath || !xpub) {
      return { error: 'Enter the master fingerprint, derivation path, and account XPUB.' };
    }

    const origin = derivationPath.startsWith('m/') ? derivationPath.slice(2) : derivationPath;
    const expression = `[${fingerprint}/${origin}]${xpub}`;

    try {
      const normalized = normalizeMuSig2VaultSigner(expression);
      return {
        preview: {
          kind: 'public',
          keyExpression: normalized.keyExpression,
          fingerprint: normalized.participant.masterFingerprint!,
          derivationPath: normalized.participant.derivationPath!,
          xpub: normalized.participant.xpub!,
        },
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [manualDerivationPath, manualFingerprint, manualXpub]);

  const assignPublicExpression = useCallback(
    (expression: string) => {
      const normalized = normalizeMuSig2VaultSigner(expression);
      saveSigner(normalized.keyExpression);
      navigation.goBack();
    },
    [navigation, saveSigner],
  );

  const assignManualSigner = useCallback(() => {
    if (!manualValidation.preview) {
      presentAlert({ title: `Vault Key ${keyIndex}`, message: manualValidation.error ?? 'Enter valid Taproot signer wallet information.' });
      return;
    }

    const friendlyLabel = manualWalletLabel.trim() || `Signer ${manualValidation.preview.fingerprint.toUpperCase()}`;
    saveSigner(manualValidation.preview.keyExpression, friendlyLabel);
    navigation.goBack();
  }, [keyIndex, manualValidation, manualWalletLabel, navigation, saveSigner]);

  const useInput = useCallback(async () => {
    setIsLoading(true);
    try {
      if (isMuSig2TaprootSignerMnemonic(input)) {
        const wallet = createMuSig2TaprootSignerWallet(input, usePassphrase ? passphrase : '');
        wallet.setLabel(`${walletLabel} · Vault Key ${keyIndex}`);
        const expression = taprootWalletToMuSig2KeyExpression(wallet);

        // Importing a seed deliberately creates a normal local BIP86 Taproot
        // wallet. If that exact wallet is already present, simply reuse it as
        // the signer instead of creating a duplicate wallet entry.
        if (!wallets.some(existing => existing.getID() === wallet.getID())) {
          await addAndSaveWallet(wallet);
        }

        saveSigner(expression, wallet.getLabel());
        navigation.goBack();
        return;
      }

      assignPublicExpression(input);
    } catch (error: any) {
      presentAlert({ title: `Vault Key ${keyIndex}`, message: error?.message ?? String(error) });
    } finally {
      setIsLoading(false);
    }
  }, [addAndSaveWallet, assignPublicExpression, input, keyIndex, navigation, passphrase, saveSigner, usePassphrase, walletLabel, wallets]);

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

      // A newly generated wallet is already the signer for this exact Vault
      // Key slot. Save the assignment before showing its seed backup so the
      // parent list is ready as soon as the user finishes the backup step.
      saveSigner(expression, signerWalletLabel);
      setSelectedLocalWalletID(wallet.getID());
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
    setSelectedLocalWalletID(undefined);
    setInput(text);
  }, []);

  useEffect(() => {
    if (!onBarScanned) return;
    const data = typeof onBarScanned === 'string' ? onBarScanned : onBarScanned.data ?? '';
    if (data) handleImportedText(data);
    navigation.setParams({ onBarScanned: undefined });
  }, [handleImportedText, navigation, onBarScanned]);

  const previewIsKnownLocalWallet = Boolean(selectedLocalWalletID && wallets.some(wallet => wallet.getID() === selectedLocalWalletID));
  const manualInputStyle = [
    styles.manualInput,
    { color: colors.foregroundColor, borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor },
  ];

  return (
    <SafeAreaScrollView
      style={{ backgroundColor: colors.elevated }}
      contentContainerStyle={styles.container}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <BlueText bold style={styles.title}>Vault Key {keyIndex}</BlueText>
      <BlueText style={styles.description}>
        Every MuSig2 Vault signer uses a standard BIP86 Taproot account at {MUSIG2_SIGNER_DERIVATION}. Create a new signer wallet, reuse an existing Taproot wallet, type its public wallet information, or import a signer export.
      </BlueText>

      <BlueText bold style={styles.sectionTitle}>Create or use a local signer wallet</BlueText>
      <BlueText style={styles.sectionDescription}>
        Local signers are normal BlueWallet HD Taproot wallets with bc1p receive addresses. The vault stores their public BIP86 account key expression.
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
      <BlueText bold style={styles.sectionTitle}>Enter wallet information manually</BlueText>
      <BlueText style={styles.sectionDescription}>
        Type the public BIP86 account information from a hardware or external wallet. The seed/private key is not needed on the coordinator.
      </BlueText>

      <BlueFormLabel>Wallet name</BlueFormLabel>
      <TextInput
        testID="MuSig2ManualWalletLabel"
        value={manualWalletLabel}
        onChangeText={setManualWalletLabel}
        autoCapitalize="words"
        autoCorrect={false}
        placeholder={`Signer for Vault Key ${keyIndex}`}
        placeholderTextColor={colors.alternativeTextColor}
        style={manualInputStyle}
      />

      <BlueFormLabel>Master fingerprint</BlueFormLabel>
      <TextInput
        testID="MuSig2ManualFingerprint"
        value={manualFingerprint}
        onChangeText={setManualFingerprint}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        placeholder="F23A9CDE"
        placeholderTextColor={colors.alternativeTextColor}
        style={manualInputStyle}
      />

      <BlueFormLabel>Derivation path</BlueFormLabel>
      <TextInput
        testID="MuSig2ManualDerivationPath"
        value={manualDerivationPath}
        onChangeText={setManualDerivationPath}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={MUSIG2_SIGNER_DERIVATION}
        placeholderTextColor={colors.alternativeTextColor}
        style={manualInputStyle}
      />

      <BlueFormLabel>Account XPUB</BlueFormLabel>
      <TextInput
        testID="MuSig2ManualXpub"
        value={manualXpub}
        onChangeText={setManualXpub}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        placeholder="xpub..."
        placeholderTextColor={colors.alternativeTextColor}
        style={[manualInputStyle, styles.manualXpubInput]}
      />

      {manualValidation.preview ? (
        <View style={styles.manualValidation}>
          <BlueText bold style={{ color: colors.successColor }}>Valid MuSig2 signer information</BlueText>
          <BlueText selectable>Fingerprint: {manualValidation.preview.fingerprint}</BlueText>
          <BlueText selectable>Derivation: {manualValidation.preview.derivationPath}</BlueText>
        </View>
      ) : manualValidation.error ? (
        <BlueText style={{ color: colors.alternativeTextColor, marginBottom: 4 }}>{manualValidation.error}</BlueText>
      ) : null}

      <BlueSpacing10 />
      <Button
        testID="MuSig2AssignManualSigner"
        title={`Assign to Vault Key ${keyIndex}`}
        onPress={assignManualSigner}
        disabled={!manualValidation.preview || isLoading}
      />

      <BlueSpacing20 />
      <BlueText bold style={styles.sectionTitle}>Import or paste signer</BlueText>
      <BlueText style={styles.sectionDescription}>
        Import a BIP39 seed for a local signer, or public-only signer data from BSMS 1.0, a single-key Taproot descriptor, [fingerprint/path]xpub, or compatible JSON. You can also type or paste the complete signer data below. QR, file, photo, and clipboard imports are supported.
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

      {preview && (
        <View style={styles.validation}>
          <BlueText bold>
            {preview.kind === 'local-seed' || previewIsKnownLocalWallet ? 'Valid local Taproot signer wallet' : 'Valid external Taproot signer'}
          </BlueText>
          <BlueText>Type: Taproot (P2TR / BIP86)</BlueText>
          <BlueText>Fingerprint: {preview.fingerprint}</BlueText>
          <BlueText>Derivation: {preview.derivationPath}</BlueText>
          {preview.receiveAddress && <BlueText selectable>First receive: {preview.receiveAddress}</BlueText>}
          <BlueText selectable numberOfLines={3}>XPUB: {preview.xpub}</BlueText>
          <BlueText selectable numberOfLines={4}>Vault key: {preview.keyExpression}</BlueText>
        </View>
      )}

      <BlueSpacing20 />
      {isLoading ? (
        <ActivityIndicator />
      ) : (
        <Button
          testID="MuSig2UseVaultKey"
          title={preview?.kind === 'local-seed' ? 'Import Taproot signer wallet' : 'Use this Vault Key'}
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
  manualInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, minHeight: 46, marginBottom: 14, fontSize: 15 },
  manualXpubInput: { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' },
  manualValidation: { gap: 4, marginBottom: 4 },
  inputContainer: { minHeight: 210, borderWidth: 1, borderRadius: 8, padding: 12 },
  input: { minHeight: 185, fontSize: 13, textAlignVertical: 'top' },
  validation: { gap: 4, marginTop: 16 },
  passphraseSection: { marginTop: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  passphraseInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, minHeight: 46, marginTop: 10 },
});

export default MuSig2VaultKey;
