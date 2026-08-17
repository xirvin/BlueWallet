import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { validateMuSig2VaultSigners } from '../../blue_modules/musig2/vault';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import Button from '../../components/Button';
import MultipleStepsListItem, { MultipleStepsListItemDashType } from '../../components/MultipleStepsListItem';
import presentAlert from '../../components/Alert';
import { useTheme } from '../../components/themes';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';

type NavigationProps = NativeStackNavigationProp<AddWalletStackParamList, 'WalletsAddMuSig2Step2'>;
type RouteProps = RouteProp<AddWalletStackParamList, 'WalletsAddMuSig2Step2'>;

const WalletsAddMuSig2Step2: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { signerCount, walletLabel } = useRoute<RouteProps>().params;
  const [signers, setSigners] = useState<string[]>(() => new Array(signerCount).fill(''));
  const data = useMemo(() => Array.from({ length: signerCount }, (_, index) => index), [signerCount]);

  const editKey = useCallback(
    (index: number) => {
      navigation.navigate('MuSig2VaultKey', {
        keyIndex: index + 1,
        walletLabel,
        initialValue: signers[index],
        onSave: expression => {
          setSigners(current => current.map((value, signerIndex) => (signerIndex === index ? expression : value)));
        },
      });
    },
    [navigation, signers, walletLabel],
  );

  const continueToDescriptor = useCallback(() => {
    try {
      const normalized = validateMuSig2VaultSigners(signers, signerCount);
      navigation.navigate('MuSig2DescriptorReview', {
        signerCount,
        walletLabel,
        signerExpressions: normalized,
      });
    } catch (error: any) {
      presentAlert({ title: 'MuSig2 Vault validation', message: error?.message ?? String(error) });
    }
  }, [navigation, signerCount, signers, walletLabel]);

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
              checked={isChecked}
              dashes={isLast ? MultipleStepsListItemDashType.Top : MultipleStepsListItemDashType.TopAndBottom}
              rightButton={{
                text: isChecked ? 'Edit' : 'Add',
                onPress: () => editKey(index),
              }}
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
