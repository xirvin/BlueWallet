import * as secp from '@noble/secp256k1';
import {
  CURVE_N,
  MuSig2Tweak,
  bytesEqual,
  concatBytes,
  getXOnlyPublicKey,
  hasEvenY,
  keyAggAndTweak,
  keyAggCoefficient,
  numberTo32Bytes,
  parsePlainPublicKey,
  scalarFromBytes,
  scalarFromHash,
  serializePlainPublicKey,
  taggedHash,
} from './key-aggregation';

export type MuSig2NonceGenerationOptions = {
  random32: Uint8Array;
  publicKey: Uint8Array;
  secretKey?: Uint8Array;
  aggregatePublicKey?: Uint8Array;
  message?: Uint8Array;
  extraInput?: Uint8Array;
};

export type MuSig2SessionContext = {
  aggregateNonce: Uint8Array;
  publicKeys: Uint8Array[];
  tweaks?: MuSig2Tweak[];
  message: Uint8Array;
};

export type MuSig2SessionValues = {
  aggregatePublicKey: secp.Point;
  gacc: bigint;
  tacc: bigint;
  nonceCoefficient: bigint;
  finalNonce: secp.Point;
  challenge: bigint;
};

export class MuSig2SecretNonce {
  private material?: Uint8Array;

  constructor(material: Uint8Array) {
    if (material.length !== 97) throw new Error('MuSig2 secret nonce must be 97 bytes');
    this.material = new Uint8Array(material);
  }

  consume(): Uint8Array {
    if (!this.material) throw new Error('MuSig2 secret nonce has already been consumed');
    const material = this.material;
    this.material = undefined;
    return material;
  }

  isConsumed(): boolean {
    return !this.material;
  }
}

function oneByte(value: number): Uint8Array {
  if (value < 0 || value > 0xff) throw new Error('Value does not fit in one byte');
  return Uint8Array.of(value);
}

function uint32be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Value does not fit in uint32');
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function uint64be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Value does not fit in a safe uint64');
  let n = BigInt(value);
  const result = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    result[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return result;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error('Cannot XOR arrays of different lengths');
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) result[i] = a[i] ^ b[i];
  return result;
}

function isZero(bytes: Uint8Array): boolean {
  let acc = 0;
  for (const byte of bytes) acc |= byte;
  return acc === 0;
}

function addPoints(a?: secp.Point, b?: secp.Point): secp.Point | undefined {
  if (!a) return b;
  if (!b) return a;
  const result = a.add(b);
  return result.is0() ? undefined : result;
}

function multiplyPoint(point: secp.Point | undefined, scalar: bigint): secp.Point | undefined {
  if (!point || scalar === 0n) return undefined;
  const result = point.multiply(scalar);
  return result.is0() ? undefined : result;
}

function pointsEqual(a?: secp.Point, b?: secp.Point): boolean {
  if (!a || !b) return !a && !b;
  return a.equals(b);
}

function serializeExtendedPoint(point?: secp.Point): Uint8Array {
  return point ? serializePlainPublicKey(point) : new Uint8Array(33);
}

function parseExtendedPoint(bytes: Uint8Array): secp.Point | undefined {
  if (bytes.length !== 33) throw new Error('MuSig2 aggregate nonce point must be 33 bytes');
  if (isZero(bytes)) return undefined;
  return parsePlainPublicKey(bytes);
}

function nonceHash(
  random: Uint8Array,
  publicKey: Uint8Array,
  aggregatePublicKey: Uint8Array,
  index: 0 | 1,
  messagePrefixed: Uint8Array,
  extraInput: Uint8Array,
): bigint {
  const payload = concatBytes(
    random,
    oneByte(publicKey.length),
    publicKey,
    oneByte(aggregatePublicKey.length),
    aggregatePublicKey,
    messagePrefixed,
    uint32be(extraInput.length),
    extraInput,
    oneByte(index),
  );
  return scalarFromHash(taggedHash('MuSig/nonce', payload));
}

