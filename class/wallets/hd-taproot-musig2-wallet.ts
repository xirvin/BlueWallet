import BIP32Factory, { BIP32Interface } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';
import { sha256 } from '@noble/hashes/sha256';
import { CoinSelectReturnInput } from 'coinselect';

import ecc from '../../blue_modules/noble_ecc';
import { bytesEqual, getPlainPublicKey, keyAgg, keySort, parsePlainPublicKey } from '../../blue_modules/musig2/key-aggregation';
import { addMuSig2ParticipantsToInput, addMuSig2ParticipantsToOutput } from '../../blue_modules/musig2/psbt';
import { hexToUint8Array, uint8ArrayToHex } from '../../blue_modules/uint8array-extras';
import { descriptorWithChecksum } from '../wallet-descriptor';
import { AbstractHDElectrumWallet } from './abstract-hd-electrum-wallet';
import { CreateTransactionResult, CreateTransactionTarget, CreateTransactionUtxo } from './types';

const bip32 = BIP32Factory(ecc);
const BIP328_CHAIN_CODE = hexToUint8Array('868087ca02a6f974c4598924c36b57762d32cb45717167e300622c7167e38965');
const MIN_MUSIG2_SIGNERS = 2;
const MAX_MUSIG2_SIGNERS = 7;

export type MuSig2DerivationMode = 'legacy-bip328' | 'bip390-derived-participants';

export type MuSig2ParticipantMetadata = {
  publicKeyHex: string;
  xpub?: string;
  masterFingerprint?: string;
  derivationPath?: string;
};

export type MuSig2CoordinatorExport = {
  format: 'bluewallet-musig2';
  version: 1;
  network: 'bitcoin';
  label: string;
  root: 'm';
  rootFingerprint: string;
  aggregatePublicKey: string;
  derivationMode?: MuSig2DerivationMode;
  xpub?: string;
  descriptor?: string;
  participants: MuSig2ParticipantMetadata[];
};

type DerivedParticipant = {
  participant: MuSig2ParticipantMetadata;
  publicKey: Uint8Array;
};

type AddressParticipantSet = {
  aggregatePublicKey: Uint8Array;
  participantPublicKeys: Uint8Array[];
};

function assertParticipantCount(count: number): void {
  if (!Number.isInteger(count) || count < MIN_MUSIG2_SIGNERS || count > MAX_MUSIG2_SIGNERS) {
    throw new Error(`MuSig2 coordinator wallet requires between ${MIN_MUSIG2_SIGNERS} and ${MAX_MUSIG2_SIGNERS} signers`);
  }
}

function normalizeFingerprint(fingerprint: string): string {
  const normalized = fingerprint.trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(normalized)) {
    throw new Error('MuSig2 signer fingerprint must be exactly 8 hexadecimal characters');
  }
  return normalized;
}

