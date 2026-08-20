import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { Psbt } from 'bitcoinjs-lib';
import { useFocusEffect, useLocale, useNavigation } from '@react-navigation/native';

import {
  MuSig2CoordinatorSessionSummary,
  clearMuSig2CoordinatorSession,
  listMuSig2CoordinatorSessions,
} from '../blue_modules/musig2/coordinator-session';
import { createMuSig2DryRun } from '../blue_modules/musig2/dry-run';
import { getMuSig2NonceProgress } from '../blue_modules/musig2/psbt';
import { getMuSig2PartialSignatureProgress } from '../blue_modules/musig2/round2';
import { LightningArkWallet } from '../class/wallets/lightning-ark-wallet';
import { LightningCustodianWallet } from '../class/wallets/lightning-custodian-wallet';
import { MultisigHDWallet } from '../class/wallets/multisig-hd-wallet';
import { HDTaprootMuSig2Wallet } from '../class/wallets/hd-taproot-musig2-wallet';
import WalletGradient from '../class/wallet-gradient';
import { TWallet } from '../class/wallets/types';
import loc, { formatBalance, formatBalanceWithoutSuffix } from '../loc';
import { BitcoinUnit } from '../models/bitcoinUnits';
import { FiatUnit } from '../models/fiatUnit';
import ActionSheet from '../screen/ActionSheet';
import presentAlert from './Alert';
import { BlurredBalanceView } from './BlurredBalanceView';
import MuSig2SessionOptionsSheet from './MuSig2SessionOptionsSheet';
import ToolTipMenu from './TooltipMenu';
import { useSettings } from '../hooks/context/useSettings';
import { useTheme } from './themes';

const HERO_BASE_BODY_MIN_HEIGHT = 120;
const HERO_MIN_BODY_HEIGHT = Math.round(HERO_BASE_BODY_MIN_HEIGHT * 1.2);
const HERO_BOTTOM_PADDING = 32;
const WALLET_LABEL_TOP_GAP = 32;

interface TransactionsNavigationHeaderProps {
  wallet: TWallet;
  unit: BitcoinUnit;
  headerOverlayHeight: number;
  onWalletUnitChange: (unit: BitcoinUnit) => void;
  onManageFundsPressed?: (id?: string) => void;
  onWalletBalanceVisibilityChange?: (shouldHideBalance: boolean) => void;
  unitSwitching?: boolean;
}

type MuSig2SessionDescription = {
  title: string;
  subtitle: string;
  statusLabel: string;
  progressLabel: string;
};

function describeMuSig2Session(session: MuSig2CoordinatorSessionSummary): MuSig2SessionDescription {
  try {
    const psbt = Psbt.fromBase64(session.coordinatorPsbtBase64);
    const nonceProgress = getMuSig2NonceProgress(psbt);

    if (session.state === 'CREATED' || session.state === 'COLLECTING_NONCES') {
      return {
        title: 'MuSig2 signing · Round 1',
        subtitle: `${nonceProgress.collected}/${nonceProgress.expected} public nonces · Tap for options`,
        statusLabel: 'Round 1',
        progressLabel: `${nonceProgress.collected}/${nonceProgress.expected} public nonces collected`,
      };
    }

    const partialProgress = getMuSig2PartialSignatureProgress(psbt);
    if (session.state === 'SIGNATURES_COMPLETE') {
      return {
        title: 'MuSig2 signing · Ready to finalize',
        subtitle: `${partialProgress.collected}/${partialProgress.expected} partial signatures · Tap for options`,
        statusLabel: 'Ready to finalize',
        progressLabel: `${partialProgress.collected}/${partialProgress.expected} partial signatures collected`,
      };
    }

    return {
      title: 'MuSig2 signing · Round 2',
      subtitle: `${partialProgress.collected}/${partialProgress.expected} partial signatures · Tap for options`,
      statusLabel: 'Round 2',
      progressLabel: `${partialProgress.collected}/${partialProgress.expected} partial signatures collected`,
    };
  } catch {
    return {
      title: 'MuSig2 signing session',
      subtitle: 'Saved signing session · Tap for options',
      statusLabel: 'Pending',
      progressLabel: 'Saved signing session',
    };
  }
}

