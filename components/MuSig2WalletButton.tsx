import React, { useCallback, useState } from 'react';
import {
  DimensionValue,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocale } from '@react-navigation/native';

import triggerHapticFeedback, { HapticFeedbackTypes } from '../blue_modules/hapticFeedback';
import { HDTaprootMuSig2Wallet } from '../class/wallets/hd-taproot-musig2-wallet';
import presentAlert from './Alert';
import BlueButtonLink from './BlueButtonLink';
import BlueFormLabel from './BlueFormLabel';
import { BlueSpacing20, BlueSpacing40 } from './BlueSpacing';
import BlueText from './BlueText';
import Button from './Button';
import SafeAreaScrollView from './SafeAreaScrollView';
import { useTheme } from './themes';
import { useStorage } from '../hooks/context/useStorage';

interface MuSig2WalletButtonProps {
  size: {
    width: DimensionValue | undefined;
    height: DimensionValue | undefined;
  };
}

const MuSig2WalletButton: React.FC<MuSig2WalletButtonProps> = ({ size }) => {
  const { colors } = useTheme();
  const { direction } = useLocale();
  const { addWallet, saveToDisk } = useStorage();
  const [visible, setVisible] = useState(false);
  const [signer1PublicKey, setSigner1PublicKey] = useState('');
  const [signer2PublicKey, setSigner2PublicKey] = useState('');
  const [receivingAddress, setReceivingAddress] = useState('');
  const [rootFingerprint, setRootFingerprint] = useState('');
  const [descriptor, setDescriptor] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const stylesHook = StyleSheet.create({
    card: {
      borderColor: visible ? colors.foregroundColor : colors.buttonDisabledBackgroundColor,
      backgroundColor: colors.buttonDisabledBackgroundColor,
      minWidth: size.width,
      minHeight: size.height,
      height: size.height,
    },
    title: {
      color: colors.foregroundColor,
      writingDirection: direction,
    },
    explain: {
      color: colors.alternativeTextColor,
      writingDirection: direction,
    },
    modal: {
      backgroundColor: colors.elevated,
    },
    input: {
      borderColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
      color: colors.foregroundColor,
    },
    helper: {
      color: colors.alternativeTextColor,
    },
    addressBox: {
      borderColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
  });

  const close = useCallback(() => {
    if (isCreating) return;
    setVisible(false);
  }, [isCreating]);

  const createWallet = useCallback(async () => {
    setIsCreating(true);
    try {
      const wallet = new HDTaprootMuSig2Wallet();
      wallet.setLabel('MuSig2 Vault');
      wallet.setParticipantKeyExpressions([signer1PublicKey, signer2PublicKey]);

      const address = wallet._getExternalAddressByIndex(0);
      if (!address || !address.startsWith('bc1p')) throw new Error('Could not derive a Taproot receiving address');

      addWallet(wallet);
      await saveToDisk();
      setReceivingAddress(address);
      setRootFingerprint(wallet.getMuSig2RootFingerprint());
      setDescriptor(wallet.hasCompleteExtendedParticipantMetadata() ? wallet.getBIP390Descriptor() : '');
      triggerHapticFeedback(HapticFeedbackTypes.NotificationSuccess);
    } catch (error: any) {
      presentAlert({ message: error?.message ?? String(error) });
    } finally {
      setIsCreating(false);
    }
  }, [addWallet, saveToDisk, signer1PublicKey, signer2PublicKey]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="MuSig2 Vault"
        testID="ActivateMuSig2VaultButton"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [pressed && styles.pressed, styles.touchable]}
      >
        <View style={[styles.card, stylesHook.card]}>
          <View style={styles.cardContent}>
            <Image style={styles.image} source={require('../img/addWallet/vault.png')} />
            <View style={styles.textContainer}>
              <BlueText style={[styles.title, stylesHook.title]}>MuSig2 Vault</BlueText>
              <BlueText style={[styles.explain, stylesHook.explain]}>Experimental 2-of-2 Taproot coordinator</BlueText>
            </View>
          </View>
        </View>
      </Pressable>

      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
        <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaScrollView style={[styles.flex1, stylesHook.modal]} contentContainerStyle={styles.modalContent} automaticallyAdjustKeyboardInsets>
            <BlueText h4>MuSig2 Vault</BlueText>
            <BlueText style={[styles.intro, stylesHook.helper]}>
              For hardware signing, paste each signer's BIP380 key expression: [fingerprint/path]xpub.... COLDCARD can export this from Advanced/Tools → Export Wallet → Key Expression. Bare 02/03 public keys remain supported for deterministic test wallets only.
            </BlueText>

            {receivingAddress ? (
              <>
                <BlueSpacing20 />
                <BlueText bold>Wallet created</BlueText>
                <BlueFormLabel>Receiving address</BlueFormLabel>
                <View style={[styles.addressBox, stylesHook.addressBox]}>
                  <BlueText selectable testID="MuSig2ReceivingAddress" style={styles.addressText}>
                    {receivingAddress}
                  </BlueText>
                </View>
                <BlueText testID="MuSig2RootDerivationPath" style={[styles.helper, stylesHook.helper]}>
                  MuSig2 root: {HDTaprootMuSig2Wallet.derivationPath}
                </BlueText>
                <BlueText selectable testID="MuSig2RootFingerprint" style={[styles.helper, stylesHook.helper]}>
                  MuSig2 root fingerprint: {rootFingerprint}
                </BlueText>
                <BlueText testID="MuSig2AddressDerivationPath" style={[styles.helper, stylesHook.helper]}>
                  Address derivation: {HDTaprootMuSig2Wallet.derivationPath}/0/0
                </BlueText>
                {descriptor ? (
                  <>
                    <BlueFormLabel>BIP390 descriptor</BlueFormLabel>
                    <View style={[styles.addressBox, stylesHook.addressBox]}>
                      <BlueText selectable testID="MuSig2BIP390Descriptor" style={styles.descriptorText}>
                        {descriptor}
                      </BlueText>
                    </View>
                    <BlueText style={[styles.helper, stylesHook.helper]}>
                      Hardware-signing metadata is complete. Spending will create a BIP373 Round 1 PSBT for the signers.
                    </BlueText>
                  </>
                ) : (
                  <BlueText style={[styles.helper, stylesHook.helper]}>
                    Test-only public-key wallet. It can derive and monitor addresses, but hardware MuSig2 spending is disabled because signer xpub origins are missing.
                  </BlueText>
                )}
                <BlueText style={[styles.helper, stylesHook.helper]}>
                  This is the first BIP328-derived Taproot receive address for the aggregate MuSig2 key. External receive addresses continue as m/0/1, m/0/2, and so on. The MuSig2 root fingerprint identifies the synthetic aggregate root, not either hardware signer.
                </BlueText>
                <BlueSpacing40 />
                <Button testID="MuSig2Done" title="Done" onPress={close} />
              </>
            ) : (
              <>
                <BlueSpacing20 />
                <BlueFormLabel>Signer 1 key expression</BlueFormLabel>
                <TextInput
                  testID="MuSig2Signer1PublicKey"
                  value={signer1PublicKey}
                  onChangeText={setSigner1PublicKey}
                  placeholder="[FINGERPRINT/86h/0h/0h]xpub..."
                  placeholderTextColor="#81868e"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!isCreating}
                  multiline
                  style={[styles.input, stylesHook.input]}
                />

                <BlueFormLabel>Signer 2 key expression</BlueFormLabel>
                <TextInput
                  testID="MuSig2Signer2PublicKey"
                  value={signer2PublicKey}
                  onChangeText={setSigner2PublicKey}
                  placeholder="[FINGERPRINT/86h/0h/0h]xpub..."
                  placeholderTextColor="#81868e"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!isCreating}
                  multiline
                  style={[styles.input, stylesHook.input]}
                />

                <BlueText style={[styles.helper, stylesHook.helper]}>
                  Use two xpub key expressions for a hardware-compatible wallet. For the existing BIP327 simulator vector, you may still paste two compressed 33-byte public keys instead.
                </BlueText>

                <BlueSpacing20 />
                <Button
                  testID="CreateMuSig2Wallet"
                  title="Create 2-of-2 MuSig2 wallet"
                  disabled={!signer1PublicKey.trim() || !signer2PublicKey.trim() || isCreating}
                  showActivityIndicator={isCreating}
                  onPress={createWallet}
                />
                <BlueButtonLink title="Cancel" onPress={close} style={styles.cancel} />
              </>
            )}
          </SafeAreaScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
  },
  touchable: {
    flex: 1,
    marginBottom: 8,
  },
  card: {
    borderWidth: 1.5,
    borderRadius: 8,
  },
  cardContent: {
    marginHorizontal: 16,
    marginVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  image: {
    width: 34,
    height: 34,
    marginRight: 8,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 18,
  },
  explain: {
    fontSize: 13,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.6,
  },
  modalContent: {
    padding: 24,
  },
  intro: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 72,
    marginTop: 8,
    marginBottom: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  helper: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  addressBox: {
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 12,
    padding: 12,
  },
  addressText: {
    fontSize: 15,
    lineHeight: 21,
  },
  descriptorText: {
    fontSize: 12,
    lineHeight: 17,
  },
  cancel: {
    marginVertical: 24,
  },
});

export default MuSig2WalletButton;
