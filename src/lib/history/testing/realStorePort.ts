// src/lib/history/testing/realStorePort.ts
//
// For tests only: a History port answered by the app's own history store (electron/history-store.js) in a folder
// of its own, so a test sees what the store really keeps (a record left and opened again, a bin emptied) rather
// than what a fake returns. Not imported by the app.
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HISTORY_PORT_CHANNELS, type HistoryPort } from '../port';

/** The store's methods the tests call directly, to lay out a record before the page opens it. */
export type HistoryStore = Record<string, (arg?: unknown) => unknown> & { close(): void };

export interface RealStorePort {
  port: HistoryPort;
  store: HistoryStore;
  dir: string;
  /** Closes the store and removes its folder. */
  dispose(): void;
}

export function realStorePort(): RealStorePort {
  const dir = mkdtempSync(join(tmpdir(), 'sokuji-history-test-'));
  const nodeRequire = createRequire(import.meta.url);
  const { openHistory } = nodeRequire('../../../../electron/history-store.js') as { openHistory(o: { dir: string }): HistoryStore };
  const store = openHistory({ dir });
  // Each port method calls the store method of the same name, as electron/history-ipc.js does.
  const methods = HISTORY_PORT_CHANNELS
    .filter(([name]) => typeof store[name] === 'function')
    .map(([name]) => [name, async (arg?: unknown) => store[name](arg)] as const);
  const port = Object.fromEntries(methods) as unknown as HistoryPort;
  Object.assign(port, { status: async () => ({ available: true, dir }) });
  return { port, store, dir, dispose: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
