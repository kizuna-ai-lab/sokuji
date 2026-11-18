// @vitest-environment node
// An import against the real History store: what is kept and what is removed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVirtualClock } from '../../contract/clock';
import type { HistoryPort } from '../port';
import type { OpusEncoderFactory } from '../recording/track';
import { importFile, type DecodedAudio } from './importFile';

const nodeRequire = createRequire(import.meta.url);
const { openHistory } = nodeRequire('../../../../electron/history-store.js');

const HEAD = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1, 0x38, 0x01, 0xc0, 0x5d, 0, 0, 0, 0, 0]);
const encoder: OpusEncoderFactory = (onPacket, onHead) => {
  let sent = false;
  let held = 0;
  return {
    encode(p) { if (!sent) { sent = true; onHead(HEAD); } held += p.length; while (held >= 480) { held -= 480; onPacket(new Uint8Array([1, 2, 3]), 960); } },
    async flush() {},
    close() {},
  };
};
const decoded = (silent: boolean): DecodedAudio => ({
  durationMs: 2000,
  async *pcm24k() { for (let i = 0; i < 2; i++) yield new Int16Array(24_000).fill(silent ? 0 : 3000); },
});

let dir: string;
let store: ReturnType<typeof openHistory>;
/** The page's port over the store itself, as main answers it. */
const portOver = (s: Record<string, (a: unknown) => unknown>, over: Partial<HistoryPort> = {}): HistoryPort => new Proxy({}, {
  get: (_t, name: string) => (over as Record<string, unknown>)[name] ?? (async (a: unknown) => s[name](a)),
}) as HistoryPort;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sokuji-import-store-')); store = openHistory({ dir }); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const run = (port: HistoryPort, silent: boolean) => importFile({
  port, file: { name: 'Talk.m4a', size: 10, lastModified: 1_800_000_000_000 } as unknown as File, myLanguage: 'en', options: { languages: ['en'], translateTo: 'en' },
  service: { service: 'soniox', apiKey: 'k', region: 'us', languages: ['en'] }, appVersion: '1', readDuration: async () => 2000, decode: async () => decoded(silent),
  encoder, clock: createVirtualClock(0), newId: () => 'imp-0001-aaaa', newJobId: () => 'job', pause: async () => {},
});

describe('an import in the real store', () => {
  it('keeps the record and its recording when recognition fails', async () => {
    const port = portOver(store, { recognize: async () => { throw Object.assign(new Error('refused'), { code: 'NO_KEY' }); } });
    expect(await run(port, false)).toEqual({ recordId: 'imp-0001-aaaa', transcribed: false, failure: 'NO_KEY' });
    expect(store.getRecord('imp-0001-aaaa')).toEqual(expect.objectContaining({ state: 'closed', hasRecording: true, title: 'Talk' }));
  });

  it('leaves nothing behind for a silent file', async () => {
    await expect(run(portOver(store), true)).rejects.toMatchObject({ code: 'NO_AUDIO' });
    expect(store.listRecords({})).toEqual([]);
    expect(store.listRecords({ binned: true })).toEqual([]);
    expect(existsSync(join(dir, 'records', 'imp-0001-aaaa'))).toBe(false);
  });
});
