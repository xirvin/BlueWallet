import assert from 'assert';

import { getLocalMuSig2SignerMatches } from '../../blue_modules/musig2/local-signer';
import {
  createMuSig2WatchOnlySignerWallet,
  restoreMuSig2LocalSignerWalletFromWatchOnly,
  watchOnlyWalletMatchesMuSig2Participant,
} from '../../blue_modules/musig2/signer-management';
import {
  createMuSig2TaprootSignerWallet,
  normalizeMuSig2VaultSigner,
  taprootWalletToMuSig2KeyExpression,
} from '../../blue_modules/musig2/vault';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';

const MNEMONIC_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PASSPHRASE_A = 'mu2sig-test-passphrase';

describe('MuSig2 signer management', () => {
  it('forgets a local seed without changing the vault public signer identity', () => {
    const signerA = createMuSig2TaprootSignerWallet(MNEMONIC_A, PASSPHRASE_A);
    signerA.setLabel('Vault signer A');
    const signerB = createMuSig2TaprootSignerWallet(MNEMONIC_B);

    const signerAExpression = taprootWalletToMuSig2KeyExpression(signerA);
    const participantA = normalizeMuSig2VaultSigner(signerAExpression).participant;
    const vault = new HDTaprootMuSig2Wallet();
    vault.setParticipantKeyExpressions([signerAExpression, taprootWalletToMuSig2KeyExpression(signerB)]);

    const receiveAddress = signerA._getExternalAddressByIndex(0);
    signerA.balance = 12345;
    signerA.next_free_address_index = 3;

    const watchOnly = createMuSig2WatchOnlySignerWallet(signerA, participantA);

    assert.strictEqual(watchOnly.type, WatchOnlyWallet.type);
    assert.strictEqual(watchOnly.getLabel(), 'Vault signer A');
    assert.strictEqual(watchOnly.getSecret(), participantA.xpub);
    assert.strictEqual(watchOnly.segwitType, 'p2tr');
    assert.strictEqual(watchOnly._derivationPath, participantA.derivationPath);
    assert.strictEqual(watchOnly.getMasterFingerprintHex().toLowerCase(), participantA.masterFingerprint);
    assert.strictEqual(watchOnly._getExternalAddressByIndex(0), receiveAddress);
    assert.strictEqual(watchOnly.getBalance(), 12345);
    assert.strictEqual(watchOnly.getNextFreeAddressIndex(), 3);
    assert.strictEqual(watchOnlyWalletMatchesMuSig2Participant(watchOnly, participantA), true);

    const serialized = JSON.stringify(watchOnly);
    assert.strictEqual(serialized.includes(MNEMONIC_A), false);
    assert.strictEqual(serialized.includes(PASSPHRASE_A), false);

    // The MuSig2 coordinator still has the exact same public participant data,
    // but BlueWallet no longer has a private HD Taproot wallet for signer A.
    assert.ok(vault.getParticipants().some(participant => participant.publicKeyHex === participantA.publicKeyHex));
    assert.strictEqual(getLocalMuSig2SignerMatches(vault, [signerB]).length, 1);
  });

  it('restores the exact signer seed and preserves xpub-only public wallet state', () => {
    const original = createMuSig2TaprootSignerWallet(MNEMONIC_A, PASSPHRASE_A);
    original.setLabel('Vault signer A');
    original.balance = 98765;
    original.next_free_address_index = 4;
    const participant = normalizeMuSig2VaultSigner(taprootWalletToMuSig2KeyExpression(original)).participant;
    const watchOnly = createMuSig2WatchOnlySignerWallet(original, participant);

    const restoredSeedWallet = createMuSig2TaprootSignerWallet(MNEMONIC_A, PASSPHRASE_A);
    const restored = restoreMuSig2LocalSignerWalletFromWatchOnly(restoredSeedWallet, watchOnly);

    assert.strictEqual(restored.getLabel(), 'Vault signer A');
    assert.strictEqual(restored.getBalance(), 98765);
    assert.strictEqual(restored.getNextFreeAddressIndex(), 4);
    assert.strictEqual(taprootWalletToMuSig2KeyExpression(restored), taprootWalletToMuSig2KeyExpression(original));

    const vault = new HDTaprootMuSig2Wallet();
    const signerB = createMuSig2TaprootSignerWallet(MNEMONIC_B);
    vault.setParticipantKeyExpressions([
      taprootWalletToMuSig2KeyExpression(restored),
      taprootWalletToMuSig2KeyExpression(signerB),
    ]);
    assert.strictEqual(getLocalMuSig2SignerMatches(vault, [restored, signerB]).length, 2);
  });

  it('refuses to forget a seed that does not match the selected MuSig2 participant', () => {
    const signerA = createMuSig2TaprootSignerWallet(MNEMONIC_A);
    const signerB = createMuSig2TaprootSignerWallet(MNEMONIC_B);
    const participantB = normalizeMuSig2VaultSigner(taprootWalletToMuSig2KeyExpression(signerB)).participant;

    assert.throws(() => createMuSig2WatchOnlySignerWallet(signerA, participantB), /no longer matches/);
  });
});
