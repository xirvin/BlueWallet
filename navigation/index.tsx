import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import React, { lazy } from 'react';
import { Platform } from 'react-native';
import UnlockWith from '../screen/UnlockWith';
import { withLazySuspense } from './LazyLoadingIndicator';
import { DetailViewStackParamList } from './DetailViewStackParamList';
import { useStorage } from '../hooks/context/useStorage';
import loc from '../loc';
import navigationStyle, { CloseButtonPosition, withRouteParamHeaderOptions } from '../components/navigationStyle';
import { useTheme } from '../components/themes';
import WalletXpub from '../screen/wallets/xpub';
import WalletExport from '../screen/wallets/WalletExport';
import MuSig2DescriptorExport from '../screen/wallets/MuSig2DescriptorExport';
import MuSig2DescriptorQR from '../screen/wallets/MuSig2DescriptorQR';
import MuSig2NunchukExport from '../screen/wallets/MuSig2NunchukExport';
import MuSig2NunchukQR from '../screen/wallets/MuSig2NunchukQR';
import ViewEditMuSig2ProvideMnemonicSheet from '../screen/wallets/ViewEditMuSig2ProvideMnemonicSheet';
import ViewEditMultisigCosignerViewSheet from '../screen/wallets/ViewEditMultisigCosignerViewSheet';
import ViewEditMultisigProvideMnemonicsSheet from '../screen/wallets/ViewEditMultisigProvideMnemonicsSheet';
import ViewEditMultisigShareCosignerSheet from '../screen/wallets/ViewEditMultisigShareCosignerSheet';
import { navigationGuardRouter } from './navigationGuard';

// Lazy load all components except UnlockWith
const DrawerRoot = lazy(() => import('./DrawerRoot'));
const AddWalletStack = lazy(() => import('./AddWalletStack'));
const SendDetailsStack = lazy(() => import('./SendDetailsStack'));
const LNDCreateInvoiceRoot = lazy(() => import('./LNDCreateInvoiceStack'));
const ScanLNDInvoiceRoot = lazy(() => import('./ScanLNDInvoiceStack'));
const AztecoRedeemStackRoot = lazy(() => import('./AztecoRedeemStack'));
const ExportMultisigCoordinationSetupStack = lazy(() => import('./ExportMultisigCoordinationSetupStack'));
const SignVerifyStackRoot = lazy(() => import('./SignVerifyStack'));
const ScanQRCode = lazy(() => import('../screen/send/ScanQRCode'));
const ViewEditMultisigCosigners = lazy(() => import('../screen/wallets/ViewEditMultisigCosigners'));
const ViewEditMuSig2Signers = lazy(() => import('../screen/wallets/ViewEditMuSig2Signers'));

export const NavigationDefaultOptions: NativeStackNavigationOptions = {
  headerShown: false,
  presentation: 'modal',
  headerShadowVisible: false,
};
export const NavigationFormModalOptions: NativeStackNavigationOptions = {
  headerShown: false,
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
};

export const NavigationFormNoSwipeDefaultOptions: NativeStackNavigationOptions = {
  headerShown: false,
  presentation: 'modal',
  headerShadowVisible: false,
  fullScreenGestureEnabled: false,
};
export const StatusBarLightOptions: NativeStackNavigationOptions = { statusBarStyle: 'light' };

const DetailViewStack = createNativeStackNavigator<DetailViewStackParamList>();

const LazyDrawerRoot = withLazySuspense(DrawerRoot);
const LazyAddWalletStack = withLazySuspense(AddWalletStack);
const LazySendDetailsStack = withLazySuspense(SendDetailsStack);
const LazyLNDCreateInvoiceRoot = withLazySuspense(LNDCreateInvoiceRoot);
const LazyScanLNDInvoiceRoot = withLazySuspense(ScanLNDInvoiceRoot);
const LazyAztecoRedeemStackRoot = withLazySuspense(AztecoRedeemStackRoot);
const LazyExportMultisigCoordinationSetupStack = withLazySuspense(ExportMultisigCoordinationSetupStack);
const LazyViewEditMultisigCosigners = withLazySuspense(ViewEditMultisigCosigners);
const LazyViewEditMuSig2Signers = withLazySuspense(ViewEditMuSig2Signers);
const LazySignVerifyStackRoot = withLazySuspense(SignVerifyStackRoot);
const LazyScanQRCodeComponent = withLazySuspense(ScanQRCode);
const multisigSheetAllowedDetents = Platform.OS === 'ios' ? 'fitToContents' : [0.9];

