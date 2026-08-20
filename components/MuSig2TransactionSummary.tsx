import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  MuSig2TransactionSummary as MuSig2TransactionSummaryData,
  formatMuSig2Btc,
  formatMuSig2Sats,
} from '../blue_modules/musig2/transaction-summary';
import BlueText from './BlueText';
import Icon from './Icon';
import { useTheme } from './themes';

type Props = {
  summary: MuSig2TransactionSummaryData;
  isDryRun?: boolean;
  verified?: boolean;
};

const MuSig2TransactionSummary: React.FC<Props> = ({ summary, isDryRun = false, verified = false }) => {
  const { colors } = useTheme();
  const stylesHook = StyleSheet.create({
    card: { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor },
    divider: { backgroundColor: colors.cardBorderColor },
    label: { color: colors.alternativeTextColor },
    recipientAmount: { color: colors.alternativeTextColor },
    verifiedCard: { backgroundColor: colors.receiveBackground, borderColor: colors.cardBorderColor },
  });

  const amountText = `${formatMuSig2Btc(summary.amountSats)}${isDryRun ? ' · test' : ''}`;

  return (
    <>
      <View style={[styles.card, stylesHook.card]} testID="MuSig2TransactionSummary">
        <View style={styles.row}>
          <BlueText style={stylesHook.label}>Amount</BlueText>
          <BlueText bold style={styles.value}>
            {amountText}
          </BlueText>
        </View>

        <View style={[styles.divider, stylesHook.divider]} />

        {summary.recipients.length > 0 ? (
          summary.recipients.map((recipient, index) => (
            <React.Fragment key={`${recipient.address}:${index}`}>
              {index > 0 && <View style={[styles.divider, stylesHook.divider]} />}
              <View style={styles.row}>
                <BlueText style={stylesHook.label}>{summary.recipients.length === 1 ? 'To' : `To ${index + 1}`}</BlueText>
                <View style={styles.recipientValue}>
                  <BlueText selectable numberOfLines={1} ellipsizeMode="middle" style={styles.address}>
                    {recipient.address}
                  </BlueText>
                  {summary.recipients.length > 1 && (
                    <BlueText style={[styles.recipientAmount, stylesHook.recipientAmount]}>
                      {formatMuSig2Btc(recipient.valueSats)}
                    </BlueText>
                  )}
                </View>
              </View>
            </React.Fragment>
          ))
        ) : (
          <View style={styles.row}>
            <BlueText style={stylesHook.label}>To</BlueText>
            <BlueText style={styles.value}>No external recipient</BlueText>
          </View>
        )}

        <View style={[styles.divider, stylesHook.divider]} />

        <View style={styles.row}>
          <BlueText style={stylesHook.label}>Fee</BlueText>
          <BlueText bold style={styles.value}>
            {formatMuSig2Sats(summary.feeSats)}
          </BlueText>
        </View>
      </View>

      {verified && (
        <View style={[styles.verifiedCard, stylesHook.verifiedCard]} testID="MuSig2TransactionSummaryVerified">
          <View style={styles.verifiedRow}>
            <Icon name="check-circle" type="font-awesome" size={15} color={colors.successColor} />
            <BlueText style={styles.verifiedLabel}>Amount verified</BlueText>
            <BlueText bold style={styles.verifiedValue}>
              {amountText}
            </BlueText>
          </View>
          <View style={styles.verifiedRow}>
            <Icon name="check-circle" type="font-awesome" size={15} color={colors.successColor} />
            <BlueText style={styles.verifiedLabel}>Destination verified</BlueText>
            <BlueText numberOfLines={1} ellipsizeMode="middle" style={styles.verifiedValue}>
              {summary.recipients.length === 1 ? summary.recipients[0].address : `${summary.recipients.length} recipients`}
            </BlueText>
          </View>
          <View style={styles.verifiedRow}>
            <Icon name="check-circle" type="font-awesome" size={15} color={colors.successColor} />
            <BlueText style={styles.verifiedLabel}>Fee verified</BlueText>
            <BlueText bold style={styles.verifiedValue}>
              {formatMuSig2Sats(summary.feeSats)}
            </BlueText>
          </View>
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', marginBottom: 18 },
  row: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1, textAlign: 'right', fontSize: 14 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  recipientValue: { flex: 1, alignItems: 'flex-end' },
  address: { width: '100%', textAlign: 'right', fontSize: 12 },
  recipientAmount: { marginTop: 3, fontSize: 11 },
  verifiedCard: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 18 },
  verifiedRow: { minHeight: 31, flexDirection: 'row', alignItems: 'center' },
  verifiedLabel: { marginLeft: 8, fontSize: 12, flex: 1 },
  verifiedValue: { maxWidth: '48%', textAlign: 'right', fontSize: 12 },
});

export default MuSig2TransactionSummary;
