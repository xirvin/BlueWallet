import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2';

export const CURVE_N = secp.Point.CURVE().n;

export type KeyAggContext = {
  point: secp.Point;
  gacc: bigint;
  tacc: bigint;
};

export type MuSig2Tweak = {
  tweak: Uint8Array;
  isXOnly: boolean;
};

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((sum, item) => sum + item.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const item of arrays) {
    result.set(item, offset);
    offset += item.length;
  }
  return result;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(Array.from(value, char => char.charCodeAt(0)));
}

export function taggedHash(tag: string, message: Uint8Array): Uint8Array {
  const tagHash = sha256(asciiBytes(tag));
  return sha256(concatBytes(tagHash, tagHash, message));
}

export function scalarFromBytes(bytes: Uint8Array): bigint {
  return secp.etc.bytesToNumberBE(bytes);
}

export function scalarFromHash(bytes: Uint8Array): bigint {
  return secp.etc.mod(scalarFromBytes(bytes), CURVE_N);
}

export function numberTo32Bytes(value: bigint): Uint8Array {
  return secp.etc.numberToBytesBE(value);
}

export function parsePlainPublicKey(publicKey: Uint8Array): secp.Point {
  if (publicKey.length !== 33 || (publicKey[0] !== 0x02 && publicKey[0] !== 0x03)) {
    throw new Error('MuSig2 public key must be a 33-byte compressed secp256k1 point');
  }

  const point = secp.Point.fromBytes(publicKey);
  if (point.is0()) throw new Error('MuSig2 public key cannot be the point at infinity');
  return point;
}

export function serializePlainPublicKey(point: secp.Point): Uint8Array {
  if (point.is0()) throw new Error('Cannot serialize the point at infinity as a plain public key');
  return point.toBytes(true);
}

export function getXOnlyPublicKey(context: KeyAggContext): Uint8Array {
  return serializePlainPublicKey(context.point).slice(1);
}

export function getPlainPublicKey(context: KeyAggContext): Uint8Array {
  return serializePlainPublicKey(context.point);
}

export function hasEvenY(point: secp.Point): boolean {
  return serializePlainPublicKey(point)[0] === 0x02;
}

export function keySort(publicKeys: Uint8Array[]): Uint8Array[] {
  return publicKeys.map(key => new Uint8Array(key)).sort((a, b) => {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  });
}

function getSecondKey(publicKeys: Uint8Array[]): Uint8Array {
  for (let i = 1; i < publicKeys.length; i++) {
    if (!bytesEqual(publicKeys[i], publicKeys[0])) return publicKeys[i];
  }
  return new Uint8Array(33);
}

function hashKeys(publicKeys: Uint8Array[]): Uint8Array {
  return taggedHash('KeyAgg list', concatBytes(...publicKeys));
}

function keyAggCoefficientInternal(publicKeys: Uint8Array[], publicKey: Uint8Array, secondKey: Uint8Array): bigint {
  if (bytesEqual(publicKey, secondKey)) return 1n;
  return scalarFromHash(taggedHash('KeyAgg coefficient', concatBytes(hashKeys(publicKeys), publicKey)));
}

export function keyAggCoefficient(publicKeys: Uint8Array[], publicKey: Uint8Array): bigint {
  if (publicKeys.length === 0) throw new Error('MuSig2 requires at least one public key');
  return keyAggCoefficientInternal(publicKeys, publicKey, getSecondKey(publicKeys));
}

export function keyAgg(publicKeys: Uint8Array[]): KeyAggContext {
  if (publicKeys.length === 0 || publicKeys.length >= 0x100000000) {
    throw new Error('MuSig2 requires between 1 and 2^32-1 public keys');
  }

  const keys = publicKeys.map(key => new Uint8Array(key));
  const points = keys.map(parsePlainPublicKey);
  const secondKey = getSecondKey(keys);
  let aggregate: secp.Point | undefined;

  for (let i = 0; i < points.length; i++) {
    const coefficient = keyAggCoefficientInternal(keys, keys[i], secondKey);
    if (coefficient === 0n) continue;
    const term = points[i].multiply(coefficient);
    aggregate = aggregate ? aggregate.add(term) : term;
  }

  if (!aggregate || aggregate.is0()) throw new Error('MuSig2 aggregate public key cannot be the point at infinity');
  return { point: aggregate, gacc: 1n, tacc: 0n };
}

export function applyTweak(context: KeyAggContext, tweak: Uint8Array, isXOnly: boolean): KeyAggContext {
  if (tweak.length !== 32) throw new Error('MuSig2 tweak must be 32 bytes');

  const tweakScalar = scalarFromBytes(tweak);
  if (tweakScalar >= CURVE_N) throw new Error('MuSig2 tweak must be less than the curve order');

  const g = isXOnly && !hasEvenY(context.point) ? CURVE_N - 1n : 1n;
  let point = g === 1n ? context.point : context.point.negate();
  if (tweakScalar !== 0n) point = point.add(secp.Point.BASE.multiply(tweakScalar));
  if (point.is0()) throw new Error('MuSig2 tweak resulted in the point at infinity');

  return {
    point,
    gacc: secp.etc.mod(g * context.gacc, CURVE_N),
    tacc: secp.etc.mod(tweakScalar + g * context.tacc, CURVE_N),
  };
}

export function keyAggAndTweak(publicKeys: Uint8Array[], tweaks: MuSig2Tweak[] = []): KeyAggContext {
  return tweaks.reduce((context, item) => applyTweak(context, item.tweak, item.isXOnly), keyAgg(publicKeys));
}
