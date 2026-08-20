import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { encodeUR } from '../../blue_modules/ur';
import { getLocalMuSig2SignerMatches } from '../../blue_modules/musig2/local-signer';
import {
  createMuSig2WatchOnlySignerWallet,
  watchOnlyWalletMatchesMuSig2Participant,
} from '../../blue_modules/musig2/signer-management';
import { MultisigCosigner } from '../../class/multisig-cosigner';
import { HDTaprootMuSig2Wallet, MuSig2ParticipantMetadata } from '../../class/wallets/hd-taproot-musig2-wallet';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import presentAlert from '../../components/Alert';
import { BlueSpacing10, BlueSpacing20 } from '../../components/BlueSpacing';
import Button from '../../components/Button';
import MultipleStepsListItem, {
  MultipleStepsListItemButtonType,
  MultipleStepsListItemDashType,
} from '../../components/MultipleStepsListItem';
import { useTheme } from '../../components/themes';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';
import { useScreenProtect } from '../../hooks/useScreenProtect';
import { useSettings } from '../../hooks/context/useSettings';
import { useStorage } from '../../hooks/context/useStorage';
import { DetailViewStackParamList } from '../../navigation/DetailViewStackParamList';

type RouteProps = RouteProp<DetailViewStackParamList, 'ViewEditMuSig2Signers'>;
type NavigationProps = NativeStackNavigationProp<DetailViewStackParamList, 'ViewEditMuSig2Signers'>;

const shortXpub = (xpub?: string): string => {
  if (!xpub) return 'Public signer';
  return `${xpub.slice(0, 8)}…${xpub.slice(-8)}`;
};