export function nonceGen(options: MuSig2NonceGenerationOptions): { secretNonce: MuSig2SecretNonce; publicNonce: Uint8Array } {
  if (options.random32.length !== 32) throw new Error('MuSig2 nonce generation requires exactly 32 random bytes');
  parsePlainPublicKey(options.publicKey);

  if (options.secretKey) {
    if (options.secretKey.length !== 32 || !secp.utils.isValidSecretKey(options.secretKey)) {
      throw new Error('Invalid MuSig2 secret key');
    }
    const expectedPublicKey = secp.getPublicKey(options.secretKey, true);
    if (!bytesEqual(expectedPublicKey, options.publicKey)) {
      throw new Error('MuSig2 public key does not match the supplied secret key');
    }
  }

  const aggregatePublicKey = options.aggregatePublicKey ?? new Uint8Array();
  if (aggregatePublicKey.length !== 0 && aggregatePublicKey.length !== 32) {
    throw new Error('MuSig2 aggregate public key must be x-only (32 bytes) when supplied');
  }

  const messagePrefixed = options.message
    ? concatBytes(oneByte(1), uint64be(options.message.length), options.message)
    : oneByte(0);
  const extraInput = options.extraInput ?? new Uint8Array();
  const random = options.secretKey ? xorBytes(options.secretKey, taggedHash('MuSig/aux', options.random32)) : options.random32;

  const k1 = nonceHash(random, options.publicKey, aggregatePublicKey, 0, messagePrefixed, extraInput);
  const k2 = nonceHash(random, options.publicKey, aggregatePublicKey, 1, messagePrefixed, extraInput);
  if (k1 === 0n || k2 === 0n) throw new Error('MuSig2 nonce generation produced zero scalar');

  const publicNonce = concatBytes(serializePlainPublicKey(secp.Point.BASE.multiply(k1)), serializePlainPublicKey(secp.Point.BASE.multiply(k2)));
  const material = concatBytes(numberTo32Bytes(k1), numberTo32Bytes(k2), options.publicKey);
  return { secretNonce: new MuSig2SecretNonce(material), publicNonce };
}

export function nonceAgg(publicNonces: Uint8Array[]): Uint8Array {
  if (publicNonces.length === 0 || publicNonces.length >= 0x100000000) {
    throw new Error('MuSig2 requires between 1 and 2^32-1 public nonces');
  }

  const aggregate: (secp.Point | undefined)[] = [undefined, undefined];
  for (let nonceIndex = 0; nonceIndex < publicNonces.length; nonceIndex++) {
    const publicNonce = publicNonces[nonceIndex];
    if (publicNonce.length !== 66) throw new Error(`Invalid MuSig2 public nonce from signer ${nonceIndex}`);
    for (let component = 0; component < 2; component++) {
      const point = parsePlainPublicKey(publicNonce.slice(component * 33, component * 33 + 33));
      aggregate[component] = addPoints(aggregate[component], point);
    }
  }

  return concatBytes(serializeExtendedPoint(aggregate[0]), serializeExtendedPoint(aggregate[1]));
}

export function createSession(
  publicNonces: Uint8Array[],
  publicKeys: Uint8Array[],
  message: Uint8Array,
  tweaks: MuSig2Tweak[] = [],
): MuSig2SessionContext {
  if (publicNonces.length !== publicKeys.length) throw new Error('MuSig2 nonce and public-key counts must match');
  return { aggregateNonce: nonceAgg(publicNonces), publicKeys, tweaks, message };
}

export function getSessionValues(session: MuSig2SessionContext): MuSig2SessionValues {
  if (session.aggregateNonce.length !== 66) throw new Error('MuSig2 aggregate nonce must be 66 bytes');

  const keyContext = keyAggAndTweak(session.publicKeys, session.tweaks ?? []);
  const aggregateXOnly = getXOnlyPublicKey(keyContext);
  const nonceCoefficient = scalarFromHash(
    taggedHash('MuSig/noncecoef', concatBytes(session.aggregateNonce, aggregateXOnly, session.message)),
  );

  const r1 = parseExtendedPoint(session.aggregateNonce.slice(0, 33));
  const r2 = parseExtendedPoint(session.aggregateNonce.slice(33, 66));
  const combinedNonce = addPoints(r1, multiplyPoint(r2, nonceCoefficient));
  const finalNonce = combinedNonce ?? secp.Point.BASE;
  const challenge = scalarFromHash(
    taggedHash('BIP0340/challenge', concatBytes(serializePlainPublicKey(finalNonce).slice(1), aggregateXOnly, session.message)),
  );

  return {
    aggregatePublicKey: keyContext.point,
    gacc: keyContext.gacc,
    tacc: keyContext.tacc,
    nonceCoefficient,
    finalNonce,
    challenge,
  };
}

