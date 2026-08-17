import { encodeQR } from 'qr';
import React, { Component } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { encodeUR } from '../blue_modules/ur';
import { BlueCurrentTheme } from '../components/themes';
import loc from '../loc';
import QRCode from './QRCode';
import { BlueSpacing20 } from './BlueSpacing';

const { height, width } = Dimensions.get('window');

interface DynamicQRCodeProps {
  value: string;
  walletID?: string;
  capacity?: number;
  hideControls?: boolean;
}

interface DynamicQRCodeState {
  index: number;
  total: number;
  qrCodeHeight: number;
  intervalHandler: ReturnType<typeof setInterval> | number | null;
  displayQRCode: boolean;
  hideControls?: boolean;
  renderError?: string;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class DynamicQRCode extends Component<DynamicQRCodeProps, DynamicQRCodeState> {
  constructor(props: DynamicQRCodeProps) {
    super(props);
    const qrCodeHeight = height > width ? width - 40 : width / 3;
    const qrCodeMaxHeight = 370;
    this.state = {
      index: 0,
      total: 0,
      qrCodeHeight: Math.min(qrCodeHeight, qrCodeMaxHeight),
      intervalHandler: null,
      displayQRCode: true,
    };
  }

  fragments: string[] = [];

  componentWillUnmount() {
    this.stopAutoMove();
  }

  componentDidMount() {
    const { value, capacity = 175, hideControls = true, walletID } = this.props;
    try {
      this.fragments = encodeUR(value, capacity, walletID ?? null);
      this.setState(
        {
          index: 0,
          total: this.fragments.length,
          hideControls,
          displayQRCode: true,
          renderError: undefined,
        },
        () => {
          this.startAutoMove();
        },
      );
    } catch (e) {
      console.log(e);
      this.setState({ displayQRCode: false, hideControls, renderError: errorMessage(e) });
    }
  }

  moveToNextFragment = () => {
    const { index, total } = this.state;
    if (index === total - 1) {
      this.setState({
        index: 0,
      });
    } else {
      this.setState(state => ({
        index: state.index + 1,
      }));
    }
  };

  buildRenderableBBQRFragments = () => {
    const { value, capacity = 175, walletID } = this.props;
    const capacityCandidates = Array.from(
      new Set([capacity, 150, 125, 100, 80, 64, 48, 32].filter(candidate => candidate > 0 && candidate <= capacity)),
    );
    let lastError: unknown;

    for (const candidate of capacityCandidates) {
      try {
        const fragments = encodeUR(value, candidate, walletID ?? null, 'BBQR');
        for (const fragment of fragments) {
          encodeQR(fragment.toUpperCase(), 'raw', {
            ecc: 'low',
            border: 1,
            encoding: 'alphanumeric',
          });
        }
        console.log('BBQr render validation passed:', { capacity: candidate, fragments: fragments.length });
        return fragments;
      } catch (error) {
        lastError = error;
        console.log('BBQr render validation retry:', { capacity: candidate, error: errorMessage(error) });
      }
    }

    throw lastError ?? new Error('Unable to create a renderable BBQr sequence');
  };

  forceUseBBQR = () => {
    const { hideControls = true } = this.props;

    try {
      this.fragments = this.buildRenderableBBQRFragments();
      this.setState({
        index: 0,
        total: this.fragments.length,
        displayQRCode: true,
        renderError: undefined,
      });
    } catch (e) {
      console.log('Could not create renderable BBQr:', e);
      this.setState({ displayQRCode: false, hideControls, renderError: errorMessage(e) });
    }
  };

  forceUseURv2 = () => {
    const { value, capacity = 175, hideControls = true, walletID } = this.props;
    console.log({ value, capacity, walletID });

    try {
      this.fragments = encodeUR(value, capacity, walletID ?? null, 'URv2');
      this.setState({
        index: 0,
        total: this.fragments.length,
        displayQRCode: true,
        renderError: undefined,
      });
    } catch (e) {
      console.log(e);
      this.setState({ displayQRCode: false, hideControls, renderError: errorMessage(e) });
    }
  };

  startAutoMove = () => {
    if (!this.state.intervalHandler)
      this.setState(() => ({
        intervalHandler: setInterval(this.moveToNextFragment, 1000),
      }));
  };

  stopAutoMove = () => {
    clearInterval(this.state.intervalHandler as number);
    this.setState(() => ({
      intervalHandler: null,
    }));
  };

  moveToPreviousFragment = () => {
    const { index, total } = this.state;
    if (index > 0) {
      this.setState(state => ({
        index: state.index - 1,
      }));
    } else {
      this.setState(state => ({
        index: total - 1,
      }));
    }
  };

  onError = (error?: unknown) => {
    const message = errorMessage(error);
    console.log('Could not render dynamic QR code:', error);
    this.setState({ displayQRCode: false, renderError: message });
  };

  render() {
    const currentFragment = this.fragments[this.state.index];

    if (!currentFragment && this.state.displayQRCode) {
      return (
        <View>
          <Text>{loc.send.dynamic_init}</Text>
        </View>
      );
    }

    const qrValue = currentFragment?.toUpperCase() ?? '';
    const encoding = qrValue.startsWith('B$') ? 'alphanumeric' : undefined;

    return (
      <View style={animatedQRCodeStyle.container}>
        <TouchableOpacity
          accessibilityRole="button"
          testID="DynamicCode"
          onPress={() => {
            this.setState(prevState => ({ hideControls: !prevState.hideControls }));
          }}
        >
          {this.state.displayQRCode && (
            <View style={animatedQRCodeStyle.qrcodeContainer}>
              <QRCode
                isLogoRendered={false}
                value={qrValue}
                size={this.state.qrCodeHeight}
                isMenuAvailable={false}
                ecl="L"
                encoding={encoding}
                onError={this.onError}
              />
            </View>
          )}
        </TouchableOpacity>

        {__DEV__ && this.state.renderError && (
          <View style={animatedQRCodeStyle.errorBox}>
            <Text style={animatedQRCodeStyle.errorTitle}>Dynamic QR render error</Text>
            <Text selectable style={animatedQRCodeStyle.errorText}>
              {this.state.renderError}
            </Text>
          </View>
        )}

        {!this.state.hideControls && (
          <View style={animatedQRCodeStyle.container}>
            <BlueSpacing20 />
            <View>
              <Text style={animatedQRCodeStyle.text}>
                {loc.formatString(loc._.of, { number: this.state.index + 1, total: this.state.total })}
              </Text>
            </View>
            <BlueSpacing20 />
            <View style={animatedQRCodeStyle.controller}>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, animatedQRCodeStyle.buttonPrev]}
                onPress={this.moveToPreviousFragment}
              >
                <Text style={animatedQRCodeStyle.text}>{loc.send.dynamic_prev}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, animatedQRCodeStyle.buttonStopStart]}
                onPress={this.state.intervalHandler ? this.stopAutoMove : this.startAutoMove}
              >
                <Text style={animatedQRCodeStyle.text}>{this.state.intervalHandler ? loc.send.dynamic_stop : loc.send.dynamic_start}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={[animatedQRCodeStyle.button, animatedQRCodeStyle.buttonNext]}
                onPress={this.moveToNextFragment}
              >
                <Text style={animatedQRCodeStyle.text}>{loc.send.dynamic_next}</Text>
              </TouchableOpacity>
            </View>

            <View style={animatedQRCodeStyle.controller2}>
              <TouchableOpacity accessibilityRole="button" style={animatedQRCodeStyle.buttonUseFormat} onPress={this.forceUseBBQR}>
                <Text style={animatedQRCodeStyle.text}>Force use BBQr</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={animatedQRCodeStyle.buttonUseFormat} onPress={this.forceUseURv2}>
                <Text style={animatedQRCodeStyle.text}>Force use URv2</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }
}

const animatedQRCodeStyle = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
  },
  qrcodeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    width: '92%',
    borderWidth: 1,
    borderColor: '#d14343',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    backgroundColor: '#fff4f4',
  },
  errorTitle: {
    color: '#a40000',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  errorText: {
    color: '#680000',
    fontSize: 12,
  },
  controller: {
    width: '90%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 25,
    height: 45,
    paddingHorizontal: 18,
  },
  controller2: {
    flexDirection: 'column',
  },
  button: {
    alignItems: 'center',
    height: 45,
    justifyContent: 'center',
  },
  buttonPrev: {
    width: '25%',
    alignItems: 'flex-start',
  },
  buttonUseFormat: {
    alignItems: 'center',
    paddingTop: 25,
  },
  buttonStopStart: {
    width: '50%',
  },
  buttonNext: {
    width: '25%',
    alignItems: 'flex-end',
  },
  text: {
    fontSize: 14,
    color: BlueCurrentTheme.colors.foregroundColor,
    fontWeight: 'bold',
  },
});
