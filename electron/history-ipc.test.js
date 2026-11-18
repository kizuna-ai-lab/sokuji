// electron/history-ipc.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { setupHistoryHandlers, HISTORY_CHANNELS, openHistoryAtLaunch } = nodeRequire('./history-ipc.js');
const { openHistory } = nodeRequire('./history-store.js');

const MAIN = { id: 'main' };
const POPOVER = { id: 'popover' };

let dir;
let store;
let handlers;
const register = (over = {}) => {
  handlers = new Map();
  setupHistoryHandlers({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    getStore: () => store,
    isTrustedSender: (sender) => sender === MAIN,
    dir,
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
    getDownloadsDir: () => dir,
    ...over,
  });
};
const call = (channel, payload) => handlers.get(channel)({ sender: MAIN }, payload);
const rec = (over = {}) => ({
  id: 'run-0001-aaaa', startedAt: 1000, mode: 'both', myLanguage: 'zh', targetLanguage: 'en',
  services: { provider: 'soniox', models: {} }, appVersion: '0.51.0', ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sokuji-history-ipc-'));
  store = openHistory({ dir });
  register();
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the history channels', () => {
  it('registers exactly the channels in the map', () => {
    expect([...handlers.keys()].sort()).toEqual([...Object.keys(HISTORY_CHANNELS), 'history:status', 'history:save-track', 'history:recognize', 'history:recognize-cancel', 'history:recognize-status'].sort());
    expect(Object.keys(HISTORY_CHANNELS)).toHaveLength(28);
    expect(HISTORY_CHANNELS['history:update-notes-names']).toBe('updateNotesNames');
    expect(HISTORY_CHANNELS['history:append-track']).toBe('appendTrack');
  });

  it('writes every channel out as a literal handle call, the way the registry guard reads them', () => {
    const src = readFileSync(join(__dirname, 'history-ipc.js'), 'utf8');
    const literal = [...src.matchAll(/ipcMain\.handle\(\s*'(history:[^']+)'/g)].map((m) => m[1]).sort();
    expect(literal).toEqual([...Object.keys(HISTORY_CHANNELS), 'history:status', 'history:save-track', 'history:recognize', 'history:recognize-cancel', 'history:recognize-status'].sort());
  });

  it('maps every channel to a method the store has', () => {
    for (const method of Object.values(HISTORY_CHANNELS)) expect(typeof store[method], method).toBe('function');
  });

  it("answers a call from the main window with the store's value", async () => {
    expect(await call('history:open-record', rec())).toEqual({ ok: true, value: undefined });
    expect(await call('history:list-records', {})).toEqual({ ok: true, value: [expect.objectContaining({ id: 'run-0001-aaaa' })] });
    expect(await call('history:get-record', { id: 'run-0001-aaaa' })).toEqual({ ok: true, value: expect.objectContaining({ id: 'run-0001-aaaa' }) });
    expect(await call('history:get-legs', { id: 'run-0001-aaaa' })).toEqual({ ok: true, value: [] });
  });

  it('refuses another window, and writes nothing', async () => {
    expect(await handlers.get('history:open-record')({ sender: POPOVER }, rec())).toEqual({ ok: false, error: 'History refused: not the main window' });
    expect(await handlers.get('history:status')({ sender: POPOVER }, {})).toEqual({ ok: false, error: 'History refused: not the main window' });
    expect(store.listRecords({})).toEqual([]);
  });

  it('turns a store error into an answer with its code', async () => {
    await call('history:open-record', rec());
    expect(await call('history:open-record', rec())).toEqual({ ok: false, error: expect.any(String), code: 'RECORD_EXISTS' });
  });

  it('refuses a payload that is not an object', async () => {
    expect(await call('history:search', 'abc')).toEqual({ ok: false, error: expect.any(String), code: 'BAD_PAYLOAD' });
    expect(await call('history:get-record', null)).toEqual({ ok: false, error: expect.any(String), code: 'BAD_PAYLOAD' });
  });

  it('says so when the store could not be opened', async () => {
    register({ getStore: () => null, getUnavailableReason: () => 'newer' });
    expect(await call('history:list-records', {})).toEqual({ ok: false, error: 'History is not available', code: 'UNAVAILABLE' });
    expect(await call('history:status', {})).toEqual({ ok: true, value: { available: false, reason: 'newer', dir } });
  });

  it('saves a recording through the system dialog, for the main window only', async () => {
    await call('history:open-record', rec());
    await call('history:append-track', { recordId: 'run-0001-aaaa', source: 'speaker', offsetMs: 0, durationMs: 20, data: new Uint8Array([1, 2, 3]) });
    const asked = [];
    register({ showSaveDialog: async (o) => { asked.push(o); return { canceled: false, filePath: join(dir, 'saved.opus') }; } });
    const payload = { recordId: 'run-0001-aaaa', source: 'speaker', title: 'Save the recording', defaultName: 'r-me.opus' };
    expect(await handlers.get('history:save-track')({ sender: POPOVER }, payload)).toEqual({ ok: false, error: 'History refused: not the main window' });
    expect(asked).toEqual([]);
    expect(await call('history:save-track', payload)).toEqual({ ok: true, value: { saved: true } });
    expect(asked[0]).toMatchObject({ title: 'Save the recording', defaultPath: join(dir, 'r-me.opus') });
    expect([...readFileSync(join(dir, 'saved.opus'))]).toEqual([1, 2, 3]);
    expect(await call('history:save-track', { ...payload, source: 'participant' })).toEqual({ ok: false, error: expect.any(String), code: 'NO_TRACK' });
  });

  it('hands a recognition to the recognizer with the store, and its cancel and state', async () => {
    const asked = [];
    const recognizer = {
      recognize: async (r) => { asked.push(r); return { tokens: [], audioMs: 5 }; },
      cancel: (jobId) => jobId === 'job-1',
      status: (jobId) => (jobId === 'job-1' ? { phase: 'queued' } : null),
    };
    register({ recognizer });
    const payload = {
      recordId: 'run-0001-aaaa', service: 'soniox', source: 'speaker', apiKey: 'k', region: 'us', languageHints: ['zh'], jobId: 'job-1',
      translateTo: 'en', context: { terms: ['Sokuji'] },
    };
    expect(await handlers.get('history:recognize')({ sender: POPOVER }, payload)).toEqual({ ok: false, error: 'History refused: not the main window' });
    expect(asked).toEqual([]);
    expect(await call('history:recognize', payload)).toEqual({ ok: true, value: { tokens: [], audioMs: 5 } });
    expect(asked).toEqual([{ ...payload, store }]);
    expect(await call('history:recognize-cancel', { jobId: 'job-1' })).toEqual({ ok: true, value: true });
    expect(await call('history:recognize-status', { jobId: 'job-1' })).toEqual({ ok: true, value: { phase: 'queued' } });
    expect(await call('history:recognize-status', { jobId: 'job-2' })).toEqual({ ok: true, value: null });
  });

  it('says the store is there when it is', async () => {
    expect(await call('history:status', {})).toEqual({ ok: true, value: { available: true, dir } });
  });
});

// Review: a clean-up step that fails at launch must not make History unavailable for the whole session.
describe('opening History at launch', () => {
  const quiet = () => ({ log: [], warn: [], error: [] });
  const logger = (out) => ({ log: (...a) => out.log.push(a), warn: (...a) => out.warn.push(a), error: (...a) => out.error.push(a) });

  it('keeps History when a clean-up step fails, and says what failed', () => {
    const out = quiet();
    const fake = {
      recoverOpenRecords: () => ({ closed: [], dropped: [] }),
      reconcile: () => { throw new Error('EACCES: records'); },
      purgeExpired: () => ({ purged: [], failed: [] }),
      close: () => {},
    };
    const opened = openHistoryAtLaunch({ dir, open: () => fake, logger: logger(out) });
    expect(opened).toEqual({ store: fake, unavailable: null });
    expect(out.error.map((a) => String(a[0]))).toEqual([expect.stringContaining('reconcile')]);
  });

  it('runs every clean-up step even when an earlier one fails', () => {
    const ran = [];
    const fake = {
      recoverOpenRecords: () => { ran.push('recover'); throw new Error('locked'); },
      reconcile: () => { ran.push('reconcile'); return { removedEmpty: [], strays: ['run-0008-files'], tracksGone: 0 }; },
      purgeExpired: () => { ran.push('purge'); return { purged: [], failed: [] }; },
      close: () => {},
    };
    const out = quiet();
    openHistoryAtLaunch({ dir, open: () => fake, logger: logger(out) });
    expect(ran).toEqual(['recover', 'reconcile', 'purge']);
    expect(out.warn.flat().join(' ')).toContain('run-0008-files');
  });

  it('says why when the store cannot be opened', () => {
    const newer = Object.assign(new Error('newer'), { code: 'HISTORY_NEWER' });
    expect(openHistoryAtLaunch({ dir, open: () => { throw newer; }, logger: logger(quiet()) })).toEqual({ store: null, unavailable: 'newer' });
    expect(openHistoryAtLaunch({ dir, open: () => { throw new Error('disk'); }, logger: logger(quiet()) })).toEqual({ store: null, unavailable: 'error' });
  });

  it('opens a real store in the folder', () => {
    const sub = join(dir, 'launch');
    const opened = openHistoryAtLaunch({ dir: sub, logger: logger(quiet()) });
    expect(opened.unavailable).toBeNull();
    expect(opened.store.listRecords({})).toEqual([]);
    opened.store.close();
  });
});
