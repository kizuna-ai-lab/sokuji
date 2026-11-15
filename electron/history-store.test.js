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

describe('the conversation as the app holds it', () => {
  const seg = (n, over = {}) => ({ id: `${ID}:speaker:${n}`, ref: n, side: 'source', text: `s${n}`, final: true, openedAt: 10 + n, marks: [], ...over });

  it('returns the conversation in the shape the exporter reads', () => {
    s.openRecord(rec());
    s.putLeg({ recordId: ID, leg: 'participant', languages: { source: 'en', target: 'zh' } });
    s.putLeg({ recordId: ID, leg: 'speaker', languages: { source: 'zh', target: 'en' } });
    s.putSegments({ recordId: ID, leg: 'speaker', segments: [
      { id: `${ID}:speaker:1`, ref: 1, side: 'source', text: '你好', final: true, openedAt: 10, marks: [{ at: 0, len: 2 }], timing: { startMs: 100, endMs: 900 }, language: 'zh', person: '1' },
      { id: `${ID}:speaker:2`, ref: 1, side: 'translation', text: 'Hello', final: true, openedAt: 11, marks: [] },
    ] });
    const legs = s.getLegs(ID);
    expect(legs.map((l) => l.leg)).toEqual(['speaker', 'participant']);
    expect(legs[0]).toEqual({ leg: 'speaker', session: ID, languages: { source: 'zh', target: 'en' }, notices: [], segments: [
      { id: `${ID}:speaker:1`, ref: 1, side: 'source', text: '你好', final: true, openedAt: 10, marks: [{ at: 0, len: 2 }], timing: { startMs: 100, endMs: 900 }, language: 'zh', person: '1', speech: [] },
      { id: `${ID}:speaker:2`, ref: 1, side: 'translation', text: 'Hello', final: true, openedAt: 11, marks: [], speech: [] },
    ] });
  });

  it('a segment sent again replaces its text and keeps its place', () => {
    s.openRecord(rec());
    s.putLeg({ recordId: ID, leg: 'speaker', languages: { source: 'zh', target: 'en' } });
    s.putSegments({ recordId: ID, leg: 'speaker', segments: [seg(1, { text: 'first' })] });
    s.putSegments({ recordId: ID, leg: 'speaker', segments: [seg(2, { text: 'second' })] });
    s.putSegments({ recordId: ID, leg: 'speaker', segments: [seg(1, { text: 'revised', final: false })] });
    expect(s.getLegs(ID)[0].segments.map((x) => [x.id, x.text])).toEqual([[`${ID}:speaker:1`, 'revised'], [`${ID}:speaker:2`, 'second']]);
    expect(s.getLegs(ID)[0].segments[0].final).toBe(false);
  });

  it('keeps notices whole and in order of their time', () => {
    s.openRecord(rec());
    s.putLeg({ recordId: ID, leg: 'speaker', languages: { source: 'zh', target: 'en' } });
    const late = { id: 'n-2', at: 30, severity: 'warning', message: 'Late', code: 'late_code', params: { n: 2 } };
    const early = { id: 'n-1', at: 20, severity: 'info', message: 'Early', lifetime: 'transient' };
    s.putNotices({ recordId: ID, leg: 'speaker', notices: [late, early] });
    expect(s.getLegs(ID)[0].notices).toEqual([early, late]);
  });

  it('refuses segments for a closed record', () => {
    s.openRecord(rec());
    s.putLeg({ recordId: ID, leg: 'speaker', languages: { source: 'zh', target: 'en' } });
    s.putSegments({ recordId: ID, leg: 'speaker', segments: [seg(1)] });
    expect(s.closeRecord({ id: ID, endedAt: 99 })).toEqual({ kept: true });
    expect(() => s.putSegments({ recordId: ID, leg: 'speaker', segments: [] })).toThrow(expect.objectContaining({ code: 'RECORD_CLOSED' }));
  });

  it('keeps how each leg was put together, apart from the conversation', () => {
    s.openRecord(rec({ mode: 'face-to-face' }));
    s.putLeg({ recordId: ID, leg: 'speaker', languages: { source: 'zh', target: 'ja' }, input: 'microphone', inputName: 'MacBook Pro Microphone', inputId: 'default', spoken: true });
    s.putLeg({ recordId: ID, leg: 'participant', languages: { source: 'ja', target: 'zh' }, input: 'microphone', inputName: 'MacBook Pro Microphone', inputId: 'default', spoken: true });
    expect(s.getRecord(ID).legs).toEqual([
      { leg: 'speaker', languages: { source: 'zh', target: 'ja' }, input: 'microphone', inputName: 'MacBook Pro Microphone', inputId: 'default', translated: true, spoken: true },
      { leg: 'participant', languages: { source: 'ja', target: 'zh' }, input: 'microphone', inputName: 'MacBook Pro Microphone', inputId: 'default', translated: true, spoken: true },
    ]);
    expect(s.getLegs(ID)[0]).not.toHaveProperty('input');
  });

  it('closing keeps a record that has text but no sentence (a service that sends translations only)', () => {
    s.openRecord(rec());
    s.putLeg({ recordId: ID, leg: 'participant', languages: { source: 'ja', target: 'zh' } });
    s.putSegments({ recordId: ID, leg: 'participant', segments: [{ id: `${ID}:participant:1`, ref: 1, side: 'translation', text: '好的。', final: true, openedAt: 9000, marks: [] }] });
    expect(s.closeRecord({ id: ID, endedAt: 9500 })).toEqual({ kept: true });
    expect(s.getRecord(ID)).toEqual(expect.objectContaining({ state: 'closed', endedAt: 9500, sentences: 0 }));
  });

  it('closing drops a record whose only segments are blank', () => {
    s.openRecord(rec());
    s.putLeg({ recordId: ID, leg: 'speaker', languages: { source: 'zh', target: 'en' } });
    s.putSegments({ recordId: ID, leg: 'speaker', segments: [{ id: `${ID}:speaker:1`, ref: 1, side: 'source', text: '  ', final: true, openedAt: 10, marks: [] }] });
    expect(s.closeRecord({ id: ID, endedAt: 20 })).toEqual({ kept: false });
    expect(s.getRecord(ID)).toBeNull();
  });
});

