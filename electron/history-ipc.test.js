// electron/history-ipc.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { setupHistoryHandlers, HISTORY_CHANNELS } = nodeRequire('./history-ipc.js');
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
    expect([...handlers.keys()].sort()).toEqual([...Object.keys(HISTORY_CHANNELS), 'history:status'].sort());
    expect(Object.keys(HISTORY_CHANNELS)).toHaveLength(25);
  });

  it('writes every channel out as a literal handle call, the way the registry guard reads them', () => {
    const src = readFileSync(join(__dirname, 'history-ipc.js'), 'utf8');
    const literal = [...src.matchAll(/ipcMain\.handle\(\s*'(history:[^']+)'/g)].map((m) => m[1]).sort();
    expect(literal).toEqual([...Object.keys(HISTORY_CHANNELS), 'history:status'].sort());
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

  it('says the store is there when it is', async () => {
    expect(await call('history:status', {})).toEqual({ ok: true, value: { available: true, dir } });
  });
});
