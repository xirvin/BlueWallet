import React from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, TouchableOpacity, View } from 'react-native';

import BlueText from './BlueText';
import Icon from './Icon';
import { useTheme } from './themes';

type Props = {
  visible: boolean;
  statusLabel: string;
  progressLabel: string;
  onClose: () => void;
  onResume: () => void;
  onRestart: () => void;
  onCancelSession: () => void;
};

const MuSig2SessionOptionsSheet: React.FC<Props> = ({
  visible,
  statusLabel,
  progressLabel,
  onClose,
  onResume,
  onRestart,
  onCancelSession,
}) => {
  const { colors } = useTheme();

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close signing session options"
          style={styles.backdrop}
          onPress={onClose}
        />

        <SafeAreaView style={[styles.sheet, { backgroundColor: colors.elevated }]}>
          <View style={styles.grabberContainer}>
            <View style={[styles.grabber, { backgroundColor: colors.cardBorderColor }]} />
          </View>

          <View style={styles.headerRow}>
            <View style={styles.headerSide} />
            <BlueText h4 style={styles.headerTitle}>
              Signing session
            </BlueText>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close signing session options"
              testID="MuSig2SessionOptionsClose"
              style={[styles.closeButton, { backgroundColor: colors.cardSectionBackground }]}
              onPress={onClose}
            >
              <Icon name="times" type="font-awesome" size={18} color={colors.alternativeTextColor} />
            </TouchableOpacity>
          </View>

          <View style={[styles.sessionCard, { backgroundColor: colors.cardSectionBackground, borderColor: colors.cardBorderColor }]}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: colors.newBlue }]} />
              <View style={[styles.statusPill, { backgroundColor: colors.newBlue }]}>
                <BlueText style={[styles.statusPillText, { color: colors.inverseForegroundColor }]}>{statusLabel}</BlueText>
              </View>
            </View>
            <BlueText bold style={styles.sessionTitle}>
              MuSig2 signing in progress
            </BlueText>
            <BlueText style={[styles.progressText, { color: colors.alternativeTextColor }]}>{progressLabel}</BlueText>
          </View>

          <TouchableOpacity
            testID="MuSig2SessionResume"
            accessibilityRole="button"
            activeOpacity={0.78}
            style={[styles.actionButton, { borderColor: colors.cardBorderColor, backgroundColor: colors.cardSectionBackground }]}
            onPress={onResume}
          >
            <View style={styles.buttonLeading}>
              <Icon name="play" type="font-awesome" size={16} color={colors.newBlue} />
              <View style={styles.buttonCopy}>
                <BlueText bold>Resume</BlueText>
                <BlueText style={[styles.buttonDescription, { color: colors.alternativeTextColor }]}>Resume where you left off.</BlueText>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            testID="MuSig2SessionRestart"
            accessibilityRole="button"
            activeOpacity={0.78}
            style={[styles.actionButton, { borderColor: colors.cardBorderColor, backgroundColor: colors.cardSectionBackground }]}
            onPress={onRestart}
          >
            <View style={styles.buttonLeading}>
              <Icon name="refresh" type="font-awesome" size={16} color={colors.newBlue} />
              <View style={styles.buttonCopy}>
                <BlueText bold>Restart</BlueText>
                <BlueText style={[styles.buttonDescription, { color: colors.alternativeTextColor }]}>Discard signing progress and begin fresh Round 1.</BlueText>
              </View>
            </View>
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.cardBorderColor }]} />

          <TouchableOpacity
            testID="MuSig2SessionCancel"
            accessibilityRole="button"
            activeOpacity={0.75}
            style={[styles.destructiveButton, { backgroundColor: colors.redBG }]}
            onPress={onCancelSession}
          >
            <Icon name="trash" type="font-awesome" size={15} color={colors.redText} />
            <View style={styles.destructiveCopy}>
              <BlueText bold style={{ color: colors.redText }}>
                Cancel Transfer
              </BlueText>
              <BlueText style={[styles.buttonDescription, { color: colors.redText }]}>Remove this pending transfer. Nothing will be broadcast.</BlueText>
            </View>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.44)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  grabberContainer: { height: 24, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 42, height: 5, borderRadius: 3 },
  headerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  headerSide: { width: 40 },
  headerTitle: { flex: 1, textAlign: 'center' },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sessionCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 8, marginBottom: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 11 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  sessionTitle: { fontSize: 17 },
  progressText: { marginTop: 5, fontSize: 13, fontWeight: '600' },
  actionButton: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 15,
    paddingVertical: 11,
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonLeading: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  buttonCopy: { flex: 1, marginLeft: 12 },
  buttonDescription: { marginTop: 3, fontSize: 11, lineHeight: 15 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  destructiveButton: {
    minHeight: 64,
    borderRadius: 15,
    paddingHorizontal: 15,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  destructiveCopy: { flex: 1, marginLeft: 12 },
});

export default MuSig2SessionOptionsSheet;