export function partialSigVerify(
  partialSignature: Uint8Array,
  publicNonce: Uint8Array,
  publicKey: Uint8Array,
  session: MuSig2SessionContext,
): boolean {
  try {
    if (partialSignature.length !== 32 || publicNonce.length !== 66) return false;
    const values = getSessionValues(session);
    const s = scalarFromBytes(partialSignature);
    if (s >= CURVE_N) return false;

    const rs1 = parsePlainPublicKey(publicNonce.slice(0, 33));
    const rs2 = parsePlainPublicKey(publicNonce.slice(33, 66));
    let effectiveNonce = addPoints(rs1, multiplyPoint(rs2, values.nonceCoefficient));
    if (!effectiveNonce) return false;
    if (!hasEvenY(values.finalNonce)) effectiveNonce = effectiveNonce.negate();

    if (!session.publicKeys.some(key => bytesEqual(key, publicKey))) return false;
    const participantPoint = parsePlainPublicKey(publicKey);
    const coefficient = keyAggCoefficient(session.publicKeys, publicKey);
    const g = hasEvenY(values.aggregatePublicKey) ? 1n : CURVE_N - 1n;
    const gPrime = secp.etc.mod(g * values.gacc, CURVE_N);
    const participantScalar = secp.etc.mod(values.challenge * coefficient * gPrime, CURVE_N);

    const lhs = multiplyPoint(secp.Point.BASE, s);
    const rhs = addPoints(effectiveNonce, multiplyPoint(participantPoint, participantScalar));
    return pointsEqual(lhs, rhs);
  } catch (_) {
    return false;
  }
}

export function partialSign(secretNonce: MuSig2SecretNonce, secretKey: Uint8Array, session: MuSig2SessionContext): Uint8Array {
  const values = getSessionValues(session);
  const material = secretNonce.consume();

  try {
    const k1Raw = scalarFromBytes(material.slice(0, 32));
    const k2Raw = scalarFromBytes(material.slice(32, 64));
    if (k1Raw === 0n || k1Raw >= CURVE_N || k2Raw === 0n || k2Raw >= CURVE_N) {
      throw new Error('Invalid or already-used MuSig2 secret nonce');
    }
    if (secretKey.length !== 32 || !secp.utils.isValidSecretKey(secretKey)) throw new Error('Invalid MuSig2 secret key');

    const secretScalar = scalarFromBytes(secretKey);
    const participantPoint = secp.Point.BASE.multiply(secretScalar);
    const publicKey = serializePlainPublicKey(participantPoint);
    if (!bytesEqual(publicKey, material.slice(64, 97))) {
      throw new Error('MuSig2 secret nonce was generated for a different signing key');
    }

    if (!session.publicKeys.some(key => bytesEqual(key, publicKey))) {
      throw new Error('MuSig2 signing key is not a participant in this session');
    }

    const k1 = hasEvenY(values.finalNonce) ? k1Raw : CURVE_N - k1Raw;
    const k2 = hasEvenY(values.finalNonce) ? k2Raw : CURVE_N - k2Raw;
    const coefficient = keyAggCoefficient(session.publicKeys, publicKey);
    const g = hasEvenY(values.aggregatePublicKey) ? 1n : CURVE_N - 1n;
    const effectiveSecret = secp.etc.mod(g * values.gacc * secretScalar, CURVE_N);
    const s = secp.etc.mod(
      k1 + values.nonceCoefficient * k2 + values.challenge * coefficient * effectiveSecret,
      CURVE_N,
    );
    const partialSignature = numberTo32Bytes(s);
    const publicNonce = concatBytes(
      serializePlainPublicKey(secp.Point.BASE.multiply(k1Raw)),
      serializePlainPublicKey(secp.Point.BASE.multiply(k2Raw)),
    );

    if (!partialSigVerify(partialSignature, publicNonce, publicKey, session)) {
      throw new Error('MuSig2 partial signature self-verification failed');
    }
    return partialSignature;
  } finally {
    material.fill(0);
  }
}

export function partialSigAgg(partialSignatures: Uint8Array[], session: MuSig2SessionContext): Uint8Array {
  if (partialSignatures.length !== session.publicKeys.length) {
    throw new Error('MuSig2 requires one partial signature per participant');
  }

  const values = getSessionValues(session);
  let s = 0n;
  for (const partialSignature of partialSignatures) {
    if (partialSignature.length !== 32) throw new Error('MuSig2 partial signature must be 32 bytes');
    const scalar = scalarFromBytes(partialSignature);
    if (scalar >= CURVE_N) throw new Error('MuSig2 partial signature scalar is out of range');
    s = secp.etc.mod(s + scalar, CURVE_N);
  }

  const g = hasEvenY(values.aggregatePublicKey) ? 1n : CURVE_N - 1n;
  s = secp.etc.mod(s + values.challenge * g * values.tacc, CURVE_N);
  return concatBytes(serializePlainPublicKey(values.finalNonce).slice(1), numberTo32Bytes(s));
}

export function verifyFinalSignature(signature: Uint8Array, session: MuSig2SessionContext): boolean {
  if (signature.length !== 64) return false;
  const values = getSessionValues(session);
  return secp.schnorr.verify(signature, session.message, serializePlainPublicKey(values.aggregatePublicKey).slice(1));
}
