// electron/history-store.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { openHistory } = nodeRequire('./history-store.js');

let dir;
let s;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sokuji-history-'));
  s = openHistory({ dir });
});
afterEach(() => {
  s.close();
  rmSync(dir, { recursive: true, force: true });
});

const ID = 'run-0001-aaaa';
const rec = (over = {}) => ({
  id: ID,
  startedAt: 1_800_000_000_000,
  mode: 'both',
  myLanguage: 'zh',
  targetLanguage: 'en',
  services: { provider: 'soniox', models: { asr: 'stt-rt-v4' } },
  appVersion: '0.51.0',
  ...over,
});

describe('records', () => {
  it('opens, lists and reads back a record', () => {
    s.openRecord(rec());
    expect(s.listRecords({})).toEqual([expect.objectContaining({ id: ID, state: 'open', endedAt: null, mode: 'both', title: null, sentences: 0, hasRecording: false, notesVersions: 0 })]);
    expect(s.getRecord(ID)).toEqual(expect.objectContaining({ services: { provider: 'soniox', models: { asr: 'stt-rt-v4' } }, tracks: [], transcripts: [], notes: [] }));
    s.openRecord(rec({ id: 'run-0002-bbbb', mode: 'face-to-face' }));
    expect(s.getRecord('run-0002-bbbb').mode).toBe('face-to-face');
    expect(s.getRecord('nope-0000-0000')).toBeNull();
  });

  it('refuses a second record with the same id and an id that could leave the folder', () => {
    s.openRecord(rec());
    expect(() => s.openRecord(rec())).toThrow(expect.objectContaining({ code: 'RECORD_EXISTS' }));
    expect(() => s.openRecord(rec({ id: '../../etc' }))).toThrow(expect.objectContaining({ code: 'BAD_ID' }));
  });

  it('lists newest first and pages with before', () => {
    s.openRecord(rec({ id: 'run-0001-aaaa', startedAt: 1000 }));
    s.openRecord(rec({ id: 'run-0002-bbbb', startedAt: 3000 }));
    s.openRecord(rec({ id: 'run-0003-cccc', startedAt: 2000 }));
    expect(s.listRecords({}).map((r) => r.id)).toEqual(['run-0002-bbbb', 'run-0003-cccc', 'run-0001-aaaa']);
    expect(s.listRecords({ before: 3000, limit: 1 }).map((r) => r.id)).toEqual(['run-0003-cccc']);
  });

  it('closing a record without content removes it and its folder', () => {
    s.openRecord(rec());
    mkdirSync(s.recordDir(ID), { recursive: true });
    expect(s.closeRecord({ id: ID, endedAt: 5 })).toEqual({ kept: false });
    expect(s.listRecords({})).toEqual([]);
    expect(existsSync(join(dir, 'records', ID))).toBe(false);
  });

  it('renames, and an empty title goes back to none', () => {
    s.openRecord(rec());
    s.renameRecord({ id: ID, title: 'Weekly sync' });
    expect(s.getRecord(ID)).toEqual(expect.objectContaining({ title: 'Weekly sync', titleByUser: true }));
    s.renameRecord({ id: ID, title: '  ' });
    expect(s.getRecord(ID)).toEqual(expect.objectContaining({ title: null, titleByUser: false }));
  });

  it('survives being closed and opened again', () => {
    s.openRecord(rec());
    s.close();
    s = openHistory({ dir });
    expect(s.listRecords({}).length).toBe(1);
  });
});
