import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, TextInput, View } from 'react-native';

import {
  MUSIG2_SIGNER_INPUT_PLACEHOLDER,
  MUSIG2_SIGNER_DERIVATION,
  assertMuSig2ParticipantAccountAvailable,
  createMuSig2TaprootSignerWalletForVault,
  deriveMuSig2TaprootSignerAccountWalletForVault,
  isMuSig2TaprootSignerMnemonic,
  normalizeMuSig2VaultSigner,
  parseMuSig2SignerDerivationPath,
  taprootWalletToMuSig2KeyExpression,
} from '../../blue_modules/musig2/vault';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
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
  const { keyIndex, walletLabel, initialValue = '', onSave, onBarScanned, requiredDerivationPath } = route.params;
  const saveSigner = onSave as (keyExpression: string, label?: string, derivationPath?: string) => void;
  const { addAndSaveWallet, wallets } = useStorage();
  const [input, setInput] = useState(initialValue);
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const allTaprootWallets = useMemo(
    () => wallets.filter(wallet => wallet.type === HDTaprootWallet.type) as HDTaprootWallet[],
    [wallets],
  );
  const existingVaults = useMemo(
    () => wallets.filter(wallet => wallet.type === HDTaprootMuSig2Wallet.type) as HDTaprootMuSig2Wallet[],
    [wallets],
  );
  const existingMuSig2SignerWallets = useMemo(
    () =>
      allTaprootWallets.filter(wallet => {
        try {
          return parseMuSig2SignerDerivationPath(wallet.getDerivationPath()).scheme === 'nunchuk-bip87';
        } catch {
          return false;
        }
      }),
    [allTaprootWallets],
  );

  const createMnemonicAccountWallet = useCallback(
    (mnemonic: string, signerPassphrase: string) =>
      createMuSig2TaprootSignerWalletForVault(
        mnemonic,
        signerPassphrase,
        existingVaults,
        requiredDerivationPath,
      ),
    [existingVaults, requiredDerivationPath],
  );

  const preview = useMemo<SignerPreview | undefined>(() => {
    if (!input.trim()) return undefined;

    if (isMuSig2TaprootSignerMnemonic(input)) {
      try {
        const wallet = createMnemonicAccountWallet(input, usePassphrase ? passphrase : '');
        const keyExpression = taprootWalletToMuSig2KeyExpression(wallet);
        const normalized = normalizeMuSig2VaultSigner(keyExpression, requiredDerivationPath);
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
      const normalized = normalizeMuSig2VaultSigner(input, requiredDerivationPath);
      assertMuSig2ParticipantAccountAvailable(normalized.participant, existingVaults);
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
  }, [createMnemonicAccountWallet, existingVaults, input, passphrase, requiredDerivationPath, usePassphrase]);

  const validationError = useMemo(() => {
    if (!input.trim() || preview) return undefined;
    try {
      if (isMuSig2TaprootSignerMnemonic(input)) {
        createMnemonicAccountWallet(input, usePassphrase ? passphrase : '');
      } else {
        const normalized = normalizeMuSig2VaultSigner(input, requiredDerivationPath);
        assertMuSig2ParticipantAccountAvailable(normalized.participant, existingVaults);
      }
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [createMnemonicAccountWallet, existingVaults, input, passphrase, preview, requiredDerivationPath, usePassphrase]);

  const previewIsKnownLocalWallet = useMemo(() => {
    if (!preview) return false;
    return allTaprootWallets.some(wallet => {
      try {
        return taprootWalletToMuSig2KeyExpression(wallet) === preview.keyExpression;
      } catch {
        return false;
      }
    });
  }, [allTaprootWallets, preview]);

  const assignPublicExpression = useCallback(
    (expression: string) => {
      const normalized = normalizeMuSig2VaultSigner(expression, requiredDerivationPath);
      assertMuSig2ParticipantAccountAvailable(normalized.participant, existingVaults);
      const signerLabel = `Signer ${normalized.participant.masterFingerprint?.toUpperCase() ?? keyIndex}`;
      saveSigner(normalized.keyExpression, signerLabel, normalized.participant.derivationPath);
      navigation.goBack();
    },
    [existingVaults, keyIndex, navigation, requiredDerivationPath, saveSigner],
  );

  const useInput = useCallback(async () => {
    if (!preview) return;

    setIsLoading(true);
    try {
      if (isMuSig2TaprootSignerMnemonic(input)) {
        const wallet = createMnemonicAccountWallet(input, usePassphrase ? passphrase : '');
        const defaultLabel = `${walletLabel} · Vault Key ${keyIndex}`;
        let signerWalletLabel = defaultLabel;

        try {
          const requestedLabel = await prompt('How would you like to name this wallet?', 'MuSig2 signer wallet', {
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
        const normalized = normalizeMuSig2VaultSigner(expression, requiredDerivationPath);

        if (!wallets.some(existing => existing.getID() === wallet.getID())) {
          await addAndSaveWallet(wallet);
        }

        saveSigner(expression, signerWalletLabel, normalized.participant.derivationPath);
        navigation.goBack();
        return;
      }

      assignPublicExpression(input);
    } catch (error: any) {
      presentAlert({ title: `Vault Key ${keyIndex}`, message: error?.message ?? String(error) });
    } finally {
      setIsLoading(false);
    }
  }, [addAndSaveWallet, assignPublicExpression, createMnemonicAccountWallet, input, keyIndex, navigation, passphrase, preview, requiredDerivationPath, saveSigner, usePassphrase, walletLabel, wallets]);

  const createNewTaprootKey = useCallback(async () => {
    const defaultLabel = `${walletLabel} · Vault Key ${keyIndex}`;
    let signerWalletLabel = defaultLabel;

    try {
      const requestedLabel = await prompt('How would you like to name this wallet?', 'MuSig2 signer wallet', {
        type: 'plain-text',
        defaultValue: defaultLabel,
        continueButtonText: 'Create',
      });
      signerWalletLabel = requestedLabel.trim() || defaultLabel;
    } catch (error) {
      if (error instanceof Error && error.message === 'Cancel Pressed') return;
      presentAlert({ title: 'Could not name MuSig2 signer wallet', message: error instanceof Error ? error.message : String(error) });
      return;
    }

    setIsLoading(true);
    try {
      const seedWallet = new HDTaprootWallet();
      seedWallet._derivationPath = MUSIG2_SIGNER_DERIVATION;
      await seedWallet.generate();

      const wallet = createMnemonicAccountWallet(seedWallet.getSecret(), '');
      wallet.setLabel(signerWalletLabel);
      const expression = taprootWalletToMuSig2KeyExpression(wallet);
      const normalized = normalizeMuSig2VaultSigner(expression, requiredDerivationPath);
      await addAndSaveWallet(wallet);

      saveSigner(expression, signerWalletLabel, normalized.participant.derivationPath);
      setInput(expression);
      setUsePassphrase(false);
      setPassphrase('');

      navigation.navigate('WalletsAddMultisigVaultKeySheet', {
        keyIndex,
        seed: wallet.getSecret(),
      });
    } catch (error: any) {
      presentAlert({ title: 'Could not create MuSig2 signer wallet', message: error?.message ?? String(error) });
    } finally {
      setIsLoading(false);
    }
  }, [addAndSaveWallet, createMnemonicAccountWallet, keyIndex, navigation, requiredDerivationPath, saveSigner, walletLabel]);

  const chooseExistingTaprootWallet = useCallback(() => {
    if (existingMuSig2SignerWallets.length === 0) {
      presentAlert({ message: "No existing Nunchuk-style m/87'/0'/account' MuSig2 signer wallets are available." });
      return;
    }

    const options = [
      ...existingMuSig2SignerWallets.map(wallet => `${wallet.getLabel()} · ${wallet.getDerivationPath()}`),
      'Cancel',
    ];
    const cancelButtonIndex = options.length - 1;
    ActionSheet.showActionSheetWithOptions(
      {
        title: 'Use existing MuSig2 signer',
        message: requiredDerivationPath
          ? `This vault uses ${requiredDerivationPath}. BlueWallet will derive that hardened account from the selected local master seed when needed.`
          : 'If this master seed already participates in another MuSig2 vault, BlueWallet will derive its next unused BIP87 account for this new vault.',
        options,
        cancelButtonIndex,
      },
      buttonIndex => {
        if (buttonIndex === undefined || buttonIndex === cancelButtonIndex) return;
        const sourceWallet = existingMuSig2SignerWallets[buttonIndex];
        if (!sourceWallet) return;

        void (async () => {
          try {
            const accountWallet = deriveMuSig2TaprootSignerAccountWalletForVault(
              sourceWallet,
              existingVaults,
              requiredDerivationPath,
            );
            const isSiblingAccount = accountWallet.getID() !== sourceWallet.getID();
            if (isSiblingAccount) {
              accountWallet.setLabel(`${walletLabel} · Vault Key ${keyIndex}`);
              if (!wallets.some(existing => existing.getID() === accountWallet.getID())) {
                await addAndSaveWallet(accountWallet);
              }
            }

            const expression = taprootWalletToMuSig2KeyExpression(accountWallet);
            const normalized = normalizeMuSig2VaultSigner(expression, requiredDerivationPath);
            saveSigner(expression, accountWallet.getLabel(), normalized.participant.derivationPath);
            navigation.goBack();
          } catch (error: any) {
            presentAlert({ title: 'MuSig2 signer wallet', message: error?.message ?? String(error) });
          }
        })();
      },
    );
  }, [addAndSaveWallet, existingMuSig2SignerWallets, existingVaults, keyIndex, navigation, requiredDerivationPath, saveSigner, walletLabel, wallets]);

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
        A BIP87 account belongs to the MuSig2 vault, not to the signer number. Reusing the same local master seed in another vault derives a fresh hardened m/87'/0'/account' xpub instead of reusing an account key.
      </BlueText>
      {requiredDerivationPath && (
        <BlueText bold style={styles.accountPath}>Vault account: {requiredDerivationPath}</BlueText>
      )}

      <BlueText bold style={styles.sectionTitle}>Create or use a local signer wallet</BlueText>
      <BlueText style={styles.sectionDescription}>
        The MuSig2 vault stores only the signer's public account information. The seed stays in the dedicated local signer wallet.
      </BlueText>
      <Button testID="MuSig2CreateTaprootKey" title="Create new MuSig2 signer wallet" onPress={createNewTaprootKey} disabled={isLoading} />
      {existingMuSig2SignerWallets.length > 0 && (
        <>
          <BlueSpacing10 />
          <Button
            testID="MuSig2UseExistingTaprootKey"
            title="Use existing MuSig2 signer"
            onPress={chooseExistingTaprootWallet}
            disabled={isLoading}
          />
        </>
      )}

      <BlueSpacing20 />
      <BlueText bold style={styles.sectionTitle}>Enter signer wallet information</BlueText>
      <BlueText style={styles.sectionDescription}>
        Paste or type seed words, a complete BSMS 1.0 export, a Taproot descriptor, [fingerprint/path]xpub, or compatible JSON. The first Vault Key establishes the BIP87 account for this vault; every remaining Vault Key must use the same account origin.
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
            {preview.kind === 'local-seed' || previewIsKnownLocalWallet ? 'Valid local MuSig2 signer account' : 'Valid external MuSig2 signer'}
          </BlueText>
          <BlueText>Type: Taproot MuSig2 signer</BlueText>
          <BlueText>Fingerprint: {preview.fingerprint}</BlueText>
          <BlueText>Vault account origin: {preview.derivationPath}</BlueText>
          {preview.receiveAddress && <BlueText selectable>Signer account first receive: {preview.receiveAddress}</BlueText>}
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
  description: { lineHeight: 20, marginBottom: 12 },
  accountPath: { marginBottom: 24 },
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