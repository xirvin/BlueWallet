import assert from 'assert';

import { createMuSig2DryRun } from '../../blue_modules/musig2/dry-run';
import {
  formatMuSig2Btc,
  formatMuSig2Sats,
  getMuSig2TransactionSummary,
} from '../../blue_modules/musig2/transaction-summary';
import { createMuSig2TaprootSignerWallet, taprootWalletToMuSig2KeyExpression } from '../../blue_modules/musig2/vault';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

const MNEMONIC_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('MuSig2 transaction summary', () => {
  it('shows the real recipient, excludes change, and derives the fee from the PSBT', () => {
    const signerA = createMuSig2TaprootSignerWallet(MNEMONIC_A);
    const signerB = createMuSig2TaprootSignerWallet(MNEMONIC_B);
    const vault = new HDTaprootMuSig2Wallet();
    vault.setParticipantKeyExpressions([
      taprootWalletToMuSig2KeyExpression(signerA),
      taprootWalletToMuSig2KeyExpression(signerB),
    ]);

    const dryRun = createMuSig2DryRun(vault);
    const summary = getMuSig2TransactionSummary(dryRun.psbt);

    assert.strictEqual(summary.recipients.length, 1);
    assert.strictEqual(summary.recipients[0].address, dryRun.targetAddress);
    assert.strictEqual(summary.recipients[0].valueSats, 25_000n);
    assert.strictEqual(summary.amountSats, 25_000n);
    assert.strictEqual(summary.inputSats, 100_000n);
    assert.ok(summary.feeSats > 0n);
    assert.strictEqual(summary.inputSats, summary.outputSats + summary.feeSats);
    assert.strictEqual(formatMuSig2Btc(500_000n), '0.005 BTC');
    assert.strictEqual(formatMuSig2Sats(1_240n), '1,240 sats');
  });
});
