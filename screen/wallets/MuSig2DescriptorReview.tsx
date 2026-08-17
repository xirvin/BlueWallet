import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { MUSIG2_SIGNER_DERIVATION, MUSIG2_WALLET_TYPE_LABEL, validateMuSig2VaultSigners } from '../../blue_modules/musig2/vault';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import presentAlert from '../../components/Alert';
import BlueText from '../../components/BlueText';
import Button from '../../components/Button';
import SafeAreaScrollView from '../../components/SafeAreaScrollView';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { useSettings } from '../../hooks/context/useSettings';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';

type NavigationProps = NativeStackNavigationProp<AddWalletStackParamList, 'MuSig2DescriptorReview'>;
type RouteProps = RouteProp<AddWalletStackParamList, 'MuSig2DescriptorReview'>;

const MuSig2DescriptorReview: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { signerCount, walletLabel, signerExpressions } = useRoute<RouteProps>().params;
  const { addAndSaveWallet } = useStorage();
  const { isElectrumDisabled } = useSettings();
  const [isSaving, setIsSaving] = useState(false);

  const wallet = useMemo(() => {
    const normalized = validateMuSig2VaultSigners(signerExpressions, signerCount);
    const result = new HDTaprootMuSig2Wallet();
    result.setLabel(walletLabel);
    result.setParticipantKeyExpressions(normalized);
    return result;
  }, [signerCount, signerExpressions, walletLabel]);

  const descriptor = useMemo(() => wallet.getBIP390Descriptor(), [wallet]);
  const receiveAddress = useMemo(() => wallet._getExternalAddressByIndex(0), [wallet]);

  const createVault = useCallback(async () => {
    setIsSaving(true);
    try {
      if (!isElectrumDisabled) await wallet.fetchBalance();
      await addAndSaveWallet(wallet);
      navigation.getParent()?.goBack();
    } catch (error: any) {
      presentAlert({ title: 'Could not create MuSig2 Vault', message: error?.message ?? String(error) });
      setIsSaving(false);
    }
  }, [addAndSaveWallet, isElectrumDisabled, navigation, wallet]);

  return (
    <SafeAreaScrollView style={{ backgroundColor: colors.elevated }} contentContainerStyle={styles.container}>
      <BlueText bold style={styles.title}>Review MuSig2 Vault</BlueText>
      <BlueText style={styles.description}>
        Confirm the quorum, Taproot wallet type, signer origins, and BIP390 descriptor before saving. All signers are required for every spend.
      </BlueText>

      <View style={styles.details}>
        <BlueText bold>Quorum</BlueText>
        <BlueText>{signerCount} of {signerCount}</BlueText>
        <BlueText bold>Wallet type</BlueText>
        <BlueText>{MUSIG2_WALLET_TYPE_LABEL}</BlueText>
        <BlueText bold>Signer account origin</BlueText>
        <BlueText>{MUSIG2_SIGNER_DERIVATION}</BlueText>
        <BlueText bold>First receive address</BlueText>
        <BlueText selectable>{receiveAddress}</BlueText>
      </View>

      <BlueSpacing20 />
      <BlueText bold>BIP390 descriptor</BlueText>
      <View style={[styles.descriptorBox, { borderColor: colors.formBorder, backgroundColor: colors.inputBackgroundColor }]}>
        <BlueText selectable style={styles.descriptor}>{descriptor}</BlueText>
      </View>
      <BlueText style={styles.note}>
        The descriptor is the public coordination policy for this vault. Back it up with the signer origin information. It contains no private keys.
      </BlueText>

      <BlueSpacing20 />
      {isSaving ? <ActivityIndicator /> : <Button testID="CreateMuSig2Vault" title="Create MuSig2 Vault" onPress={createVault} />}
    </SafeAreaScrollView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, marginBottom: 8 },
  description: { lineHeight: 20, marginBottom: 20 },
  details: { gap: 6 },
  descriptorBox: { borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 8 },
  descriptor: { fontSize: 12, lineHeight: 18 },
  note: { marginTop: 10, fontSize: 13, lineHeight: 18 },
});

export default MuSig2DescriptorReview;
