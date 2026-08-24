import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  MUSIG2_COLDCARD_COMPATIBLE_MODE,
  MUSIG2_NUNCHUK_COMPATIBLE_MODE,
  getMuSig2CompatibilityDescription,
  getMuSig2CompatibilityLabel,
  getMuSig2CompatibilitySubtitle,
} from '../../blue_modules/musig2/compatibility';
import {
  MUSIG2_MAX_SIGNERS,
  MUSIG2_MIN_SIGNERS,
  MUSIG2_WALLET_TYPE_LABEL,
  clampMuSig2SignerCount,
} from '../../blue_modules/musig2/vault';
import type { MuSig2DerivationMode } from '../../class/wallets/hd-taproot-musig2-wallet';
import HeaderRightButton from '../../components/HeaderRightButton';
import Icon from '../../components/Icon';
import ListItem from '../../components/ListItem';
import SafeArea from '../../components/SafeArea';
import { useTheme } from '../../components/themes';
import { AddWalletStackParamList } from '../../navigation/AddWalletStack';

type NavigationProps = NativeStackNavigationProp<AddWalletStackParamList, 'MuSig2Advanced'>;
type MuSig2AdvancedParams = AddWalletStackParamList['MuSig2Advanced'] & {
  derivationMode: MuSig2DerivationMode;
  onDerivationModeSave: (mode: MuSig2DerivationMode) => void;
};
type RouteProps = RouteProp<{ MuSig2Advanced: MuSig2AdvancedParams }, 'MuSig2Advanced'>;

const MuSig2Advanced: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProps>();
  const { signerCount, onSave, derivationMode, onDerivationModeSave } = useRoute<RouteProps>().params;
  const [count, setCount] = useState(clampMuSig2SignerCount(signerCount));
  const [mode, setMode] = useState<MuSig2DerivationMode>(derivationMode);

  const increase = useCallback(() => setCount(value => Math.min(MUSIG2_MAX_SIGNERS, value + 1)), []);
  const decrease = useCallback(() => setCount(value => Math.max(MUSIG2_MIN_SIGNERS, value - 1)), []);
  const done = useCallback(() => {
    onSave(count);
    onDerivationModeSave(mode);
    navigation.goBack();
  }, [count, mode, navigation, onDerivationModeSave, onSave]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'android') {
      navigation.setOptions({
        headerRight: () => <HeaderRightButton disabled={false} title="Done" onPress={done} testID="MuSig2SettingsDone" />,
      });
    }
  }, [done, navigation]);

  return (
    <SafeArea style={[styles.root, { backgroundColor: colors.elevated }]}>
      <Text style={[styles.header, { color: colors.outputValue }]}>Quorum</Text>
      <Text style={[styles.subtitle, { color: colors.alternativeTextColor }]}>MuSig2 Vaults are N-of-N. The threshold always matches the number of signers.</Text>

      <View style={styles.quorum}>
        <View style={styles.column}>
          <Pressable accessibilityRole="button" onPress={increase} disabled={count === MUSIG2_MAX_SIGNERS} style={styles.chevron}>
            <Icon name="keyboard-arrow-up" size={24} type="material" color={count === MUSIG2_MAX_SIGNERS ? colors.buttonDisabledTextColor : '#007AFF'} />
          </Pressable>
          <Text style={[styles.number, { color: colors.outputValue }]}>{count}</Text>
          <Pressable accessibilityRole="button" onPress={decrease} disabled={count === MUSIG2_MIN_SIGNERS} style={styles.chevron}>
            <Icon name="keyboard-arrow-down" size={24} type="material" color={count === MUSIG2_MIN_SIGNERS ? colors.buttonDisabledTextColor : '#007AFF'} />
          </Pressable>
        </View>
        <Text style={styles.of}>of</Text>
        <View style={styles.lockedColumn}>
          <Icon name="lock-outline" type="material" size={18} color={colors.alternativeTextColor} />
          <Text style={[styles.number, { color: colors.outputValue }]}>{count}</Text>
          <Text style={[styles.locked, { color: colors.alternativeTextColor }]}>locked</Text>
        </View>
      </View>

      <Text style={[styles.header, { color: colors.outputValue }]}>Wallet type</Text>
      <ListItem title={MUSIG2_WALLET_TYPE_LABEL} subtitle="Native Taproot MuSig2 wallet" checkmark bottomDivider={false} />
      <ListItem title="BIP87 signer hierarchy" subtitle="m/87'/0'/account'" bottomDivider={false} />

      <Text style={[styles.header, { color: colors.outputValue }]}>MuSig2 derivation</Text>
      <ListItem
        testID="MuSig2NunchukCompatible"
        title={getMuSig2CompatibilityLabel(MUSIG2_NUNCHUK_COMPATIBLE_MODE)}
        subtitle={getMuSig2CompatibilitySubtitle(MUSIG2_NUNCHUK_COMPATIBLE_MODE)}
        onPress={() => setMode(MUSIG2_NUNCHUK_COMPATIBLE_MODE)}
        checkmark={mode === MUSIG2_NUNCHUK_COMPATIBLE_MODE}
        bottomDivider={false}
      />
      <ListItem
        testID="MuSig2ColdcardCompatible"
        title={getMuSig2CompatibilityLabel(MUSIG2_COLDCARD_COMPATIBLE_MODE)}
        subtitle={getMuSig2CompatibilitySubtitle(MUSIG2_COLDCARD_COMPATIBLE_MODE)}
        onPress={() => setMode(MUSIG2_COLDCARD_COMPATIBLE_MODE)}
        checkmark={mode === MUSIG2_COLDCARD_COMPATIBLE_MODE}
        bottomDivider={false}
      />
      <Text style={[styles.subtitle, { color: colors.alternativeTextColor }]}>
        {getMuSig2CompatibilityDescription(mode)} This choice changes the wallet's addresses and is locked when the vault is created.
      </Text>

      {Platform.OS === 'android' && <HeaderRightButton disabled={false} title="Done" onPress={done} testID="MuSig2SettingsDone" />}
    </SafeArea>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20 },
  header: { fontSize: 17, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  quorum: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  column: { alignItems: 'center', width: 72 },
  lockedColumn: { alignItems: 'center', justifyContent: 'center', width: 82, minHeight: 92 },
  chevron: { padding: 6 },
  number: { fontSize: 28, fontWeight: '700' },
  of: { fontSize: 20, marginHorizontal: 18 },
  locked: { fontSize: 11, marginTop: 2 },
});

export default MuSig2Advanced;
