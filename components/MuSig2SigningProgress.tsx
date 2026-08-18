import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import BlueText from './BlueText';
import Icon from './Icon';
import { useTheme } from './themes';

export type MuSig2SignerProgressItem = {
  id: string;
  title: string;
  subtitle: string;
  complete: boolean;
};

type Props = {
  phase: 1 | 2 | 3;
  collected: number;
  expected: number;
  label: string;
  signers: MuSig2SignerProgressItem[];
};

const RING_SIZE = 142;
const RING_STROKE = 7;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const MuSig2SigningProgress: React.FC<Props> = ({ phase, collected, expected, label, signers }) => {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const complete = expected > 0 && collected >= expected;
  const fraction = expected > 0 ? Math.min(1, collected / expected) : 0;
  const ringColor = complete ? colors.successColor : colors.newBlue;

  useEffect(() => {
    pop.setValue(0.94);
    Animated.spring(pop, {
      toValue: 1,
      speed: 18,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  }, [collected, pop]);

  useEffect(() => {
    if (complete) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [complete, pulse]);

  const stepState = useMemo(
    () => [
      { title: 'Round 1', done: phase > 1, active: phase === 1 },
      { title: 'Round 2', done: phase > 2, active: phase === 2 },
      { title: 'Finalize', done: false, active: phase === 3 },
    ],
    [phase],
  );

  const haloStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.28] }),
    transform: [
      {
        scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }),
      },
    ],
  };

  return (
    <View>
      <View style={styles.stepper} accessibilityLabel={`MuSig2 signing step ${phase} of 3`}>
        {stepState.map((step, index) => (
          <React.Fragment key={step.title}>
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  { borderColor: colors.formBorder, backgroundColor: colors.elevated },
                  step.active && { borderColor: colors.newBlue, backgroundColor: colors.newBlue },
                  step.done && { borderColor: colors.successColor, backgroundColor: colors.successColor },
                ]}
              >
                {step.done ? (
                  <Icon name="check" type="font-awesome" size={12} color={colors.inverseForegroundColor} />
                ) : (
                  <BlueText style={[styles.stepNumber, step.active && { color: colors.inverseForegroundColor }]}>{index + 1}</BlueText>
                )}
              </View>
              <BlueText
                style={[
                  styles.stepLabel,
                  { color: colors.alternativeTextColor },
                  step.active && { color: colors.newBlue, fontWeight: '700' },
                  step.done && { color: colors.successColor, fontWeight: '700' },
                ]}
              >
                {step.title}
              </BlueText>
            </View>
            {index < stepState.length - 1 && (
              <View
                style={[
                  styles.stepLine,
                  { backgroundColor: colors.formBorder },
                  (step.done || step.active) && { backgroundColor: step.done ? colors.successColor : colors.newBlue },
                ]}
              />
            )}
          </React.Fragment>
        ))}
      </View>

      <View style={styles.progressArea}>
        <View style={styles.ringContainer}>
          <Animated.View style={[styles.halo, { backgroundColor: colors.newBlue }, haloStyle]} />
          <Svg width={RING_SIZE} height={RING_SIZE} style={styles.ringSvg}>
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={colors.buttonDisabledBackgroundColor}
              strokeWidth={RING_STROKE}
            />
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={ringColor}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          </Svg>
          <Animated.View style={[styles.progressValueContainer, { transform: [{ scale: pop }] }]}>
            <BlueText style={[styles.progressValue, { color: ringColor }]}>
              {collected}
              <BlueText style={[styles.progressExpected, { color: colors.foregroundColor }]}>/{expected}</BlueText>
            </BlueText>
          </Animated.View>
        </View>
        <BlueText bold style={styles.progressLabel}>
          {label}
        </BlueText>
        <View style={[styles.progressTrack, { backgroundColor: colors.buttonDisabledBackgroundColor }]}>
          <View style={[styles.progressFill, { width: `${fraction * 100}%`, backgroundColor: ringColor }]} />
        </View>
      </View>

      <View style={[styles.signerCard, { borderColor: colors.cardBorderColor, backgroundColor: colors.cardSectionBackground }]}>
        {signers.map((signer, index) => (
          <View
            key={signer.id}
            style={[
              styles.signerRow,
              index < signers.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lightBorder },
            ]}
          >
            <View
              style={[
                styles.signerIcon,
                { backgroundColor: signer.complete ? colors.receiveBackground : colors.buttonDisabledBackgroundColor },
              ]}
            >
              <Icon
                name={signer.complete ? 'check' : 'key'}
                type="font-awesome"
                size={14}
                color={signer.complete ? colors.successColor : colors.alternativeTextColor}
              />
            </View>
            <View style={styles.signerText}>
              <BlueText bold>{signer.title}</BlueText>
              <BlueText style={[styles.signerSubtitle, { color: colors.alternativeTextColor }]} numberOfLines={1}>
                {signer.subtitle}
              </BlueText>
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: signer.complete ? colors.receiveBackground : colors.buttonDisabledBackgroundColor },
              ]}
            >
              <BlueText
                style={[
                  styles.statusText,
                  { color: signer.complete ? colors.successColor : colors.alternativeTextColor },
                ]}
              >
                {signer.complete ? (phase === 1 ? 'Nonce received' : 'Signature received') : phase === 1 ? 'Waiting for nonce' : 'Waiting for signature'}
              </BlueText>
              <Icon
                name={signer.complete ? 'check-circle' : 'clock-o'}
                type="font-awesome"
                size={14}
                color={signer.complete ? colors.successColor : colors.alternativeTextColor}
              />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginBottom: 24 },
  stepItem: { width: 72, alignItems: 'center' },
  stepCircle: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepNumber: { fontSize: 13, fontWeight: '700' },
  stepLabel: { marginTop: 6, fontSize: 12 },
  stepLine: { height: 2, flex: 1, maxWidth: 58, marginTop: 14 },
  progressArea: { alignItems: 'center', marginBottom: 24 },
  ringContainer: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2 },
  ringSvg: { position: 'absolute' },
  progressValueContainer: { alignItems: 'center', justifyContent: 'center' },
  progressValue: { fontSize: 42, fontWeight: '700', letterSpacing: -1 },
  progressExpected: { fontSize: 25, fontWeight: '600' },
  progressLabel: { marginTop: 12, fontSize: 16 },
  progressTrack: { marginTop: 12, width: 150, height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3 },
  signerCard: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  signerRow: { minHeight: 72, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  signerIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  signerText: { flex: 1, minWidth: 0 },
  signerSubtitle: { fontSize: 12, marginTop: 3 },
  statusBadge: { borderRadius: 15, paddingHorizontal: 9, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 8 },
  statusText: { fontSize: 11, fontWeight: '600' },
});

export default MuSig2SigningProgress;
