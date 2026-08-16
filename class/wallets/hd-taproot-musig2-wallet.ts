import BIP32Factory, { BIP32Interface } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { sha256 } from '@noble/hashes/sha256';

import ecc from '../../blue_modules/noble_ecc';
import { bytesEqual, getPlainPublicKey, keyAgg, parsePlainPublicKey } from '../../blue_modules/musig2/key-aggregation';
import { hexToUint8Array, uint8ArrayToHex } from '../../blue_modules/uint8array-extras';
import { AbstractHDElectrumWallet } from './abstract-hd-electrum-wallet';

const bip32 = BIP32Factory(ecc);
const BIP328_CHAIN_CODE = hexToUint8Array('868087ca02a6f974c4598924c36b57762d32cb45717167e300622c7167e38965');

export type MuSig2ParticipantMetadata = {
  publicKeyHex: string;
  masterFingerprint: string;
  derivationPath: string;
};

function normalizeFingerprint(fingerprint: string): string {
  const normalized = fingerprint.trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(normalized)) {
    throw new Error('MuSig2 signer fingerprint must be exactly 8 hexadecimal characters');
  }
  return normalized;
}

function normalizeDerivationPath(path: string): string {
  const normalized = path.trim().replace(/h/g, "'");
  if (normalized === 'm') return normalized;

  const components = normalized.split('/');
  if (components[0] !== 'm' || components.length < 2) {
    throw new Error('MuSig2 signer derivation path must start with m/');
  }

  for (const component of components.slice(1)) {
    const match = component.match(/^(0|[1-9][0-9]*)'?$/);
    if (!match) throw new Error('MuSig2 signer derivation path is invalid');
    const index = Number(component.replace("'", ''));
    if (!Number.isSafeInteger(index) || index > 0x7fffffff) {
      throw new Error('MuSig2 signer derivation index must be between 0 and 2^31-1');
    }
  }

  return normalized;
}

function normalizeParticipant(participant: MuSig2ParticipantMetadata): MuSig2ParticipantMetadata {
  const publicKey = hexToUint8Array(participant.publicKeyHex.trim());
  parsePlainPublicKey(publicKey);
  return {
    publicKeyHex: uint8ArrayToHex(publicKey),
    masterFingerprint: normalizeFingerprint(participant.masterFingerprint),
    derivationPath: normalizeDerivationPath(participant.derivationPath),
  };
}

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
  private _participants: MuSig2ParticipantMetadata[] = [];

  static fromJson(obj: string): HDTaprootMuSig2Wallet {
    const wallet = super.fromJson(obj) as HDTaprootMuSig2Wallet;

    if (wallet._participants?.length) {
      const storedAggregate = wallet._aggregatePublicKeyHex.toLowerCase();
      wallet.setParticipants(wallet._participants);
      if (storedAggregate && storedAggregate !== wallet._aggregatePublicKeyHex) {
        throw new Error('Serialized MuSig2 aggregate public key does not match participant metadata');
      }
    } else if (wallet._aggregatePublicKeyHex) {
      wallet.setAggregatePublicKey(wallet._aggregatePublicKeyHex);
    }

    return wallet;
  }

  setAggregatePublicKey(publicKey: Uint8Array | string): this {
    const bytes = typeof publicKey === 'string' ? hexToUint8Array(publicKey) : new Uint8Array(publicKey);
    parsePlainPublicKey(bytes);

    if (this._participants.length === 2) {
      const participantKeys = this._participants.map(participant => hexToUint8Array(participant.publicKeyHex));
      const expected = getPlainPublicKey(keyAgg(participantKeys));
      if (!bytesEqual(bytes, expected)) {
        throw new Error('MuSig2 aggregate public key does not match participant metadata');
      }
    }

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

  setParticipants(participants: MuSig2ParticipantMetadata[]): this {
    if (participants.length !== 2) throw new Error('MuSig2 coordinator wallet currently requires exactly two signers');

    const normalized = participants.map(normalizeParticipant);
    if (normalized[0].publicKeyHex === normalized[1].publicKeyHex) {
      throw new Error('MuSig2 signer public keys must be distinct');
    }

    const participantKeys = normalized.map(participant => hexToUint8Array(participant.publicKeyHex));
    this._participants = normalized;
    this.setAggregatePublicKey(getPlainPublicKey(keyAgg(participantKeys)));
    return this;
  }

  getParticipants(): MuSig2ParticipantMetadata[] {
    return this._participants.map(participant => ({ ...participant }));
  }

  hasCompleteParticipantMetadata(): boolean {
    return this._participants.length === 2 && Boolean(this._aggregatePublicKeyHex);
  }

  getID(): string {
    if (!this._aggregatePublicKeyHex) return super.getID();
    return uint8ArrayToHex(sha256(`${this.type}:${this._aggregatePublicKeyHex}`));
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
