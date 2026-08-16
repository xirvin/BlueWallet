import BIP32Factory, { BIP32Interface } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';

import ecc from '../../blue_modules/noble_ecc';
import { parsePlainPublicKey } from '../../blue_modules/musig2/key-aggregation';
import { hexToUint8Array, uint8ArrayToHex } from '../../blue_modules/uint8array-extras';
import { AbstractHDElectrumWallet } from './abstract-hd-electrum-wallet';

const bip32 = BIP32Factory(ecc);
const BIP328_CHAIN_CODE = hexToUint8Array('868087ca02a6f974c4598924c36b57762d32cb45717167e300622c7167e38965');

/**
 * Watch-capable MuSig2 Taproot wallet using the BIP328 synthetic xpub scheme.
 * Signing support is intentionally kept in the MuSig2 session module so secret
 * nonces never become part of wallet serialization.
 */
export class HDTaprootMuSig2Wallet extends AbstractHDElectrumWallet {
  static readonly type = 'HDtaprootMuSig2';
  static readonly typeReadable = 'HD Taproot MuSig2 (BIP327/328)';
  static readonly derivationPath = 'm';

  // @ts-ignore: override
  public readonly type = HDTaprootMuSig2Wallet.type;
  // @ts-ignore: override
  public readonly typeReadable = HDTaprootMuSig2Wallet.typeReadable;
  public readonly segwitType = 'p2tr';

  private _aggregatePublicKeyHex = '';

  setAggregatePublicKey(publicKey: Uint8Array | string): this {
    const bytes = typeof publicKey === 'string' ? hexToUint8Array(publicKey) : new Uint8Array(publicKey);
    parsePlainPublicKey(bytes);
    this._aggregatePublicKeyHex = uint8ArrayToHex(bytes);
    this._xpub = '';
    this._node0 = undefined;
    this._node1 = undefined;
    this.external_addresses_cache = {};
    this.internal_addresses_cache = {};
    return this;
  }

  getAggregatePublicKey(): Uint8Array {
    if (!this._aggregatePublicKeyHex) throw new Error('MuSig2 aggregate public key is not configured');
    return hexToUint8Array(this._aggregatePublicKeyHex);
  }

  getXpub(): string {
    if (this._xpub) return this._xpub;
    this._xpub = bip32.fromPublicKey(this.getAggregatePublicKey(), BIP328_CHAIN_CODE).toBase58();
    return this._xpub;
  }

  _hdNodeToAddress(hdNode: BIP32Interface): string {
    const { address } = bitcoin.payments.p2tr({ internalPubkey: hdNode.publicKey.slice(1) });
    if (!address) throw new Error('Could not create MuSig2 Taproot address');
    return address;
  }

  _getExternalWIFByIndex(): false {
    return false;
  }

  _getInternalWIFByIndex(): false {
    return false;
  }

  allowSend(): boolean {
    return true;
  }

  allowCosignPsbt(): boolean {
    return true;
  }

  allowMasterFingerprint(): boolean {
    return true;
  }

  allowXpub(): boolean {
    return true;
  }

  allowSignVerifyMessage(): boolean {
    return false;
  }
}
