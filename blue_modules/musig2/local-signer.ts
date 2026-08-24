import { randomBytes } from '@noble/hashes/utils';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';
import { Buffer } from 'buffer';

import { HDTaprootMuSig2Wallet, MuSig2ParticipantMetadata } from '../../class/wallets/hd-taproot-musig2-wallet';
import { HDTaprootWallet } from '../../class/wallets/hd-taproot-wallet';
import ecc from '../noble_ecc';
import { normalizeMuSig2VaultSigner, taprootWalletToMuSig2KeyExpression } from './vault';
import { bytesEqual, concatBytes } from './key-aggregation';
import {
  addMuSig2PartialSignatureToInput,
  addMuSig2PublicNonceToInput,
  getMuSig2ParticipantSetsForInput,
} from './psbt';
import { getMuSig2Round2SignerPsbt } from './round2';
import { createMuSig2KeyPathSigningContext } from './signing-context';
import { MuSig2SecretNonce, nonceGen, partialSign } from './session';

const bip32 = BIP32Factory(ecc);

export type LocalMuSig2SignerMatch = {
  participantIndex: number;
  participant: MuSig2ParticipantMetadata;
  wallet: HDTaprootWallet;
};

export type LocalMuSig2NonceState = {
  inputIndex: number;
  participantPublicKey: Uint8Array;
  publicNonce: Uint8Array;
  secretNonce: MuSig2SecretNonce;
};

export type LocalMuSig2Round1Result = {
  psbt: Psbt;
  nonces: LocalMuSig2NonceState[];
};

type LocalInputSignerKey = {
  participantPublicKey: Uint8Array;
  secretKey: Uint8Array;
};

function localWalletMatchesParticipant(wallet: HDTaprootWallet, participant: MuSig2ParticipantMetadata): boolean {
  if (!participant.xpub || !participant.masterFingerprint || !participant.derivationPath) return false;

  try {
    const normalized = normalizeMuSig2VaultSigner(taprootWalletToMuSig2KeyExpression(wallet)).participant;
    return (
      normalized.publicKeyHex === participant.publicKeyHex.toLowerCase() &&
      normalized.xpub === participant.xpub &&
      normalized.masterFingerprint === participant.masterFingerprint.toLowerCase() &&
      normalized.derivationPath === participant.derivationPath
    );
  } catch {
    return false;
  }
}

/**
 * Finds local BlueWallet account wallets that cryptographically match MuSig2
 * participants. Labels and creation history are deliberately ignored.
 */
export function getLocalMuSig2SignerMatches(
  wallet: HDTaprootMuSig2Wallet,
  localWallets: HDTaprootWallet[],
): LocalMuSig2SignerMatch[] {
  return wallet.getParticipants().flatMap((participant, participantIndex) => {
    const localWallet = localWallets.find(candidate => localWalletMatchesParticipant(candidate, participant));
    return localWallet ? [{ participantIndex, participant, wallet: localWallet }] : [];
  });
}

function isAllowedParticipantSigningPath(accountPath: string, signingPath: string): boolean {
  if (signingPath === accountPath) return true; // historical BIP328/account-key participant
  if (!signingPath.startsWith(`${accountPath}/`)) return false;
  const suffix = signingPath.slice(accountPath.length);
  return /^\/[01]\/(0|[1-9][0-9]*)$/.test(suffix);
}

/**
 * Resolves the exact BIP373 participant key for one input from its
 * PSBT_IN_TAP_BIP32_DERIVATION record. In a BIP390/Nunchuk wallet this is the
 * /change/index child of the BIP87 account xpub; in historical BIP328 vaults
 * it is the account key itself.
 */
function getLocalInputSignerKey(psbt: Psbt, inputIndex: number, match: LocalMuSig2SignerMatch): LocalInputSignerKey {
  const participantSets = getMuSig2ParticipantSetsForInput(psbt, inputIndex);
  if (participantSets.length !== 1) {
    throw new Error(`Local MuSig2 signing requires exactly one participant set on input ${inputIndex}`);
  }

  const input = psbt.data.inputs[inputIndex];
  if (!input) throw new Error(`MuSig2 PSBT input ${inputIndex} does not exist`);

  const accountPath = match.participant.derivationPath;
  const fingerprint = match.participant.masterFingerprint?.toLowerCase();
  if (!accountPath || !fingerprint) {
    throw new Error('Local MuSig2 signer is missing account origin metadata');
  }
  if (match.wallet.getDerivationPath() !== accountPath) {
    throw new Error('Local MuSig2 signer derivation path no longer matches the vault participant');
  }

  const root = bip32.fromSeed(match.wallet._getSeed());
  const matches: LocalInputSignerKey[] = [];

  for (const derivation of input.tapBip32Derivation ?? []) {
    if (Buffer.from(derivation.masterFingerprint).toString('hex').toLowerCase() !== fingerprint) continue;
    if (!isAllowedParticipantSigningPath(accountPath, derivation.path)) continue;

    const node = root.derivePath(derivation.path);
    if (!node.privateKey) continue;

    const participantPublicKey = participantSets[0].participantPublicKeys.find(key => bytesEqual(key, node.publicKey));
    if (!participantPublicKey) continue;
    if (!bytesEqual(participantPublicKey.slice(1), derivation.pubkey)) {
      throw new Error(`Local MuSig2 signer derivation metadata does not match participant key on input ${inputIndex}`);
    }

    matches.push({
      participantPublicKey: new Uint8Array(participantPublicKey),
      secretKey: new Uint8Array(node.privateKey),
    });
  }

  if (matches.length !== 1) {
    for (const candidate of matches) candidate.secretKey.fill(0);
    throw new Error(`Could not resolve exactly one local MuSig2 participant key on input ${inputIndex}`);
  }

  return matches[0];
}

