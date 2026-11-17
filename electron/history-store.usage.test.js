// The space Settings › History shows is what is on the disk, and deleting a record with a recording frees it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { openHistory } = nodeRequire('./history-store.js');

const A = 'run-000a-aaaa';
const B = 'run-000b-bbbb';
const sentence = { n: 1, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: 1000, endMs: 1800, text: 'Hello.', timeKind: 'given' };

let dir;
let s;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sokuji-history-usage-'));
  s = openHistory({ dir });
});
afterEach(() => {
  s.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A closed record with one sentence and `bytes` of recording written through the store, the way a session writes it. */
function recorded(id, startedAt, bytes) {
  s.openRecord({ id, startedAt, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '0.51.0' });
  const t = s.createTranscript({ recordId: id, origin: { service: 'soniox', kind: 'live' } });
  s.appendSentences({ transcriptId: t, sentences: [sentence] });
  s.appendTrack({ recordId: id, source: 'speaker', offsetMs: 0, durationMs: 1000, data: new Uint8Array(bytes).fill(1) });
  s.closeRecord({ id, endedAt: startedAt + 5000 });
}
const sizeOf = (file) => (existsSync(file) ? statSync(file).size : 0);

describe('History usage matches the disk', () => {
  it('the recordings figure is the size of the recording files, the database figure the size of its files', () => {
    recorded(A, 1000, 4000);
    recorded(B, 2000, 1500);
    const u = s.usage();
    const onDisk = sizeOf(join(s.recordDir(A), 'speaker.opus')) + sizeOf(join(s.recordDir(B), 'speaker.opus'));
    expect(onDisk).toBe(5500);
    expect(u.audioBytes).toBe(onDisk);
    expect(u.dbBytes).toBe(sizeOf(join(dir, 'history.db')) + sizeOf(join(dir, 'history.db-wal')));
    expect(u.records).toBe(2);
  });

  it('a record in the bin still takes its space; deleted for good, its recording leaves the disk and the figures', () => {
    recorded(A, 1000, 4000);
    recorded(B, 2000, 1500);
    s.binRecords({ ids: [A] });
    expect(s.usage()).toMatchObject({ audioBytes: 5500, records: 2, binned: 1 });

    expect(s.purgeRecords({ ids: [A] })).toEqual({ purged: [A], failed: [] });
    expect(existsSync(join(dir, 'records', A))).toBe(false);
    expect(s.usage()).toMatchObject({ audioBytes: 1500, records: 1, binned: 0 });
    expect(s.usage().audioBytes).toBe(sizeOf(join(s.recordDir(B), 'speaker.opus')));
  });
});
