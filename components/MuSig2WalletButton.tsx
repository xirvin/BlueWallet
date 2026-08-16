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
      wallet.setParticipantPublicKeys([signer1PublicKey.trim(), signer2PublicKey.trim()]);

      const address = wallet._getExternalAddressByIndex(0);
      if (!address || !address.startsWith('bc1p')) throw new Error('Could not derive a Taproot receiving address');

      addWallet(wallet);
      await saveToDisk();
      setReceivingAddress(address);
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
              Create an experimental 2-of-2 coordinator wallet from two compressed secp256k1 public keys. No private keys are stored on this device.
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
                <BlueText style={[styles.helper, stylesHook.helper]}>
                  This is the first BIP328-derived Taproot receive address for the aggregate MuSig2 key.
                </BlueText>
                <BlueSpacing40 />
                <Button testID="MuSig2Done" title="Done" onPress={close} />
              </>
            ) : (
              <>
                <BlueSpacing20 />
                <BlueFormLabel>Signer 1 public key</BlueFormLabel>
                <TextInput
                  testID="MuSig2Signer1PublicKey"
                  value={signer1PublicKey}
                  onChangeText={setSigner1PublicKey}
                  placeholder="02... or 03... (66 hex characters)"
                  placeholderTextColor="#81868e"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!isCreating}
                  style={[styles.input, stylesHook.input]}
                />

                <BlueFormLabel>Signer 2 public key</BlueFormLabel>
                <TextInput
                  testID="MuSig2Signer2PublicKey"
                  value={signer2PublicKey}
                  onChangeText={setSigner2PublicKey}
                  placeholder="02... or 03... (66 hex characters)"
                  placeholderTextColor="#81868e"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  editable={!isCreating}
                  style={[styles.input, stylesHook.input]}
                />

                <BlueText style={[styles.helper, stylesHook.helper]}>
                  Public keys must be compressed 33-byte secp256k1 keys. Fingerprints and signer derivation metadata can be attached later when hardware-wallet import is implemented.
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
    minHeight: 48,
    marginTop: 8,
    marginBottom: 20,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  helper: {
    fontSize: 13,
    lineHeight: 18,
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
  cancel: {
    marginVertical: 24,
  },
});

export default MuSig2WalletButton;
