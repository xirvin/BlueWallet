import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { normalizeMuSig2VaultSigner, taprootWalletToMuSig2KeyExpression, validateMuSig2VaultSigners } from '../../blue_modules/musig2/vault';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import Button from '../../components/Button';
import MultipleStepsListItem, {
  MultipleStepsListItemButtonType,
  MultipleStepsListItemDashType,
} from '../../components/MultipleStepsListItem';
import presentAlert from '../../components/Alert';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';

type NavigationProps = NativeStackNavigationProp<AddWalletStackParamList, 'WalletsAddMuSig2Step2'>;
type RouteProps = RouteProp<AddWalletStackParamList, 'WalletsAddMuSig2Step2'>;
type MuSig2VaultKeyRouteParams = AddWalletStackParamList['MuSig2VaultKey'] & {
  requiredDerivationPath?: string;
  onSave: (keyExpression: string, label?: string, derivationPath?: string) => void;
};

const WalletsAddMuSig2Step2: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { signerCount, walletLabel } = useRoute<RouteProps>().params;
  const { wallets } = useStorage();
  const [signers, setSigners] = useState<string[]>(() => new Array(signerCount).fill(''));
  const [assignedLabels, setAssignedLabels] = useState<string[]>(() => new Array(signerCount).fill(''));
  const [requiredDerivationPath, setRequiredDerivationPath] = useState<string | undefined>();
  const data = useMemo(() => Array.from({ length: signerCount }, (_, index) => index), [signerCount]);

  const signerLabels = useMemo(
    () =>
      signers.map((expression, index) => {
        if (!expression) return '';

        for (const wallet of wallets) {
          if (wallet.type !== HDTaprootWallet.type) continue;
          try {
            if (taprootWalletToMuSig2KeyExpression(wallet as HDTaprootWallet) === expression) {
              return `${wallet.getLabel()} · On this device`;
            }
          } catch {
            // Ignore non-compatible local wallets and fall through to the
            // manually assigned/public-only signer label below.
          }
        }

        if (assignedLabels[index]) return assignedLabels[index];

        try {
          const normalized = normalizeMuSig2VaultSigner(expression);
          return `Signer ${normalized.participant.masterFingerprint?.toUpperCase() ?? ''}`.trim();
        } catch {
          return 'External signer';
        }
      }),
    [assignedLabels, signers, wallets],
  );

  const editKey = useCallback(
    (index: number) => {
      const params: MuSig2VaultKeyRouteParams = {
        keyIndex: index + 1,
        walletLabel,
        initialValue: signers[index],
        requiredDerivationPath,
        onSave: (expression, label?: string, derivationPath?: string) => {
          if (requiredDerivationPath && derivationPath && derivationPath !== requiredDerivationPath) {
            presentAlert({
              title: 'MuSig2 Vault account',
              message: `All Vault Keys must use ${requiredDerivationPath}.`,
            });
            return;
          }
          setSigners(current => current.map((value, signerIndex) => (signerIndex === index ? expression : value)));
          if (!requiredDerivationPath && derivationPath) setRequiredDerivationPath(derivationPath);
          if (label !== undefined) {
            setAssignedLabels(current => current.map((value, signerIndex) => (signerIndex === index ? label : value)));
          }
        },
      };
      navigation.navigate('MuSig2VaultKey', params);
    },
    [navigation, requiredDerivationPath, signers, walletLabel],
  );

  const continueToDescriptor = useCallback(() => {
    try {
      const normalized = validateMuSig2VaultSigners(signers, signerCount, requiredDerivationPath);
      navigation.navigate('MuSig2DescriptorReview', {
        signerCount,
        walletLabel,
        signerExpressions: normalized,
      });
    } catch (error: any) {
      presentAlert({ title: 'MuSig2 Vault validation', message: error?.message ?? String(error) });
    }
  }, [navigation, requiredDerivationPath, signerCount, signers, walletLabel]);

  return (
    <View style={[styles.root, { backgroundColor: colors.elevated }]}>
      <FlatList
        data={data}
        keyExtractor={index => String(index)}
        contentContainerStyle={styles.list}
        renderItem={({ item: index }) => {
          const isChecked = Boolean(signers[index]);
          const isLast = index === signerCount - 1;
          return (
            <MultipleStepsListItem
              circledText={String(index + 1)}
              leftText={`Vault Key ${index + 1}`}
              leftTextColor={colors.foregroundColor}
              checked={isChecked}
              dashes={isLast ? MultipleStepsListItemDashType.Top : MultipleStepsListItemDashType.TopAndBottom}
              button={
                isChecked
                  ? undefined
                  : {
                      text: 'Add',
                      onPress: () => editKey(index),
                      buttonType: MultipleStepsListItemButtonType.Full,
                    }
              }
              rightButton={
                isChecked
                  ? {
                      text: signerLabels[index] || 'Signer added',
                      textColor: colors.successColor,
                      onPress: () => editKey(index),
                    }
                  : undefined
              }
            />
          );
        }}
      />

      <View style={styles.footer}>
        <Button
          testID="MuSig2ReviewDescriptor"
          title="Review Vault"
          onPress={continueToDescriptor}
          disabled={signers.some(value => !value)}
        />
        <BlueSpacing20 />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  list: { paddingTop: 24 },
  footer: { paddingHorizontal: 20, paddingBottom: 24 },
});

export default WalletsAddMuSig2Step2;