const TransactionsNavigationHeader: React.FC<TransactionsNavigationHeaderProps> = ({
  wallet,
  headerOverlayHeight,
  onWalletUnitChange,
  onManageFundsPressed,
  onWalletBalanceVisibilityChange,
  unit = BitcoinUnit.BTC,
  unitSwitching = false,
}) => {
  const { colors } = useTheme();
  const { hideBalance } = wallet;
  const isLightningWallet = wallet.type === LightningCustodianWallet.type || wallet.type === LightningArkWallet.type;
  const isMuSig2Vault = wallet.type === HDTaprootMuSig2Wallet.type;
  const [allowOnchainAddress, setAllowOnchainAddress] = useState(isLightningWallet);
  const [muSig2Sessions, setMuSig2Sessions] = useState<MuSig2CoordinatorSessionSummary[]>([]);
  const [selectedMuSig2Session, setSelectedMuSig2Session] = useState<MuSig2CoordinatorSessionSummary>();
  const { preferredFiatCurrency } = useSettings();
  const { direction } = useLocale();
  const navigation = useNavigation();

  const selectedMuSig2Description = useMemo(
    () => (selectedMuSig2Session ? describeMuSig2Session(selectedMuSig2Session) : undefined),
    [selectedMuSig2Session],
  );

  const verifyIfWalletAllowsOnchainAddress = useCallback(() => {
    if (isLightningWallet) {
      wallet
        .allowOnchainAddress()
        .then((value: boolean) => setAllowOnchainAddress(value))
        .catch(() => {
          console.error('This LNDhub wallet does not have an onchain address API.');
          setAllowOnchainAddress(false);
        });
    }
  }, [isLightningWallet, wallet]);

  useEffect(() => {
    setAllowOnchainAddress(isLightningWallet);
  }, [isLightningWallet]);

  useEffect(() => {
    verifyIfWalletAllowsOnchainAddress();
  }, [wallet, verifyIfWalletAllowsOnchainAddress]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!isMuSig2Vault) {
        setMuSig2Sessions([]);
        return () => {
          active = false;
        };
      }

      listMuSig2CoordinatorSessions(wallet.getID())
        .then(sessions => {
          if (active) setMuSig2Sessions(sessions);
        })
        .catch(error => {
          console.warn('Could not load MuSig2 signing session index:', error);
          if (active) setMuSig2Sessions([]);
        });

      return () => {
        active = false;
      };
    }, [isMuSig2Vault, wallet]),
  );

  const handleCopyPress = useCallback(() => {
    const value = formatBalance(wallet.getBalance(), unit);
    if (value) Clipboard.setString(value);
  }, [unit, wallet]);

  const handleBalanceVisibility = useCallback(() => {
    onWalletBalanceVisibilityChange?.(!hideBalance);
  }, [hideBalance, onWalletBalanceVisibilityChange]);

  const changeWalletBalanceUnit = () => {
    if (hideBalance) return;
    let newWalletPreferredUnit = wallet.getPreferredBalanceUnit();

    if (newWalletPreferredUnit === BitcoinUnit.BTC) newWalletPreferredUnit = BitcoinUnit.SATS;
    else if (newWalletPreferredUnit === BitcoinUnit.SATS) newWalletPreferredUnit = BitcoinUnit.LOCAL_CURRENCY;
    else newWalletPreferredUnit = BitcoinUnit.BTC;

    onWalletUnitChange(newWalletPreferredUnit);
  };

  const handleManageFundsPressed = useCallback(
    (actionKeyID?: string) => {
      if (onManageFundsPressed) onManageFundsPressed(actionKeyID);
    },
    [onManageFundsPressed],
  );

  const onPressMenuItem = useCallback(
    (id: string) => {
      if (id === actionKeys.WalletBalanceVisibility) handleBalanceVisibility();
      else if (id === actionKeys.CopyToClipboard) handleCopyPress();
    },
    [handleBalanceVisibility, handleCopyPress],
  );

  const showManageFundsActionSheet = useCallback(() => {
    ActionSheet.showActionSheetWithOptions(
      {
        title: loc.lnd.title,
        options: [loc._.cancel, loc.lnd.refill, loc.lnd.refill_external],
        cancelButtonIndex: 0,
      },
      buttonIndex => {
        if (buttonIndex === 1) handleManageFundsPressed(actionKeys.Refill);
        else if (buttonIndex === 2) handleManageFundsPressed(actionKeys.RefillWithExternalWallet);
      },
    );
  }, [handleManageFundsPressed]);

  const resumeMuSig2Session = useCallback(
    (session: MuSig2CoordinatorSessionSummary) => {
      setSelectedMuSig2Session(undefined);
      (navigation as any).navigate('SendDetailsRoot', {
        screen: 'MuSig2Round1QRCode',
        params: {
          psbtBase64: session.round1PsbtBase64,
          walletID: wallet.getID(),
        },
      });
    },
    [navigation, wallet],
  );

  const restartMuSig2Session = useCallback(
    (session: MuSig2CoordinatorSessionSummary) => {
      setSelectedMuSig2Session(undefined);
      presentAlert({
        title: 'Restart MuSig2 signing session?',
        message: 'Collected nonces and partial signatures will be discarded. Every signer must begin again from Round 1.',
        buttons: [
          { text: 'Keep session', style: 'cancel' },
          {
            text: 'Restart',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  const round1Psbt = Psbt.fromBase64(session.round1PsbtBase64);
                  await clearMuSig2CoordinatorSession(wallet.getID(), round1Psbt);
                  setMuSig2Sessions(current => current.filter(item => item.sessionId !== session.sessionId));
                  resumeMuSig2Session(session);
                } catch (error: any) {
                  presentAlert({ title: 'Could not restart MuSig2 session', message: error?.message ?? String(error) });
                }
              })();
            },
          },
        ],
      });
    },
    [resumeMuSig2Session, wallet],
  );

  const cancelMuSig2Session = useCallback(
    (session: MuSig2CoordinatorSessionSummary) => {
      setSelectedMuSig2Session(undefined);
      presentAlert({
        title: 'Cancel MuSig2 signing session?',
        message: 'This pending signing session will be removed. No transaction will be broadcast.',
        buttons: [
          { text: 'Keep session', style: 'cancel' },
          {
            text: 'Cancel session',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  const round1Psbt = Psbt.fromBase64(session.round1PsbtBase64);
                  await clearMuSig2CoordinatorSession(wallet.getID(), round1Psbt);
                  setMuSig2Sessions(current => current.filter(item => item.sessionId !== session.sessionId));
                } catch (error: any) {
                  presentAlert({ title: 'Could not cancel MuSig2 session', message: error?.message ?? String(error) });
                }
              })();
            },
          },
        ],
      });
    },
    [wallet],
  );

  const startMuSig2DryRun = useCallback(() => {
    if (!isMuSig2Vault) return;

    try {
      const dryRun = createMuSig2DryRun(wallet as HDTaprootMuSig2Wallet);
      (navigation as any).navigate('SendDetailsRoot', {
        screen: 'MuSig2Round1QRCode',
        params: {
          memo: 'MuSig2 signing test · no BTC',
          psbtBase64: dryRun.psbt.toBase64(),
          walletID: wallet.getID(),
          isDryRun: true,
        },
      });
    } catch (error: any) {
      presentAlert({ title: 'Could not start MuSig2 test', message: error?.message ?? String(error) });
    }
  }, [isMuSig2Vault, navigation, wallet]);

  const currentBalance = wallet ? wallet.getBalance() : 0;
  const formattedBalance = useMemo(() => {
    return unit === BitcoinUnit.LOCAL_CURRENCY
      ? formatBalance(currentBalance, unit, true)
      : formatBalanceWithoutSuffix(currentBalance, unit, true);
  }, [unit, currentBalance]);

  const balance = !wallet.hideBalance && formattedBalance;

  const toolTipWalletBalanceActions = useMemo(() => {
    return hideBalance
      ? [{ id: actionKeys.WalletBalanceVisibility, text: loc.transactions.details_balance_show, icon: actionIcons.Eye }]
      : [
          { id: actionKeys.WalletBalanceVisibility, text: loc.transactions.details_balance_hide, icon: actionIcons.EyeSlash },
          { id: actionKeys.CopyToClipboard, text: loc.transactions.details_copy, icon: actionIcons.Clipboard },
        ];
  }, [hideBalance]);

  return (
    <View
      style={[
        styles.lineaderGradient,
        {
          paddingTop: headerOverlayHeight,
          minHeight: headerOverlayHeight + HERO_MIN_BODY_HEIGHT,
          backgroundColor: WalletGradient.headerColorFor(wallet.type),
        },
      ]}
    >
      <LinearGradient colors={WalletGradient.gradientsFor(wallet.type)} style={StyleSheet.absoluteFill} />
      <View style={styles.contentContainer}>
        <Text testID="WalletLabel" numberOfLines={1} style={[styles.walletLabel, { writingDirection: direction }]}>
          {wallet.getLabel()}
        </Text>
        <View style={styles.balanceSection}>
          <View style={styles.walletBalanceAndUnitContainer}>
            <ToolTipMenu
              shouldOpenOnLongPress
              isButton
              enableAndroidRipple={false}
              buttonStyle={styles.walletBalance}
              onPressMenuItem={onPressMenuItem}
              actions={toolTipWalletBalanceActions}
            >
              <View style={styles.walletBalance}>
                {hideBalance ? (
                  <BlurredBalanceView />
                ) : (
                  <Text
                    testID="WalletBalance"
                    numberOfLines={1}
                    minimumFontScale={0.5}
                    adjustsFontSizeToFit
                    style={styles.walletBalanceText}
                  >
                    {balance}
                  </Text>
                )}
              </View>
            </ToolTipMenu>
            {!hideBalance && (
              <TouchableOpacity style={styles.walletPreferredUnitView} onPress={changeWalletBalanceUnit} disabled={unitSwitching}>
                <Text style={styles.walletPreferredUnitText}>
                  {unit === BitcoinUnit.LOCAL_CURRENCY ? (preferredFiatCurrency?.endPointKey ?? FiatUnit.USD) : unit}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {(wallet.type === LightningCustodianWallet.type || wallet.type === LightningArkWallet.type) && allowOnchainAddress && (
            <TouchableOpacity style={styles.manageFundsButton} accessibilityRole="button" onPress={showManageFundsActionSheet}>
              <Text style={styles.manageFundsButtonText}>{loc.lnd.title}</Text>
            </TouchableOpacity>
          )}
        </View>
        {wallet.type === MultisigHDWallet.type && (
          <TouchableOpacity style={styles.manageFundsButton} accessibilityRole="button" onPress={() => handleManageFundsPressed()}>
            <Text style={styles.manageFundsButtonText}>{loc.multisig.manage_keys}</Text>
          </TouchableOpacity>
        )}

        {isMuSig2Vault && (
          <TouchableOpacity
            testID="MuSig2SavedWalletDryRun"
            accessibilityRole="button"
            accessibilityLabel="Test MuSig2 signing without bitcoin"
            style={styles.testSigningButton}
            onPress={startMuSig2DryRun}
          >
            <Text style={styles.testSigningButtonText}>Test MuSig2 signing (no BTC)</Text>
          </TouchableOpacity>
        )}

        {isMuSig2Vault && muSig2Sessions.length > 0 && (
          <View style={styles.signingSessions} testID="MuSig2SigningSessions">
            <Text style={styles.signingSessionsTitle}>Signing sessions</Text>
            {muSig2Sessions.map(session => {
              const description = describeMuSig2Session(session);
              return (
                <TouchableOpacity
                  key={session.sessionId}
                  testID={`MuSig2SigningSession-${session.sessionId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${description.title}. ${description.subtitle}`}
                  style={styles.signingSessionRow}
                  onPress={() => setSelectedMuSig2Session(session)}
                >
                  <View style={styles.signingSessionText}>
                    <Text style={styles.signingSessionTitle}>{description.title}</Text>
                    <Text style={styles.signingSessionSubtitle}>{description.subtitle}</Text>
                  </View>
                  <Text style={styles.signingSessionChevron}>›</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <MuSig2SessionOptionsSheet
        visible={Boolean(selectedMuSig2Session)}
        statusLabel={selectedMuSig2Description?.statusLabel ?? 'Pending'}
        progressLabel={selectedMuSig2Description?.progressLabel ?? 'Saved signing session'}
        onClose={() => setSelectedMuSig2Session(undefined)}
        onResume={() => selectedMuSig2Session && resumeMuSig2Session(selectedMuSig2Session)}
        onRestart={() => selectedMuSig2Session && restartMuSig2Session(selectedMuSig2Session)}
        onCancelSession={() => selectedMuSig2Session && cancelMuSig2Session(selectedMuSig2Session)}
      />

      <View style={styles.bottomBarSpacer}>
        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: colors.background,
              ...Platform.select({
                ios: { shadowColor: colors.shadowColor },
                android: {},
              }),
            },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  lineaderGradient: { justifyContent: 'flex-start', position: 'relative' },
  contentContainer: { flex: 1, paddingTop: WALLET_LABEL_TOP_GAP, paddingHorizontal: 16, paddingBottom: HERO_BOTTOM_PADDING },
  bottomBarSpacer: { position: 'relative', height: 12, marginBottom: 0 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: -1, height: 13, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.1, shadowRadius: 6 },
      android: { elevation: 0.5 },
    }),
  },
  walletLabel: { backgroundColor: 'transparent', fontSize: 19, color: 'rgba(255, 255, 255, 0.7)', marginBottom: 4 },
  walletBalance: { flexShrink: 1, marginRight: 6, minHeight: 39, justifyContent: 'center' },
  balanceSection: { flexDirection: 'column', alignItems: 'flex-start' },
  manageFundsButton: {
    marginTop: 14, marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 9, minHeight: 39,
    alignSelf: 'flex-start', justifyContent: 'center', alignItems: 'center',
  },
  manageFundsButtonText: { fontWeight: '500', fontSize: 14, color: '#FFFFFF', padding: 12 },
  testSigningButton: {
    marginTop: 16,
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  testSigningButtonText: { color: '#0C2550', fontSize: 15, fontWeight: '700' },
  walletBalanceAndUnitContainer: { flexDirection: 'row', alignItems: 'center', paddingRight: 10 },
  walletBalanceText: { color: '#fff', fontWeight: 'bold', fontSize: 36, flexShrink: 1 },
  walletPreferredUnitView: {
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.25)', borderRadius: 8, minHeight: 35, minWidth: 65,
  },
  walletPreferredUnitText: { color: '#fff', fontWeight: '600' },
  signingSessions: { marginTop: 18, gap: 8 },
  signingSessionsTitle: { color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  signingSessionRow: {
    minHeight: 58,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.17)',
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  signingSessionText: { flex: 1 },
  signingSessionTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  signingSessionSubtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 12, marginTop: 3 },
  signingSessionChevron: { color: '#FFFFFF', fontSize: 30, lineHeight: 30, marginLeft: 8 },
});

export const actionKeys = {
  CopyToClipboard: 'copyToClipboard',
  WalletBalanceVisibility: 'walletBalanceVisibility',
  Refill: 'refill',
  RefillWithExternalWallet: 'refillWithExternalWallet',
};

export const actionIcons = {
  Eye: { iconValue: 'eye' },
  EyeSlash: { iconValue: 'eye.slash' },
  Clipboard: { iconValue: 'doc.on.doc' },
  Refill: { iconValue: 'goforward.plus' },
  RefillWithExternalWallet: { iconValue: 'qrcode' },
};

export default TransactionsNavigationHeader;