function getSigningAggregatePublicKey(psbt: Psbt, inputIndex: number): Uint8Array {
  const participantSets = getMuSig2ParticipantSetsForInput(psbt, inputIndex);
  if (participantSets.length !== 1) {
    throw new Error(`Local MuSig2 signing requires exactly one participant set on input ${inputIndex}`);
  }

  const participantSet = participantSets[0];
  const input = psbt.data.inputs[inputIndex];
  if (!input) throw new Error(`MuSig2 PSBT input ${inputIndex} does not exist`);
  if (!input.tapInternalKey) return participantSet.aggregatePublicKey;
  if (input.tapInternalKey.length !== 32) throw new Error(`Invalid Taproot internal key on input ${inputIndex}`);

  const tweakData = input.tapMerkleRoot ? concatBytes(input.tapInternalKey, input.tapMerkleRoot) : input.tapInternalKey;
  const tweak = bitcoin.crypto.taggedHash('TapTweak', tweakData);
  const tweaked = ecc.xOnlyPointAddTweak(input.tapInternalKey, tweak);
  if (!tweaked) throw new Error(`Could not derive Taproot output key for MuSig2 input ${inputIndex}`);

  const compressed = new Uint8Array(33);
  compressed[0] = tweaked.parity === 1 ? 0x03 : 0x02;
  compressed.set(tweaked.xOnlyPubkey, 1);

  const witnessScript = input.witnessUtxo?.script;
  if (witnessScript) {
    const isP2tr = witnessScript.length === 34 && witnessScript[0] === 0x51 && witnessScript[1] === 0x20;
    if (!isP2tr || !bytesEqual(witnessScript.slice(2), tweaked.xOnlyPubkey)) {
      throw new Error(`Local MuSig2 signing key does not match witness UTXO on input ${inputIndex}`);
    }
  }

  return compressed;
}

/**
 * Creates fresh Round 1 nonces for one local participant. Secret nonces are
 * returned only in memory and must be consumed immediately by Round 2.
 */
export function createLocalMuSig2Round1Response(
  coordinatorPsbt: Psbt,
  match: LocalMuSig2SignerMatch,
  random32Factory: () => Uint8Array = () => randomBytes(32),
): LocalMuSig2Round1Result {
  const response = coordinatorPsbt.clone();
  const nonces: LocalMuSig2NonceState[] = [];

  for (let inputIndex = 0; inputIndex < coordinatorPsbt.inputCount; inputIndex++) {
    const { participantPublicKey, secretKey } = getLocalInputSignerKey(coordinatorPsbt, inputIndex, match);
    try {
      const signingAggregatePublicKey = getSigningAggregatePublicKey(coordinatorPsbt, inputIndex);
      const random32 = random32Factory();
      if (random32.length !== 32) throw new Error('Local MuSig2 signer entropy source must return exactly 32 bytes');

      const generated = nonceGen({
        random32,
        secretKey,
        publicKey: participantPublicKey,
        aggregatePublicKey: signingAggregatePublicKey.slice(1),
      });
      addMuSig2PublicNonceToInput(
        response,
        inputIndex,
        participantPublicKey,
        signingAggregatePublicKey,
        generated.publicNonce,
      );
      nonces.push({
        inputIndex,
        participantPublicKey,
        publicNonce: generated.publicNonce,
        secretNonce: generated.secretNonce,
      });
    } finally {
      secretKey.fill(0);
    }
  }

  return { psbt: response, nonces };
}

/**
 * Consumes the exact in-memory secret nonces created for Round 1 and produces
 * this local participant's BIP373 partial signatures. The public nonce is
 * checked byte-for-byte against the frozen Round 2 session before signing.
 */
export function createLocalMuSig2Round2Response(
  coordinatorPsbt: Psbt,
  match: LocalMuSig2SignerMatch,
  nonces: LocalMuSig2NonceState[],
): Psbt {
  if (nonces.length !== coordinatorPsbt.inputCount) {
    throw new Error('Local MuSig2 signer nonce state is incomplete; restart the signing session');
  }

  const response = getMuSig2Round2SignerPsbt(coordinatorPsbt);

  for (let inputIndex = 0; inputIndex < coordinatorPsbt.inputCount; inputIndex++) {
    const { participantPublicKey, secretKey } = getLocalInputSignerKey(coordinatorPsbt, inputIndex, match);
    try {
      const storedNonce = nonces.find(item => item.inputIndex === inputIndex);
      if (!storedNonce || !bytesEqual(storedNonce.participantPublicKey, participantPublicKey)) {
        throw new Error(`Local MuSig2 signer nonce state is missing input ${inputIndex}; restart the signing session`);
      }

      const context = createMuSig2KeyPathSigningContext(coordinatorPsbt, inputIndex);
      const participantIndex = context.participantPublicKeys.findIndex(key => bytesEqual(key, participantPublicKey));
      if (participantIndex < 0) {
        throw new Error(`Local MuSig2 signer is not an expected participant on input ${inputIndex}`);
      }
      if (!bytesEqual(context.publicNonces[participantIndex], storedNonce.publicNonce)) {
        throw new Error(`Local MuSig2 signer public nonce changed on input ${inputIndex}; restart the signing session`);
      }

      const partialSignature = partialSign(storedNonce.secretNonce, secretKey, context.session);
      addMuSig2PartialSignatureToInput(
        response,
        inputIndex,
        participantPublicKey,
        context.signingAggregatePublicKey,
        partialSignature,
      );
    } finally {
      secretKey.fill(0);
    }
  }

  return response;
}