describe('transcripts and sentences', () => {
  const sent = (n, over = {}) => ({ n, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: n * 1000, endMs: n * 1000 + 800, text: `s${n}`, timeKind: 'given', ...over });
  let t;
  beforeEach(() => {
    s.openRecord(rec());
    t = s.createTranscript({ recordId: ID, origin: { service: 'soniox', kind: 'live' } });
  });

  it('stores sentences and returns them in reading order, not arrival order', () => {
    s.appendSentences({ transcriptId: t, sentences: [sent(1, { startMs: 5000 }), sent(2, { startMs: 1000, side: 'other', track: 'other' }), sent(3, { startMs: 1000 })] });
    expect(s.getSentences({ transcriptId: t }).map((x) => x.n)).toEqual([3, 2, 1]);
  });

  it('a sentence sent twice is stored once', () => {
    expect(s.appendSentences({ transcriptId: t, sentences: [sent(1)] })).toEqual({ added: 1 });
    expect(s.appendSentences({ transcriptId: t, sentences: [sent(1), sent(2)] })).toEqual({ added: 1 });
    expect(s.getSentences({ transcriptId: t }).length).toBe(2);
  });

  it('the same number with another time is refused and nothing of that call is kept', () => {
    s.appendSentences({ transcriptId: t, sentences: [sent(1)] });
    expect(() => s.appendSentences({ transcriptId: t, sentences: [sent(2), sent(1, { startMs: 9 })] })).toThrow(expect.objectContaining({ code: 'SENTENCE_CONFLICT' }));
    expect(s.getSentences({ transcriptId: t }).map((x) => x.n)).toEqual([1]);
  });

  it('text can be revised while the record is open, and not after', () => {
    s.appendSentences({ transcriptId: t, sentences: [sent(1)] });
    s.reviseSentences({ transcriptId: t, revisions: [{ n: 1, text: 'Hello, world.' }] });
    expect(s.getSentences({ transcriptId: t })[0]).toEqual(expect.objectContaining({ n: 1, text: 'Hello, world.', startMs: 1000 }));
    expect(() => s.reviseSentences({ transcriptId: t, revisions: [{ n: 7, text: 'x' }] })).toThrow(expect.objectContaining({ code: 'NO_SENTENCE' }));
    s.closeRecord({ id: ID, endedAt: 99 });
    expect(() => s.reviseSentences({ transcriptId: t, revisions: [{ n: 1, text: 'x' }] })).toThrow(expect.objectContaining({ code: 'RECORD_CLOSED' }));
  });

  it('a record with a sentence is kept when closed', () => {
    s.appendSentences({ transcriptId: t, sentences: [sent(1)] });
    expect(s.closeRecord({ id: ID, endedAt: 99 })).toEqual({ kept: true });
    expect(s.listRecords({})).toEqual([expect.objectContaining({ id: ID, sentences: 1, state: 'closed' })]);
  });
});

