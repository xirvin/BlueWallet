import type { MuSig2DerivationMode } from '../../class/wallets/hd-taproot-musig2-wallet';

export const MUSIG2_NUNCHUK_COMPATIBLE_MODE: MuSig2DerivationMode = 'bip390-derived-participants';
export const MUSIG2_COLDCARD_COMPATIBLE_MODE: MuSig2DerivationMode = 'legacy-bip328';
export const MUSIG2_DEFAULT_COMPATIBILITY_MODE: MuSig2DerivationMode = MUSIG2_NUNCHUK_COMPATIBLE_MODE;

export function getMuSig2CompatibilityLabel(mode: MuSig2DerivationMode): string {
  return mode === MUSIG2_COLDCARD_COMPATIBLE_MODE ? 'COLDCARD Compatible' : 'Nunchuk Compatible';
}

export function getMuSig2CompatibilitySubtitle(mode: MuSig2DerivationMode): string {
  return mode === MUSIG2_COLDCARD_COMPATIBLE_MODE
    ? 'Aggregate first, then BIP328 /change/index derivation'
    : 'Derive participant children first, then MuSig2 aggregation';
}

export function getMuSig2CompatibilityDescription(mode: MuSig2DerivationMode): string {
  return mode === MUSIG2_COLDCARD_COMPATIBLE_MODE
    ? 'COLDCARD mode keeps the historical BlueWallet aggregate-first model: signer account xpubs are sorted and aggregated first, then the synthetic aggregate key is derived at /change/index using BIP328. This produces different addresses from Nunchuk Compatible vaults.'
    : 'Nunchuk mode keeps the current BIP390 participant-first model: each BIP87 signer account xpub is derived at /change/index first, then the child keys are sorted and aggregated with MuSig2. This matches Nunchuk Value Keyset address derivation.';
}
