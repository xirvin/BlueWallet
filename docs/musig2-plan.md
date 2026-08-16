# MuSig2 integration plan

This branch explores adding Taproot MuSig2 wallet support to BlueWallet.

## Existing architecture

- `class/wallets/hd-taproot-wallet.ts` already implements BIP86 key-path Taproot addresses and Taproot PSBT input fields.
- `class/wallets/multisig-hd-wallet.ts` implements classic script multisig Vaults and their cosigner model.
- `class/wallets/types.ts` centralizes wallet type registration.
- `screen/wallets/addMultisigStep2.tsx` is part of the existing Vault creation flow.

## Proposed architecture

Add a dedicated `HDTaprootMuSig2Wallet` rather than overloading classic `MultisigHDWallet`.

Core responsibilities:

1. Aggregate participant public keys according to BIP327.
2. Derive P2TR addresses from the aggregate key.
3. Create and parse PSBTv2/PSBT fields required for MuSig2 interoperability, following BIP373.
4. Track the two signing rounds:
   - public nonce generation/exchange
   - partial signature generation/exchange
5. Never persist reusable secret nonces. Secret nonces must be single-use and destroyed after signing or session abort.
6. Support watch-only cosigners using xpub/fingerprint/derivation metadata.
7. Keep coordinator state separate from signing-key material.

## Initial implementation order

1. Add wallet type and serialization model.
2. Implement key aggregation and deterministic address derivation with test vectors.
3. Add BIP373 PSBT parsing/serialization.
4. Add MuSig2 session state machine.
5. Add QR/file PSBT transport for hardware wallets.
6. Add Coldcard interoperability tests.
7. Add wallet creation/import UI.
8. Add regtest/signet end-to-end transaction tests before any mainnet use.

## Security requirements

- No secret nonce reuse under any circumstance.
- Bind nonce/session data to the exact transaction message and aggregate key.
- Validate participant keys and reject duplicate/invalid keys.
- Verify every partial signature before aggregation.
- Treat imported PSBT/MuSig2 metadata as untrusted input.
- Mainnet signing must remain disabled until test-vector and interoperability coverage is complete.
