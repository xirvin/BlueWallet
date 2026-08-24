import type { MuSig2DerivationMode } from '../../class/wallets/hd-taproot-musig2-wallet';

export const MUSIG2_NUNCHUK_COMPATIBLE_MODE: MuSig2DerivationMode = 'bip390-derived-participants';
export const MUSIG2_COLDCARD_COMPATIBLE_MODE: MuSig2DerivationMode = 'legacy-bip328';
export const MUSIG2_DEFAULT_COMPATIBILITY_MODE: MuSig2DerivationMode = MUSIG2_NUNCHUK_COMPATIBLE_MODE;

export function getMuSig2CompatibilityLabel(mode: MuSig2DerivationMode): string {
  return mode === MUSIG2_COLDCARD_COMPATIBLE_MODE ? 'Aggregate-first (BIP328)' : 'Participant-first';
}

export function getMuSig2CompatibilitySubtitle(mode: MuSig2DerivationMode): string {
  return mode === MUSIG2_COLDCARD_COMPATIBLE_MODE
    ? 'Used by COLDCARD (Coinkite) and Ledger · supported by Bitcoin Core 31'
    : 'Used by Nunchuk · supported by Bitcoin Core 31';
}

export function getMuSig2CompatibilityDescription(mode: MuSig2DerivationMode): string {
  return mode === MUSIG2_COLDCARD_COMPATIBLE_MODE
    ? 'Aggregate-first follows BIP390/BIP328: signer account xpubs are sorted and aggregated first, then the synthetic aggregate key is derived at /change/index. This is the construction used by current COLDCARD EDGE MuSig2 firmware and Ledger Bitcoin app MuSig2 wallet policies. Bitcoin Core 31 supports this model.'
    : 'Participant-first follows BIP390: each BIP87 signer account xpub is derived at /change/index first, then the child keys are sorted and aggregated with MuSig2. This is the construction used by Nunchuk MuSig2 wallets. Bitcoin Core 31 supports this model.';
}
