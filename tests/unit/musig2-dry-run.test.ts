import assert from 'assert';

import { createMuSig2DryRun, MUSIG2_DRY_RUN_FAKE_TXID, MUSIG2_DRY_RUN_INPUT_VALUE } from '../../blue_modules/musig2/dry-run';
import { getMuSig2NonceProgress, PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS } from '../../blue_modules/musig2/psbt';
import { HDTaprootMuSig2Wallet } from '../../class/wallets/hd-taproot-musig2-wallet';

const XPUB_1 =
  'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL';
const XPUB_2 =
  'xpub68NZiKmJWnxxS6aaHmn81bvJeTESw724CRDs6HbuccFQN9Ku14VQrADWgqbhhTHBaohPX4CjNLf9fq9MYo6oDaPPLPxSb7gwQN3ih19Zm4Y';

function createHardwareWallet(): HDTaprootMuSig2Wallet {
  const wallet = new HDTaprootMuSig2Wallet();
  wallet.setParticipantKeyExpressions([
    `[deadbeef/0h/0h/0h/2147483646h]${XPUB_1}`,
    `[cafebabe/0h]${XPUB_2}`,
  ]);
  return wallet;
}

describe('MuSig2 synthetic signing dry run', () => {
  it('creates an unsigned BIP373 PSBT without requiring wallet balance', () => {
    const wallet = createHardwareWallet();
    const dryRun = createMuSig2DryRun(wallet);

    assert.strictEqual(dryRun.psbt.inputCount, 1);
    assert.ok(dryRun.fundingAddress.startsWith('bc1p'));
    assert.ok(dryRun.targetAddress.startsWith('bc1p'));
    assert.ok(dryRun.changeAddress.startsWith('bc1p'));

    const input = dryRun.psbt.data.inputs[0];
    assert.strictEqual(Number(input.witnessUtxo?.value), MUSIG2_DRY_RUN_INPUT_VALUE);
    assert.ok(input.unknownKeyVals?.some(item => item.key[0] === PSBT_IN_MUSIG2_PARTICIPANT_PUBKEYS));

    const unsignedTx = dryRun.psbt.data.globalMap.unsignedTx.toBuffer();
    assert.ok(unsignedTx.length > 0);
    assert.strictEqual(MUSIG2_DRY_RUN_FAKE_TXID, '11'.repeat(32));

    const progress = getMuSig2NonceProgress(dryRun.psbt);
    assert.deepStrictEqual(progress, { collected: 0, expected: 2, complete: false });
  });

  it('refuses a bare-public-key wallet because hardware origin metadata is missing', () => {
    const wallet = new HDTaprootMuSig2Wallet();
    wallet.setParticipantPublicKeys([
      '02F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9',
      '03DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
    ]);

    assert.throws(() => createMuSig2DryRun(wallet), /requires two signer/);
  });
});
