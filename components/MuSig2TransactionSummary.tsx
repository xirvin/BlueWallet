import React, { useState } from 'react';
import { Modal, SafeAreaView, StyleSheet, TouchableOpacity, View } from 'react-native';

import {
  MuSig2TransactionSummary as MuSig2TransactionSummaryData,
  formatMuSig2Btc,
  formatMuSig2Sats,
} from '../blue_modules/musig2/transaction-summary';
import BlueText from './BlueText';
import CopyTextToClipboard from './CopyTextToClipboard';
import Icon from './Icon';
import { useTheme } from './themes';

type Props = {
  summary: MuSig2TransactionSummaryData;
  isDryRun?: boolean;
  verified?: boolean;
};

const MuSig2TransactionSummary: React.FC<Props> = ({ summary, isDryRun = false, verified = false }) => {
  const { colors } = useTheme();
  const [selectedAddress, setSelectedAddress] = useState<string>();
  const stylesHook = StyleSheet.create({
    card: { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor },
    label: { color: colors.alternativeTextColor },
    recipientAmount: { color: colors.alternativeTextColor },
    address: { color: colors.newBlue },
    verifiedCard: { backgroundColor: colors.receiveBackground, borderColor: colors.cardBorderColor },
    modalRoot: { backgroundColor: colors.elevated },
    modalCard: { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor },
    modalSecondaryText: { color: colors.alternativeTextColor },
    copyText: { color: colors.newBlue },
  });

  const amountText = `${formatMuSig2Btc(summary.amountSats)}${isDryRun ? ' · test' : ''}`;
  const closeAddress = () => setSelectedAddress(undefined);

  return (
    <>
      {!verified && (
        <View style={[styles.card, stylesHook.card]} testID="MuSig2TransactionSummary">
          <View style={styles.summaryRow}>
            <View style={styles.iconSpacer} />
            <BlueText style={[styles.summaryLabel, stylesHook.label]}>Amount</BlueText>
            <BlueText bold style={styles.summaryValue}>
              {amountText}
            </BlueText>
          </View>

          {summary.recipients.length > 0 ? (
            summary.recipients.map((recipient, index) => (
              <TouchableOpacity
                key={`${recipient.address}:${index}`}
                accessibilityRole="button"
                accessibilityLabel={`View full destination address ${recipient.address}`}
                testID={`MuSig2DestinationAddress-${index}`}
                activeOpacity={0.7}
                style={styles.summaryRow}
                onPress={() => setSelectedAddress(recipient.address)}
              >
                <View style={styles.iconSpacer} />
                <BlueText style={[styles.summaryLabel, stylesHook.label]}>
                  {summary.recipients.length === 1 ? 'To' : `To ${index + 1}`}
                </BlueText>
                {summary.recipients.length === 1 ? (
                  <BlueText numberOfLines={1} ellipsizeMode="middle" style={[styles.summaryValue, stylesHook.address]}>
                    {recipient.address}
                  </BlueText>
                ) : (
                  <View style={styles.recipientValue}>
                    <BlueText numberOfLines={1} ellipsizeMode="middle" style={[styles.address, stylesHook.address]}>
                      {recipient.address}
                    </BlueText>
                    <BlueText style={[styles.recipientAmount, stylesHook.recipientAmount]}>
                      {formatMuSig2Btc(recipient.valueSats)}
                    </BlueText>
                  </View>
                )}
                <Icon name="external-link" type="font-awesome" size={12} color={colors.newBlue} />
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.summaryRow}>
              <View style={styles.iconSpacer} />
              <BlueText style={[styles.summaryLabel, stylesHook.label]}>To</BlueText>
              <BlueText style={styles.summaryValue}>No external recipient</BlueText>
            </View>
          )}

          <View style={styles.summaryRow}>
            <View style={styles.iconSpacer} />
            <BlueText style={[styles.summaryLabel, stylesHook.label]}>Fee</BlueText>
            <BlueText bold style={styles.summaryValue}>
              {formatMuSig2Sats(summary.feeSats)}
            </BlueText>
          </View>
        </View>
      )}

      {verified && (
        <View style={[styles.verifiedCard, stylesHook.verifiedCard]} testID="MuSig2TransactionSummaryVerified">
          <View style={styles.summaryRow}>
            <Icon name="check-circle" type="font-awesome" size={15} color={colors.successColor} />
            <BlueText style={styles.summaryLabel}>Amount verified</BlueText>
            <BlueText bold style={styles.summaryValue}>
              {amountText}
            </BlueText>
          </View>
          <TouchableOpacity
            accessibilityRole={summary.recipients.length === 1 ? 'button' : undefined}
            activeOpacity={summary.recipients.length === 1 ? 0.7 : 1}
            disabled={summary.recipients.length !== 1}
            style={styles.summaryRow}
            onPress={() => summary.recipients.length === 1 && setSelectedAddress(summary.recipients[0].address)}
          >
            <Icon name="check-circle" type="font-awesome" size={15} color={colors.successColor} />
            <BlueText style={styles.summaryLabel}>Destination verified</BlueText>
            <BlueText numberOfLines={1} ellipsizeMode="middle" style={[styles.summaryValue, stylesHook.address]}>
              {summary.recipients.length === 1 ? summary.recipients[0].address : `${summary.recipients.length} recipients`}
            </BlueText>
            {summary.recipients.length === 1 && (
              <Icon name="external-link" type="font-awesome" size={12} color={colors.newBlue} />
            )}
          </TouchableOpacity>
          <View style={styles.summaryRow}>
            <Icon name="check-circle" type="font-awesome" size={15} color={colors.successColor} />
            <BlueText style={styles.summaryLabel}>Fee verified</BlueText>
            <BlueText bold style={styles.summaryValue}>
              {formatMuSig2Sats(summary.feeSats)}
            </BlueText>
          </View>
        </View>
      )}

      <Modal
        animationType="slide"
        presentationStyle="pageSheet"
        visible={Boolean(selectedAddress)}
        onRequestClose={closeAddress}
      >
        <SafeAreaView style={[styles.modalRoot, stylesHook.modalRoot]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to MuSig2 signing"
              testID="MuSig2DestinationAddressBack"
              style={styles.backButton}
              onPress={closeAddress}
            >
              <Icon name="arrow-left" type="font-awesome" size={20} color={colors.newBlue} />
            </TouchableOpacity>
            <BlueText h4 style={styles.modalTitle}>
              Destination address
            </BlueText>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.modalContent}>
            <BlueText style={[styles.modalDescription, stylesHook.modalSecondaryText]}>
              Verify the complete Bitcoin destination address before continuing the MuSig2 signing session.
            </BlueText>

            <View style={[styles.fullAddressCard, stylesHook.modalCard]}>
              <BlueText selectable testID="MuSig2FullDestinationAddress" style={styles.fullAddress}>
                {selectedAddress}
              </BlueText>
            </View>

            {selectedAddress && (
              <View style={[styles.copyButton, stylesHook.modalCard]}>
                <Icon name="copy" type="font-awesome" size={15} color={colors.newBlue} />
                <CopyTextToClipboard
                  text={selectedAddress}
                  displayText="Copy address"
                  style={[styles.copyText, stylesHook.copyText]}
                  containerStyle={styles.copyTextContainer}
                  buttonTestID="MuSig2CopyDestinationAddress"
                  textTestID="MuSig2CopyDestinationAddressText"
                />
              </View>
            )}

            <BlueText style={[styles.returnHint, stylesHook.modalSecondaryText]}>Tap the back arrow to return to signing.</BlueText>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 18 },
  verifiedCard: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 18 },
  summaryRow: { minHeight: 31, flexDirection: 'row', alignItems: 'center' },
  iconSpacer: { width: 15 },
  summaryLabel: { marginLeft: 8, fontSize: 12, flex: 1 },
  summaryValue: { maxWidth: '48%', textAlign: 'right', fontSize: 12, marginRight: 6 },
  recipientValue: { maxWidth: '48%', flex: 1, alignItems: 'flex-end', marginRight: 6 },
  address: { width: '100%', textAlign: 'right', fontSize: 12, fontWeight: '600' },
  recipientAmount: { marginTop: 2, fontSize: 11 },
  modalRoot: { flex: 1 },
  modalHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 44 },
  modalContent: { paddingHorizontal: 22, paddingTop: 20 },
  modalDescription: { textAlign: 'center', fontSize: 13, lineHeight: 19, marginBottom: 18 },
  fullAddressCard: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 22 },
  fullAddress: { textAlign: 'center', fontSize: 17, lineHeight: 25 },
  copyButton: {
    marginTop: 14,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  copyTextContainer: { alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  copyText: { marginVertical: 0, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  returnHint: { marginTop: 18, textAlign: 'center', fontSize: 12 },
});

export default MuSig2TransactionSummary;