describe('launch', () => {
  const sent = (n, over = {}) => ({ n, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: n * 1000, endMs: n * 1000 + 800, text: `s${n}`, timeKind: 'given', ...over });

  it('at launch an open record is closed at its last sentence, or at its last segment when it has text only; one without content is dropped with its folder', () => {
    s.openRecord(rec({ id: 'run-0001-aaaa', startedAt: 1000 }));
    s.openRecord(rec({ id: 'run-0002-bbbb', startedAt: 2000 }));
    s.openRecord(rec({ id: 'run-0003-cccc', startedAt: 3000 }));
    const t = s.createTranscript({ recordId: 'run-0001-aaaa', origin: { service: 'soniox', kind: 'live' } });
    s.appendSentences({ transcriptId: t, sentences: [sent(1), sent(2, { endMs: 7300 })] });
    s.putLeg({ recordId: 'run-0003-cccc', leg: 'participant', languages: { source: 'ja', target: 'zh' } });
    s.putSegments({ recordId: 'run-0003-cccc', leg: 'participant', segments: [{ id: 'run-0003-cccc:participant:1', ref: 1, side: 'translation', text: '好的。', final: true, openedAt: 9100, marks: [] }] });
    mkdirSync(s.recordDir('run-0002-bbbb'), { recursive: true });
    s.close();
    s = openHistory({ dir });
    expect(s.recoverOpenRecords()).toEqual({ closed: ['run-0001-aaaa', 'run-0003-cccc'], dropped: ['run-0002-bbbb'] });
    expect(s.getRecord('run-0001-aaaa')).toEqual(expect.objectContaining({ state: 'closed', endedAt: 1000 + 7300 }));
    expect(s.getRecord('run-0003-cccc')).toEqual(expect.objectContaining({ state: 'closed', endedAt: 9100 }));
    expect(s.getRecord('run-0002-bbbb')).toBeNull();
    expect(existsSync(join(dir, 'records', 'run-0002-bbbb'))).toBe(false);
  });

  it('a transcript says whether its text is the original or the translation', () => {
    s.openRecord(rec());
    const a = s.createTranscript({ recordId: 'run-0001-aaaa', origin: { service: 'soniox', kind: 'live' } });
    const b = s.createTranscript({ recordId: 'run-0001-aaaa', origin: { service: 'local_inference', kind: 'live' }, textKind: 'translation' });
    expect(s.getRecord('run-0001-aaaa').transcripts.map((x) => [x.id, x.textKind])).toEqual([[a, 'original'], [b, 'translation']]);
  });
});