function normalizeDerivationPath(path: string): string {
  const normalized = path.trim().replace(/[hH]/g, "'");
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

function derivationComponentToIndex(component: string): number {
  const hardened = component.endsWith("'");
  const value = Number(component.replace("'", ''));
  return value + (hardened ? 0x80000000 : 0);
}

function validateXpubOrigin(xpub: string, derivationPath: string): BIP32Interface {
  if (!xpub.startsWith('xpub')) throw new Error('MuSig2 hardware signer key must be a mainnet xpub');

  let node: BIP32Interface;
  try {
    node = bip32.fromBase58(xpub);
  } catch {
    throw new Error('MuSig2 signer xpub is invalid');
  }

  const components = derivationPath === 'm' ? [] : derivationPath.split('/').slice(1);
  if (node.depth !== components.length) {
    throw new Error(`MuSig2 signer xpub depth ${node.depth} does not match origin path depth ${components.length}`);
  }
  if (components.length > 0 && node.index !== derivationComponentToIndex(components[components.length - 1])) {
    throw new Error('MuSig2 signer xpub child number does not match the final origin path component');
  }

  return node;
}

function serializeExtendedPublicKey(node: BIP32Interface): Uint8Array {
  const serialized = new Uint8Array(78);
  const view = new DataView(serialized.buffer, serialized.byteOffset, serialized.byteLength);

  view.setUint32(0, node.network.bip32.public, false);
  serialized[4] = node.depth;
  view.setUint32(5, node.parentFingerprint, false);
  view.setUint32(9, node.index, false);
  serialized.set(node.chainCode, 13);
  serialized.set(node.publicKey, 45);
  return serialized;
}

function normalizeCompressedPublicKeyHex(publicKeyHex: string, label: string): string {
  const normalized = publicKeyHex.trim().replace(/\s+/g, '').replace(/^0x/i, '');

  if (normalized.length !== 66) {
    throw new Error(`${label} must be exactly 66 hexadecimal characters (33 bytes); received ${normalized.length}`);
  }
  if (!/^[0-9a-fA-F]{66}$/.test(normalized)) {
    throw new Error(`${label} must contain only hexadecimal characters`);
  }
  if (!/^(02|03)/i.test(normalized)) {
    throw new Error(`${label} must be a compressed secp256k1 public key beginning with 02 or 03`);
  }

  return normalized.toLowerCase();
}

function normalizeParticipant(participant: MuSig2ParticipantMetadata): MuSig2ParticipantMetadata {
  const publicKey = hexToUint8Array(normalizeCompressedPublicKeyHex(participant.publicKeyHex, 'MuSig2 signer public key'));
  parsePlainPublicKey(publicKey);

  const normalized: MuSig2ParticipantMetadata = {
    publicKeyHex: uint8ArrayToHex(publicKey),
  };

  const hasFingerprint = Boolean(participant.masterFingerprint?.trim());
  const hasPath = Boolean(participant.derivationPath?.trim());
  if (hasFingerprint !== hasPath) {
    throw new Error('MuSig2 signer fingerprint and derivation path must be provided together');
  }

  if (hasFingerprint && hasPath) {
    normalized.masterFingerprint = normalizeFingerprint(participant.masterFingerprint!);
    normalized.derivationPath = normalizeDerivationPath(participant.derivationPath!);
  }

  if (participant.xpub?.trim()) {
    const xpub = participant.xpub.trim();
    if (!normalized.derivationPath || !normalized.masterFingerprint) {
      throw new Error('MuSig2 signer xpub requires a master fingerprint and origin derivation path');
    }
    const node = validateXpubOrigin(xpub, normalized.derivationPath);
    if (!bytesEqual(node.publicKey, publicKey)) {
      throw new Error('MuSig2 signer public key does not match the supplied xpub');
    }
    normalized.xpub = xpub;
  }

  return normalized;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function compareParticipantKeys(a: MuSig2ParticipantMetadata, b: MuSig2ParticipantMetadata): number {
  return compareBytes(hexToUint8Array(a.publicKeyHex), hexToUint8Array(b.publicKeyHex));
}

function descriptorOrigin(participant: MuSig2ParticipantMetadata): string {
  if (!participant.xpub || !participant.masterFingerprint || !participant.derivationPath) {
    throw new Error('BIP390 descriptor requires xpub, master fingerprint and origin path for every signer');
  }
  const path = participant.derivationPath === 'm' ? '' : `/${participant.derivationPath.slice(2).replace(/'/g, 'h')}`;
  return `[${participant.masterFingerprint}${path}]${participant.xpub}`;
}

function isMuSig2DerivationMode(value: unknown): value is MuSig2DerivationMode {
  return value === 'legacy-bip328' || value === 'bip390-derived-participants';
}

function isLegacyBlueWalletParticipantSet(participants: MuSig2ParticipantMetadata[]): boolean {
  return (
    participants.length > 0 &&
    participants.every(participant => participant.derivationPath?.replace(/[hH]/g, "'") === "m/86'/0'/0'")
  );
}

/**
 * Parses the BIP380 extended-key expression exported by hardware wallets, for
 * example [f23a9cde/87h/0h/0h]xpub.... Bare compressed public keys remain
 * accepted for deterministic tests and coordinator-only experiments.
 */
export function parseMuSig2ParticipantKeyExpression(input: string): MuSig2ParticipantMetadata {
  const compact = input.trim().replace(/\s+/g, '');

  if (/^(?:0x)?(?:02|03)[0-9a-fA-F]{64}$/i.test(compact)) {
    return normalizeParticipant({ publicKeyHex: compact });
  }

  if (!compact.startsWith('[')) {
    throw new Error('MuSig2 signer must be a compressed public key or [fingerprint/path]xpub key expression');
  }

  const closeBracket = compact.indexOf(']');
  if (closeBracket <= 1) throw new Error('MuSig2 signer key expression is missing its origin');

  const origin = compact.slice(1, closeBracket);
  const xpub = compact.slice(closeBracket + 1);
  const originParts = origin.split('/');
  const masterFingerprint = normalizeFingerprint(originParts[0]);
  const derivationPath = normalizeDerivationPath(originParts.length === 1 ? 'm' : `m/${originParts.slice(1).join('/')}`);
  const node = validateXpubOrigin(xpub, derivationPath);

  return normalizeParticipant({
    publicKeyHex: uint8ArrayToHex(node.publicKey),
    xpub,
    masterFingerprint,
    derivationPath,
  });
}

/**
 * Watch-capable MuSig2 Taproot wallet. New extended-key vaults follow BIP390:
 * derive each participant xpub to /change/index, KeySort the resulting child
 * public keys, then KeyAgg. Existing serialized BlueWallet vaults without an
 * explicit mode remain on their historical BIP328 aggregate-first derivation
 * so their addresses can never change during an upgrade.
 */
export class HDTaprootMuSig2Wallet extends AbstractHDElectrumWallet {
  static readonly type = 'HDtaprootMuSig2';
  static readonly typeReadable = 'MuSig2 Vault';
  static readonly derivationPath = 'm';
  static readonly minSigners = MIN_MUSIG2_SIGNERS;
  static readonly maxSigners = MAX_MUSIG2_SIGNERS;

  // @ts-ignore: override
  public readonly type = HDTaprootMuSig2Wallet.type;
  // @ts-ignore: override
  public readonly typeReadable = HDTaprootMuSig2Wallet.typeReadable;
  public readonly segwitType = 'p2tr';

  private _aggregatePublicKeyHex = '';
  private _participants: MuSig2ParticipantMetadata[] = [];
  private _derivationMode: MuSig2DerivationMode = 'bip390-derived-participants';

  static fromJson(obj: string): HDTaprootMuSig2Wallet {
    const parsed = JSON.parse(obj) as { _derivationMode?: unknown };
    const wallet = super.fromJson(obj) as unknown as HDTaprootMuSig2Wallet;

    // Wallets serialized before the derived-participant migration used BIP328
    // aggregate-first derivation, including early BIP87 experiments.
    wallet._derivationMode = isMuSig2DerivationMode(parsed._derivationMode) ? parsed._derivationMode : 'legacy-bip328';

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

  setDerivationMode(mode: MuSig2DerivationMode): this {
    if (!isMuSig2DerivationMode(mode)) throw new Error('Unsupported MuSig2 derivation mode');
    this._derivationMode = mode;
    this._node0 = undefined;
    this._node1 = undefined;
    this.external_addresses_cache = {};
    this.internal_addresses_cache = {};
    return this;
  }

  getDerivationMode(): MuSig2DerivationMode {
    return this._derivationMode;
  }

  usesDerivedParticipantKeys(): boolean {
    return this._derivationMode === 'bip390-derived-participants';
  }

  setAggregatePublicKey(publicKey: Uint8Array | string): this {
    const bytes =
      typeof publicKey === 'string'
        ? hexToUint8Array(normalizeCompressedPublicKeyHex(publicKey, 'MuSig2 aggregate public key'))
        : new Uint8Array(publicKey);
    parsePlainPublicKey(bytes);

    if (this._participants.length >= MIN_MUSIG2_SIGNERS) {
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

  getMuSig2RootFingerprint(): string {
    return uint8ArrayToHex(bitcoin.crypto.hash160(this.getAggregatePublicKey()).slice(0, 4)).toUpperCase();
  }

  getMasterFingerprintHex(): string {
    return this.getMuSig2RootFingerprint();
  }

  setParticipants(participants: MuSig2ParticipantMetadata[]): this {
    assertParticipantCount(participants.length);

    const normalized = participants.map(normalizeParticipant).sort(compareParticipantKeys);
    if (new Set(normalized.map(participant => participant.publicKeyHex)).size !== normalized.length) {
      throw new Error('MuSig2 signer public keys must be distinct');
    }

    const participantKeys = normalized.map(participant => hexToUint8Array(participant.publicKeyHex));
    this._participants = normalized;
    this.setAggregatePublicKey(getPlainPublicKey(keyAgg(participantKeys)));
    return this;
  }

  setParticipantPublicKeys(publicKeys: Array<Uint8Array | string>): this {
    this.setDerivationMode('legacy-bip328');
    return this.setParticipants(
      publicKeys.map(publicKey => ({
        publicKeyHex: typeof publicKey === 'string' ? publicKey : uint8ArrayToHex(publicKey),
      })),
    );
  }

  setParticipantKeyExpressions(expressions: string[]): this {
    assertParticipantCount(expressions.length);
    const participants = expressions.map(parseMuSig2ParticipantKeyExpression);
    const xpubCount = participants.filter(participant => Boolean(participant.xpub)).length;
    if (xpubCount !== 0 && xpubCount !== participants.length) {
      throw new Error('Use hardware xpub key expressions for every signer or bare public keys for every signer; mixed MuSig2 signer modes are not supported');
    }

    if (xpubCount === 0 || isLegacyBlueWalletParticipantSet(participants)) {
      this.setDerivationMode('legacy-bip328');
    } else {
      this.setDerivationMode('bip390-derived-participants');
    }

    return this.setParticipants(participants);
  }

  getParticipants(): MuSig2ParticipantMetadata[] {
    return this._participants.map(participant => ({ ...participant }));
  }

  getSignerCount(): number {
    return this._participants.length;
  }

  hasParticipantPublicKeys(): boolean {
    return (
      this._participants.length >= MIN_MUSIG2_SIGNERS &&
      this._participants.length <= MAX_MUSIG2_SIGNERS &&
      Boolean(this._aggregatePublicKeyHex)
    );
  }

  hasCompleteParticipantMetadata(): boolean {
    return (
      this.hasParticipantPublicKeys() &&
      this._participants.every(participant => Boolean(participant.masterFingerprint && participant.derivationPath))
    );
  }

  hasCompleteExtendedParticipantMetadata(): boolean {
    return this.hasCompleteParticipantMetadata() && this._participants.every(participant => Boolean(participant.xpub));
  }

  getBIP390Descriptor(includeChecksum = true): string {
    if (!this.hasCompleteExtendedParticipantMetadata()) {
      throw new Error('BIP390 descriptor requires a [fingerprint/path]xpub key expression for every signer');
    }

    const descriptor = this.usesDerivedParticipantKeys()
      ? `tr(musig(${this._participants.map(participant => `${descriptorOrigin(participant)}/<0;1>/*`).join(',')}))`
      : `tr(musig(${this._participants.map(descriptorOrigin).join(',')})/<0;1>/*)`;
    return includeChecksum ? descriptorWithChecksum(descriptor) : descriptor;
  }

  getNunchukDescriptor(
    path: 'any' | 'external' | 'internal' | 'multipath' = 'any',
    includeChecksum = true,
  ): string {
    if (!this.hasCompleteExtendedParticipantMetadata()) {
      throw new Error('Nunchuk descriptor requires a [fingerprint/path]xpub key expression for every signer');
    }
    if (!this.usesDerivedParticipantKeys()) {
      throw new Error('Nunchuk export is only available for BIP390 derived-participant MuSig2 vaults');
    }

    const suffix =
      path === 'external' ? '/0/*' : path === 'internal' ? '/1/*' : path === 'multipath' ? '/<0;1>/*' : '/*';
    const descriptor = `tr(musig(${this._participants.map(participant => `${descriptorOrigin(participant)}${suffix}`).join(',')}))`;
    return includeChecksum ? descriptorWithChecksum(descriptor) : descriptor;
  }

  getCoordinatorExport(): string {
    if (!this.hasParticipantPublicKeys()) throw new Error('MuSig2 coordinator participant public keys are not configured');

    const payload: MuSig2CoordinatorExport = {
      format: 'bluewallet-musig2',
      version: 1,
      network: 'bitcoin',
      label: this.getLabel(),
      root: 'm',
      rootFingerprint: this.getMuSig2RootFingerprint(),
      aggregatePublicKey: uint8ArrayToHex(this.getAggregatePublicKey()),
      derivationMode: this.getDerivationMode(),
      ...(this.usesDerivedParticipantKeys() ? {} : { xpub: this.getXpub() }),
      ...(this.hasCompleteExtendedParticipantMetadata() ? { descriptor: this.getBIP390Descriptor() } : {}),
      participants: this.getParticipants(),
    };

    return JSON.stringify(payload);
  }

  getID(): string {
    if (!this._aggregatePublicKeyHex) return super.getID();
    if (!this.usesDerivedParticipantKeys()) {
      return uint8ArrayToHex(sha256(`${this.type}:${this._aggregatePublicKeyHex}`));
    }

    const participantIdentity = this._participants
      .map(participant => `${participant.masterFingerprint ?? ''}:${participant.derivationPath ?? ''}:${participant.xpub ?? participant.publicKeyHex}`)
      .join('|');
    return uint8ArrayToHex(sha256(`${this.type}:${this._derivationMode}:${participantIdentity}`));
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

  private getDerivedParticipants(node: 0 | 1, index: number): DerivedParticipant[] {
    if (!this.hasCompleteExtendedParticipantMetadata()) {
      throw new Error('BIP390 address derivation requires complete participant xpub metadata');
    }
    if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) {
      throw new Error('MuSig2 address index must be between 0 and 2^31-1');
    }

    return this._participants
      .map(participant => ({
        participant,
        publicKey: new Uint8Array(bip32.fromBase58(participant.xpub!).derive(node).derive(index).publicKey),
      }))
      .sort((a, b) => compareBytes(a.publicKey, b.publicKey));
  }

  getAddressParticipantPublicKeys(node: 0 | 1, index: number): Uint8Array[] {
    if (!this.usesDerivedParticipantKeys()) {
      return this._participants.map(participant => hexToUint8Array(participant.publicKeyHex));
    }
    return this.getDerivedParticipants(node, index).map(item => new Uint8Array(item.publicKey));
  }

  getAddressAggregatePublicKey(node: 0 | 1, index: number): Uint8Array {
    if (!this.usesDerivedParticipantKeys()) {
      return new Uint8Array(this._getNodeByIndex(node, index).publicKey);
    }
    return getPlainPublicKey(keyAgg(this.getAddressParticipantPublicKeys(node, index)));
  }

  _getNodePubkeyByIndex(node: number, index: number): Uint8Array {
    if (node !== 0 && node !== 1) throw new Error('MuSig2 derivation branch must be 0 or 1');
    return this.getAddressAggregatePublicKey(node, index).slice(1);
  }

  _getNodeAddressByIndex(node: 0 | 1, index: number): string {
    if (!this.usesDerivedParticipantKeys()) return super._getNodeAddressByIndex(node, index);

    const cache = node === 0 ? this.external_addresses_cache : this.internal_addresses_cache;
    if (cache[index]) return cache[index];

    const { address } = bitcoin.payments.p2tr({ internalPubkey: this._getNodePubkeyByIndex(node, index) });
    if (!address) throw new Error('Could not create MuSig2 Taproot address');
    return (cache[index] = address);
  }

  private getParticipantSet(node: 0 | 1, index: number): AddressParticipantSet {
    if (!this.usesDerivedParticipantKeys()) {
      return {
        aggregatePublicKey: this.getAggregatePublicKey(),
        participantPublicKeys: this._participants.map(participant => hexToUint8Array(participant.publicKeyHex)),
      };
    }

    const participantPublicKeys = this.getAddressParticipantPublicKeys(node, index);
    return {
      aggregatePublicKey: getPlainPublicKey(keyAgg(participantPublicKeys)),
      participantPublicKeys,
    };
  }

  private getParticipantTapBip32Derivations(node: 0 | 1, index: number) {
    if (!this.hasCompleteExtendedParticipantMetadata()) {
      throw new Error('MuSig2 hardware signing requires a [fingerprint/path]xpub key expression for every signer');
    }

    if (!this.usesDerivedParticipantKeys()) {
      return this._participants.map(participant => ({
        pubkey: hexToUint8Array(participant.publicKeyHex).slice(1),
        masterFingerprint: hexToUint8Array(participant.masterFingerprint!),
        path: participant.derivationPath!,
        leafHashes: [] as Uint8Array[],
      }));
    }

    return this.getDerivedParticipants(node, index).map(({ participant, publicKey }) => ({
      pubkey: publicKey.slice(1),
      masterFingerprint: hexToUint8Array(participant.masterFingerprint!),
      path: `${participant.derivationPath}/${node}/${index}`,
      leafHashes: [] as Uint8Array[],
    }));
  }

  private addParticipantGlobalXpubs(psbt: Psbt): void {
    if (!this.hasCompleteExtendedParticipantMetadata()) {
      throw new Error('MuSig2 hardware signing requires complete signer xpub origin metadata');
    }

    const globalXpub = this._participants.map(participant => ({
      extendedPubkey: serializeExtendedPublicKey(bip32.fromBase58(participant.xpub!)),
      masterFingerprint: hexToUint8Array(participant.masterFingerprint!),
      path: participant.derivationPath!,
    }));
    psbt.updateGlobal({ globalXpub });
  }

  private getAddressLocation(path: string): { node: 0 | 1; index: number } {
    const match = path.match(/^m\/([01])\/(0|[1-9][0-9]*)$/);
    if (!match) throw new Error(`Invalid MuSig2 wallet-relative derivation path: ${path}`);
    return { node: Number(match[1]) as 0 | 1, index: Number(match[2]) };
  }

  _addPsbtInput(psbt: Psbt, input: CoinSelectReturnInput, sequence: number, _masterFingerprintBuffer: Uint8Array): Psbt {
    if (!this.hasCompleteExtendedParticipantMetadata()) {
      throw new Error('MuSig2 Round 1 requires a [fingerprint/path]xpub key expression for every signer');
    }
    if (!input.address) throw new Error('Internal error: no address on MuSig2 UTXO');

    const internalKey = this._getPubkeyByAddress(input.address);
    const path = this._getDerivationPathByAddress(input.address);
    if (!internalKey || !path) throw new Error('Could not locate MuSig2 UTXO derivation path');
    const { node, index } = this.getAddressLocation(path);
    const participantSet = this.getParticipantSet(node, index);

    const p2tr = bitcoin.payments.p2tr({ internalPubkey: internalKey });
    if (!p2tr.output) throw new Error('Could not build MuSig2 Taproot witness output');

    const tapBip32Derivation = this.getParticipantTapBip32Derivations(node, index);
    if (!this.usesDerivedParticipantKeys()) {
      tapBip32Derivation.push({
        pubkey: new Uint8Array(internalKey),
        masterFingerprint: hexToUint8Array(this.getMuSig2RootFingerprint()),
        path,
        leafHashes: [] as Uint8Array[],
      });
    }

    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      sequence,
      witnessUtxo: {
        script: p2tr.output,
        value: BigInt(input.value),
      },
      tapBip32Derivation,
      tapInternalKey: new Uint8Array(internalKey),
    });

    addMuSig2ParticipantsToInput(
      psbt,
      psbt.inputCount - 1,
      participantSet.aggregatePublicKey,
      participantSet.participantPublicKeys,
    );
    return psbt;
  }

  createTransaction(
    utxos: CreateTransactionUtxo[],
    targets: CreateTransactionTarget[],
    feeRate: number,
    changeAddress: string,
    sequence: number = AbstractHDElectrumWallet.defaultRBFSequence,
    _skipSigning = true,
    _masterFingerprint = 0,
  ): CreateTransactionResult {
    if (!this.hasCompleteExtendedParticipantMetadata()) {
      throw new Error('MuSig2 spending requires a [fingerprint/path]xpub key expression for every signer');
    }

    // The phone is coordinator-only. Always force unsigned PSBT construction.
    const result = super.createTransaction(utxos, targets, feeRate, changeAddress, sequence, true, 0);
    this.addParticipantGlobalXpubs(result.psbt);

    result.outputs.forEach((output, outputIndex) => {
      if (!output.address) return;
      const path = this._getDerivationPathByAddress(String(output.address));
      const internalKey = this._getPubkeyByAddress(String(output.address));
      if (!path || !internalKey) return;
      const { node, index } = this.getAddressLocation(path);
      const participantSet = this.getParticipantSet(node, index);

      const tapBip32Derivation = this.getParticipantTapBip32Derivations(node, index);
      if (!this.usesDerivedParticipantKeys()) {
        tapBip32Derivation.push({
          pubkey: new Uint8Array(internalKey),
          masterFingerprint: hexToUint8Array(this.getMuSig2RootFingerprint()),
          path,
          leafHashes: [] as Uint8Array[],
        });
      }

      result.psbt.data.outputs[outputIndex].tapInternalKey = new Uint8Array(internalKey);
      result.psbt.data.outputs[outputIndex].tapBip32Derivation = tapBip32Derivation;
      addMuSig2ParticipantsToOutput(
        result.psbt,
        outputIndex,
        participantSet.aggregatePublicKey,
        participantSet.participantPublicKeys,
      );
    });

    return result;
  }

  _getExternalWIFByIndex(): false {
    return false;
  }

  _getInternalWIFByIndex(): false {
    return false;
  }

  allowSend(): boolean {
    return this.hasCompleteExtendedParticipantMetadata();
  }

  // MuSig2 signing uses its own two-round BIP373 flow, not BlueWallet's
  // classic one-pass PSBT cosigning action.
  allowCosignPsbt(): boolean {
    return false;
  }

  allowMasterFingerprint(): boolean {
    return true;
  }

  allowXpub(): boolean {
    // A BIP328 synthetic aggregate xpub is not an address xpub for a BIP390
    // derived-participant wallet, so do not expose it as if it were one.
    return !this.usesDerivedParticipantKeys();
  }

  allowSignVerifyMessage(): boolean {
    return false;
  }
}
