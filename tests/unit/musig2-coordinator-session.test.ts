/* eslint-disable import/first */
import assert from 'assert';
import { Psbt } from 'bitcoinjs-lib';

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
  },
}));

import {
  clearMuSig2CoordinatorSession,
  getMuSig2CoordinatorSessionId,
  isMuSig2TerminalState,
  listMuSig2CoordinatorSessions,
  loadMuSig2CoordinatorSession,
  saveMuSig2CoordinatorSession,
  transitionMuSig2State,
} from '../../blue_modules/musig2/coordinator-session';

function makePsbt(outputValue = 1n): Psbt {
  const psbt = new Psbt();
  psbt.addInput({ hash: '11'.repeat(32), index: 0 });
  psbt.addOutput({ script: Uint8Array.of(0x6a), value: outputValue });
  return psbt;
}

describe('MuSig2 coordinator session persistence and states', () => {
  beforeEach(() => mockStore.clear());

  it('enforces the active signing state progression', () => {
    let state = transitionMuSig2State('CREATED', 'COLLECTING_NONCES');
    state = transitionMuSig2State(state, 'NONCES_COMPLETE');
    state = transitionMuSig2State(state, 'COLLECTING_PARTIAL_SIGNATURES');
    state = transitionMuSig2State(state, 'SIGNATURES_COMPLETE');
    state = transitionMuSig2State(state, 'FINALIZED');
    assert.strictEqual(state, 'FINALIZED');
    assert.strictEqual(isMuSig2TerminalState(state), true);
    assert.throws(() => transitionMuSig2State(state, 'COLLECTING_NONCES'), /Invalid MuSig2 coordinator state transition/);
  });

  it('requires an explicit fresh-session transition after cancellation, failure, or nonce invalidation', () => {
    for (const terminal of ['CANCELLED', 'FAILED', 'NONCE_INVALIDATED'] as const) {
      assert.strictEqual(isMuSig2TerminalState(terminal), true);
      assert.strictEqual(transitionMuSig2State(terminal, 'COLLECTING_NONCES'), 'COLLECTING_NONCES');
    }
  });

  it('persists, indexes, restores, and clears a resumable session', async () => {
    const psbt = makePsbt();
    const walletID = 'test-musig2-wallet';
    const saved = await saveMuSig2CoordinatorSession(walletID, psbt, 'COLLECTING_NONCES', psbt.toBase64());
    const loaded = await loadMuSig2CoordinatorSession(walletID, psbt);
    const indexed = await listMuSig2CoordinatorSessions(walletID);

    assert.ok(loaded);
    assert.strictEqual(loaded!.sessionId, saved.sessionId);
    assert.strictEqual(loaded!.state, 'COLLECTING_NONCES');
    assert.strictEqual(loaded!.round1PsbtBase64, psbt.toBase64());
    assert.strictEqual(loaded!.coordinatorPsbtBase64, psbt.toBase64());
    assert.strictEqual(loaded!.finalization, undefined);

    assert.strictEqual(indexed.length, 1);
    assert.strictEqual(indexed[0].sessionId, saved.sessionId);
    assert.strictEqual(indexed[0].round1PsbtBase64, psbt.toBase64());
    assert.strictEqual(indexed[0].state, 'COLLECTING_NONCES');

    await clearMuSig2CoordinatorSession(walletID, psbt);
    assert.strictEqual(await loadMuSig2CoordinatorSession(walletID, psbt), undefined);
    assert.deepStrictEqual(await listMuSig2CoordinatorSessions(walletID), []);
  });

  it('keeps terminal sessions out of the default resumable activity list', async () => {
    const psbt = makePsbt();
    const walletID = 'terminal-wallet';
    await saveMuSig2CoordinatorSession(walletID, psbt, 'CANCELLED', psbt.toBase64(), undefined, 'cancelled');

    assert.deepStrictEqual(await listMuSig2CoordinatorSessions(walletID), []);
    const all = await listMuSig2CoordinatorSessions(walletID, false);
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].state, 'CANCELLED');
  });

  it('upserts one activity row as a session progresses', async () => {
    const psbt = makePsbt();
    const walletID = 'progress-wallet';
    await saveMuSig2CoordinatorSession(walletID, psbt, 'COLLECTING_NONCES', psbt.toBase64());
    await saveMuSig2CoordinatorSession(walletID, psbt, 'NONCES_COMPLETE', psbt.toBase64());

    const sessions = await listMuSig2CoordinatorSessions(walletID);
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0].state, 'NONCES_COMPLETE');
  });

  it('rejects finalized persistence records that are not written atomically', async () => {
    const psbt = makePsbt();
    const walletID = 'test-musig2-wallet';
    const finalization = {
      psbtBase64: psbt.toBase64(),
      rawTransactionHex: '00',
      txid: '11'.repeat(32),
      verifiedPartialSignatures: 2,
      finalSignatureCount: 1,
    };

    await assert.rejects(
      saveMuSig2CoordinatorSession(walletID, psbt, 'FINALIZED', psbt.toBase64()),
      /requires finalization data/,
    );
    await assert.rejects(
      saveMuSig2CoordinatorSession(walletID, psbt, 'COLLECTING_NONCES', psbt.toBase64(), finalization),
      /only be stored in FINALIZED state/,
    );
  });

  it('binds the persistence key to both wallet identity and unsigned transaction', () => {
    const psbt = makePsbt(1n);
    const changed = makePsbt(2n);
    assert.notStrictEqual(getMuSig2CoordinatorSessionId('wallet-a', psbt), getMuSig2CoordinatorSessionId('wallet-b', psbt));
    assert.notStrictEqual(getMuSig2CoordinatorSessionId('wallet-a', psbt), getMuSig2CoordinatorSessionId('wallet-a', changed));
  });
});