const ViewEditMuSig2Signers: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { params } = useRoute<RouteProps>();
  const { wallets, setWalletsWithNewOrder } = useStorage();
  const { isBiometricUseCapableAndEnabled } = useBiometrics();
  const { isPrivacyBlurEnabled } = useSettings();
  const { enableScreenProtect, disableScreenProtect } = useScreenProtect();
  const [busyParticipantIndex, setBusyParticipantIndex] = useState<number>();

  useFocusEffect(
    useCallback(() => {
      if (isPrivacyBlurEnabled) enableScreenProtect();
      return () => disableScreenProtect();
    }, [disableScreenProtect, enableScreenProtect, isPrivacyBlurEnabled]),
  );

  const vault = useMemo(
    () =>
      wallets.find(wallet => wallet.getID() === params.walletID && wallet.type === HDTaprootMuSig2Wallet.type) as
        | HDTaprootMuSig2Wallet
        | undefined,
    [params.walletID, wallets],
  );

  const participants = useMemo(() => vault?.getParticipants() ?? [], [vault]);
  const localTaprootWallets = useMemo(
    () => wallets.filter(wallet => wallet.type === HDTaprootWallet.type) as HDTaprootWallet[],
    [wallets],
  );
  const localSignerMatches = useMemo(
    () => (vault ? getLocalMuSig2SignerMatches(vault, localTaprootWallets) : []),
    [localTaprootWallets, vault],
  );
  const localByParticipant = useMemo(
    () => new Map(localSignerMatches.map(match => [match.participantIndex, match.wallet])),
    [localSignerMatches],
  );
  const watchOnlyWallets = useMemo(
    () => wallets.filter(wallet => wallet.type === WatchOnlyWallet.type) as WatchOnlyWallet[],
    [wallets],
  );

  const viewVaultKey = useCallback(
    (participant: MuSig2ParticipantMetadata, participantIndex: number) => {
      if (!participant.xpub || !participant.masterFingerprint || !participant.derivationPath) {
        presentAlert({ message: 'This MuSig2 Vault Key is missing xpub origin metadata.' });
        return;
      }

      const localWallet = localByParticipant.get(participantIndex);
      const exportJson = MultisigCosigner.exportToJson(participant.masterFingerprint, participant.xpub, participant.derivationPath);
      const exportFilename = `bw-musig2-signer-${participant.masterFingerprint}.json`;
      const cosignerXpubURv2 = encodeUR(exportJson, 175, null)[0];

      navigation.navigate('ViewEditMultisigCosignerViewSheet', {
        walletID: params.walletID,
        vaultKeyData: {
          keyIndex: participantIndex + 1,
          seed: localWallet?.getSecret() ?? '',
          passphrase: localWallet?.getPassphrase() ?? '',
          xpub: participant.xpub,
          fp: participant.masterFingerprint,
          path: participant.derivationPath,
          cosignerXpubURv2,
          exportFilename,
          exportString: exportJson,
        },
      });
    },
    [localByParticipant, navigation, params.walletID],
  );

  const replaceSeedWithXpub = useCallback(
    async (participant: MuSig2ParticipantMetadata, participantIndex: number, localWallet: HDTaprootWallet) => {
      if (busyParticipantIndex !== undefined) return;
      setBusyParticipantIndex(participantIndex);
      try {
        if (await isBiometricUseCapableAndEnabled()) {
          if (!(await unlockWithBiometrics())) return;
        }

        const watchOnly = createMuSig2WatchOnlySignerWallet(localWallet, participant);
        const nextWallets = wallets.map(wallet => (wallet.getID() === localWallet.getID() ? watchOnly : wallet));
        setWalletsWithNewOrder(nextWallets);
        presentAlert({
          title: `Vault Key ${participantIndex + 1} is now external`,
          message: 'The seed was removed from BlueWallet and replaced with its public Taproot xpub. The MuSig2 vault and descriptor remain unchanged.',
        });
      } catch (error: any) {
        presentAlert({ title: 'Could not forget signer seed', message: error?.message ?? String(error) });
      } finally {
        setBusyParticipantIndex(undefined);
      }
    },
    [busyParticipantIndex, isBiometricUseCapableAndEnabled, setWalletsWithNewOrder, wallets],
  );

  const confirmForgetSeed = useCallback(
    (participant: MuSig2ParticipantMetadata, participantIndex: number, localWallet: HDTaprootWallet) => {
      presentAlert({
        title: 'Forget this seed and use xpub?',
        message:
          'BlueWallet will permanently remove the mnemonic and BIP39 passphrase for this Taproot signer and keep an xpub-only watch-only wallet instead. This device will no longer sign for this Vault Key. If the same signer is used by another MuSig2 vault or holds standalone funds, those will also become watch-only until the seed is imported again. The MuSig2 vault, addresses, descriptor, and export data remain unchanged.',
        buttons: [
          { text: 'Keep seed', style: 'cancel' },
          {
            text: 'Forget seed',
            style: 'destructive',
            onPress: () => {
              void replaceSeedWithXpub(participant, participantIndex, localWallet);
            },
          },
        ],
      });
    },
    [replaceSeedWithXpub],
  );

  const importMnemonic = useCallback(
    (participantIndex: number) => {
      navigation.navigate('ViewEditMuSig2ProvideMnemonicSheet', {
        walletID: params.walletID,
        participantIndex,
      });
    },
    [navigation, params.walletID],
  );

  const exportVault = useCallback(() => {
    navigation.navigate('MuSig2DescriptorExport', { walletID: params.walletID });
  }, [navigation, params.walletID]);

  if (!vault) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.elevated }]}>
        <Text style={{ color: colors.foregroundColor }}>MuSig2 vault not found.</Text>
      </View>
    );
  }

  const localSignerCount = localSignerMatches.length;

  return (
    <View style={[styles.root, { backgroundColor: colors.elevated }]}>
      <FlatList
        data={participants}
        keyExtractor={participant => participant.publicKeyHex}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.headerText, { color: colors.foregroundColor }]}>All {participants.length} Vault Keys are required to sign.</Text>
            <BlueSpacing10 />
            <Text style={[styles.headerDescription, { color: colors.alternativeTextColor }]}>
              {localSignerCount} of {participants.length} {localSignerCount === 1 ? 'signer is' : 'signers are'} available on this device. Xpub-only keys are treated as external signers during both MuSig2 rounds.
            </Text>
            <BlueSpacing20 />
          </View>
        }
        renderItem={({ item: participant, index }) => {
          const localWallet = localByParticipant.get(index);
          const watchOnlyWallet = watchOnlyWallets.find(wallet => watchOnlyWalletMatchesMuSig2Participant(wallet, participant));
          const isLast = index === participants.length - 1;
          const fingerprint = participant.masterFingerprint?.toUpperCase() ?? 'Unknown';
          const leftText = localWallet
            ? `${localWallet.getLabel()} · On this device`
            : watchOnlyWallet
              ? `${watchOnlyWallet.getLabel()} · Xpub only`
              : `${shortXpub(participant.xpub)} · External`;

          return (
            <View>
              <MultipleStepsListItem
                checked
                leftText={`Vault Key ${index + 1}`}
                dashes={isLast ? MultipleStepsListItemDashType.Bottom : MultipleStepsListItemDashType.TopAndBottom}
              />
              <MultipleStepsListItem
                button={{
                  testID: `MuSig2VaultKeyView${index + 1}`,
                  buttonType: MultipleStepsListItemButtonType.Partial,
                  leftText,
                  text: 'View',
                  onPress: () => viewVaultKey(participant, index),
                }}
                dashes={MultipleStepsListItemDashType.TopAndBottom}
              />
              {localWallet ? (
                <MultipleStepsListItem
                  showActivityIndicator={busyParticipantIndex === index}
                  button={{
                    testID: `MuSig2VaultKeyForgetSeed${index + 1}`,
                    text: 'Forget this seed and use xpub',
                    buttonType: MultipleStepsListItemButtonType.Full,
                    disabled: busyParticipantIndex !== undefined,
                    onPress: () => confirmForgetSeed(participant, index, localWallet),
                  }}
                  dashes={isLast ? MultipleStepsListItemDashType.Top : MultipleStepsListItemDashType.TopAndBottom}
                />
              ) : (
                <MultipleStepsListItem
                  button={{
                    testID: `MuSig2VaultKeyImportMnemonic${index + 1}`,
                    text: 'I have the mnemonics',
                    buttonType: MultipleStepsListItemButtonType.Full,
                    disabled: busyParticipantIndex !== undefined,
                    onPress: () => importMnemonic(index),
                  }}
                  dashes={isLast ? MultipleStepsListItemDashType.Top : MultipleStepsListItemDashType.TopAndBottom}
                />
              )}
              <Text style={[styles.fingerprint, { color: colors.alternativeTextColor }]}>Fingerprint {fingerprint}</Text>
            </View>
          );
        }}
      />

      <View style={styles.footer}>
        <Button testID="MuSig2ManageKeysExportVault" title="Export Vault Descriptor" onPress={exportVault} />
        <BlueSpacing20 />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  header: { paddingHorizontal: 4 },
  headerText: { fontSize: 15, fontWeight: '700' },
  headerDescription: { fontSize: 13, lineHeight: 19 },
  fingerprint: { fontSize: 11, marginLeft: 46, marginTop: 4, marginBottom: 12 },
  footer: { paddingHorizontal: 22, paddingBottom: 4 },
});

export default ViewEditMuSig2Signers;