const MainRoot = () => {
  const { walletsInitialized } = useStorage();
  const theme = useTheme();

  return (
    <DetailViewStack.Navigator UNSTABLE_router={navigationGuardRouter} screenOptions={{ headerShown: false }}>
      {!walletsInitialized ? (
        <DetailViewStack.Screen name="UnlockWithScreen" component={UnlockWith} />
      ) : (
        <>
          <DetailViewStack.Screen name="DrawerRoot" component={LazyDrawerRoot} />

          {/* Modal stacks */}
          <DetailViewStack.Screen name="AddWalletRoot" component={LazyAddWalletStack} options={NavigationDefaultOptions} />
          <DetailViewStack.Screen name="SendDetailsRoot" component={LazySendDetailsStack} options={NavigationFormNoSwipeDefaultOptions} />
          <DetailViewStack.Screen name="LNDCreateInvoiceRoot" component={LazyLNDCreateInvoiceRoot} options={NavigationDefaultOptions} />
          <DetailViewStack.Screen name="ScanLNDInvoiceRoot" component={LazyScanLNDInvoiceRoot} options={NavigationDefaultOptions} />
          <DetailViewStack.Screen name="AztecoRedeemRoot" component={LazyAztecoRedeemStackRoot} options={NavigationDefaultOptions} />

          <DetailViewStack.Screen
            name="WalletExport"
            component={WalletExport}
            options={navigationStyle({
              headerBackVisible: false,
              title: loc.wallets.export_title,
              presentation: 'modal',
              headerShown: true,
              closeButtonPosition: CloseButtonPosition.Right,
            })(theme)}
          />
          <DetailViewStack.Screen
            name="ExportMultisigCoordinationSetupRoot"
            component={LazyExportMultisigCoordinationSetupStack}
            options={NavigationDefaultOptions}
          />
          <DetailViewStack.Screen
            name="ViewEditMultisigCosigners"
            component={LazyViewEditMultisigCosigners}
            options={navigationStyle(
              {
                title: loc.multisig.view_edit_cosigners,
                presentation: 'modal',
                headerShown: true,
                gestureEnabled: false,
                closeButtonPosition: CloseButtonPosition.Right,
              },
              withRouteParamHeaderOptions({ headerRight: true }),
            )(theme)}
          />
          <DetailViewStack.Screen
            name="ViewEditMuSig2Signers"
            component={LazyViewEditMuSig2Signers}
            options={navigationStyle({
              title: loc.multisig.manage_keys,
              presentation: 'modal',
              headerShown: true,
              closeButtonPosition: CloseButtonPosition.Right,
            })(theme)}
          />
          <DetailViewStack.Screen
            name="ViewEditMultisigCosignerViewSheet"
            component={ViewEditMultisigCosignerViewSheet}
            options={navigationStyle({
              presentation: 'formSheet',
              sheetAllowedDetents: multisigSheetAllowedDetents,
              sheetGrabberVisible: true,
              closeButtonPosition: CloseButtonPosition.Right,
              headerShown: true,
              headerTitle: '',
            })(theme)}
          />
          <DetailViewStack.Screen
            name="ViewEditMultisigProvideMnemonicsSheet"
            component={ViewEditMultisigProvideMnemonicsSheet}
            options={navigationStyle({
              presentation: 'formSheet',
              sheetAllowedDetents: multisigSheetAllowedDetents,
              sheetGrabberVisible: true,
              closeButtonPosition: CloseButtonPosition.Right,
              headerShown: true,
              headerTitle: '',
            })(theme)}
          />
          <DetailViewStack.Screen
            name="ViewEditMuSig2ProvideMnemonicSheet"
            component={ViewEditMuSig2ProvideMnemonicSheet}
            options={navigationStyle({
              presentation: 'formSheet',
              sheetAllowedDetents: multisigSheetAllowedDetents,
              sheetGrabberVisible: true,
              closeButtonPosition: CloseButtonPosition.Right,
              headerShown: true,
              headerTitle: '',
            })(theme)}
          />
          <DetailViewStack.Screen
            name="ViewEditMultisigShareCosignerSheet"
            component={ViewEditMultisigShareCosignerSheet}
            options={navigationStyle({
              presentation: 'formSheet',
              sheetAllowedDetents: multisigSheetAllowedDetents,
              sheetGrabberVisible: true,
              closeButtonPosition: CloseButtonPosition.Right,
              headerShown: true,
              headerTitle: '',
            })(theme)}
          />
          <DetailViewStack.Screen
            name="WalletXpub"
            component={WalletXpub}
            options={navigationStyle({
              title: loc.wallets.xpub_title,
              presentation: 'modal',
              headerShown: true,
              closeButtonPosition: CloseButtonPosition.Right,
            })(theme)}
          />
          <DetailViewStack.Screen
            name="MuSig2DescriptorExport"
            component={MuSig2DescriptorExport}
            options={navigationStyle({
              title: 'Export Vault Descriptor',
              presentation: 'modal',
              headerShown: true,
              closeButtonPosition: CloseButtonPosition.Right,
            })(theme)}
          />
          <DetailViewStack.Screen
            name="MuSig2DescriptorQR"
            component={MuSig2DescriptorQR}
            options={navigationStyle({
              title: 'Descriptor QR',
              headerShown: true,
            })(theme)}
          />
          <DetailViewStack.Screen
            name="MuSig2NunchukExport"
            component={MuSig2NunchukExport}
            options={navigationStyle({
              title: 'Nunchuk',
              headerShown: true,
            })(theme)}
          />
          <DetailViewStack.Screen
            name="MuSig2NunchukQR"
            component={MuSig2NunchukQR}
            options={navigationStyle({
              title: 'Nunchuk QR',
              headerShown: true,
            })(theme)}
          />
          <DetailViewStack.Screen
            name="SignVerifyRoot"
            component={LazySignVerifyStackRoot}
            options={{ ...NavigationDefaultOptions, ...StatusBarLightOptions }}
          />

          <DetailViewStack.Screen
            name="ScanQRCode"
            component={LazyScanQRCodeComponent}
            options={{
              headerShown: false,
              statusBarHidden: true,
              orientation: 'portrait',
              presentation: 'fullScreenModal',
            }}
          />
        </>
      )}
    </DetailViewStack.Navigator>
  );
};

export default MainRoot;
export { DetailViewStack };
