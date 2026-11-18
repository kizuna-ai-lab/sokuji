// electron/history-store.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const { openHistory, BIN_DAYS } = nodeRequire('./history-store.js');
// The store's own `fs`: a failure is put in its way here, the same on every platform (Windows has no chmod to lean on).
const storeFs = nodeRequire('node:fs');
/** `fs[name]` fails with `code` for `target` only, until the test's end. */
function failFor(name, target, code) {
  const real = storeFs[name];
  return vi.spyOn(storeFs, name).mockImplementation((p, ...rest) => {
    if (p === target) throw Object.assign(new Error(`${code}: ${name} ${p}`), { code });
    return real.call(storeFs, p, ...rest);
  });
}

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

  it('an imported file’s record keeps its recording without a transcript, closed or recovered; a live one does not', () => {
    const piece = { source: 'participant', offsetMs: 0, durationMs: 1000, data: new Uint8Array([1, 2, 3]) };
    s.openRecord(rec({ id: 'imp-0001-aaaa', mode: 'import' }));
    s.appendTrack({ recordId: 'imp-0001-aaaa', ...piece });
    expect(s.closeRecord({ id: 'imp-0001-aaaa', endedAt: 5 })).toEqual({ kept: true });
    expect(s.getRecord('imp-0001-aaaa')).toEqual(expect.objectContaining({ state: 'closed', hasRecording: true }));

    s.openRecord(rec({ id: 'imp-0002-bbbb', mode: 'import' }));
    s.appendTrack({ recordId: 'imp-0002-bbbb', ...piece });
    s.openRecord(rec({ id: 'run-0003-cccc' }));
    s.appendTrack({ recordId: 'run-0003-cccc', ...piece });
    expect(s.recoverOpenRecords()).toEqual({ closed: ['imp-0002-bbbb'], dropped: ['run-0003-cccc'] });
    expect(s.getRecord('imp-0002-bbbb')).toEqual(expect.objectContaining({ state: 'closed', hasRecording: true }));
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

  it('a sentence keeps the translation that began in it; one where none began, and a session\u2019s, have none', () => {
    s.appendSentences({ transcriptId: t, sentences: [
      sent(1, { segmentId: 'f-1', translation: '你好。你好吗？' }), sent(2, { segmentId: 'f-1' }), sent(3, { segmentId: 'f-2', translation: '再见。' }),
    ] });
    expect(s.getSentences({ transcriptId: t }).map((x) => [x.n, x.translation])).toEqual([[1, '你好。你好吗？'], [2, null], [3, '再见。']]);
    expect(() => s.appendSentences({ transcriptId: t, sentences: [sent(4, { translation: 5 })] })).toThrow(expect.objectContaining({ code: 'BAD_INPUT' }));
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

describe('a half-written transcript', () => {
  const sent = (n) => ({ n, side: 'other', sideCertain: true, track: 'other', speaker: '1', startMs: n * 1000, endMs: n * 1000 + 800, text: `s${n}`, timeKind: 'given' });
  it('is deleted by its id with its sentences; the record and its other transcripts stay', () => {
    s.openRecord(rec());
    const live = s.createTranscript({ recordId: 'run-0001-aaaa', origin: { service: 'soniox', kind: 'live' } });
    s.appendSentences({ transcriptId: live, sentences: [sent(1), sent(2), sent(3)] });
    const half = s.createTranscript({ recordId: 'run-0001-aaaa', origin: { service: 'soniox', kind: 'file' } });
    s.appendSentences({ transcriptId: half, sentences: [sent(1)] });
    expect(s.getRecord('run-0001-aaaa').sentences).toBe(1);
    s.deleteTranscript({ transcriptId: half });
    const r = s.getRecord('run-0001-aaaa');
    expect(r.transcripts.map((x) => x.id)).toEqual([live]);
    expect(r.sentences).toBe(3);
    expect(s.getSentences({ transcriptId: live }).length).toBe(3);
    expect(() => s.deleteTranscript({ transcriptId: half })).toThrow();
  });
});

describe('speakers', () => {
  const sent = (n, over = {}) => ({ n, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: n * 1000, endMs: n * 1000 + 800, text: `s${n}`, timeKind: 'given', ...over });
  let t;
  beforeEach(() => {
    s.openRecord(rec());
    t = s.createTranscript({ recordId: ID, origin: { service: 'soniox', kind: 'live' } });
  });

  it('a rename shows on every sentence of that speaker and on none of another', () => {
    s.appendSentences({ transcriptId: t, sentences: [sent(1), sent(2, { speaker: '2' }), sent(3)] });
    s.renameSpeaker({ transcriptId: t, side: 'mine', speaker: '1', name: 'Mina' });
    expect(s.getSentences({ transcriptId: t }).map((x) => x.speakerName)).toEqual(['Mina', null, 'Mina']);
  });

  it("one sentence can be given to another speaker; the recognizer's label stays", () => {
    s.appendSentences({ transcriptId: t, sentences: [sent(1), sent(2)] });
    s.renameSpeaker({ transcriptId: t, side: 'mine', speaker: '2', name: 'Ren' });
    s.reassignSentence({ transcriptId: t, n: 2, speaker: '2' });
    expect(s.getSentences({ transcriptId: t })[1]).toEqual(expect.objectContaining({ speaker: '1', speakerByUser: '2', speakerName: 'Ren' }));
    s.reassignSentence({ transcriptId: t, n: 2, speaker: null });
    expect(s.getSentences({ transcriptId: t })[1]).toEqual(expect.objectContaining({ speakerByUser: null, speakerName: null }));
  });

  it('the same speaker number on the other side is a different speaker', () => {
    s.appendSentences({ transcriptId: t, sentences: [sent(1), sent(2, { side: 'other', track: 'other' })] });
    s.renameSpeaker({ transcriptId: t, side: 'other', speaker: '1', name: 'Guest' });
    expect(s.getSpeakers({ transcriptId: t })).toEqual([{ side: 'mine', speaker: '1', name: null, sentences: 1 }, { side: 'other', speaker: '1', name: 'Guest', sentences: 1 }]);
  });

  it('works after the record is closed, and an empty name takes the name away', () => {
    s.appendSentences({ transcriptId: t, sentences: [sent(1), sent(2)] });
    s.closeRecord({ id: ID, endedAt: 99 });
    s.renameSpeaker({ transcriptId: t, side: 'mine', speaker: '1', name: 'Mina' });
    s.reassignSentence({ transcriptId: t, n: 2, speaker: '3' });
    expect(s.getSpeakers({ transcriptId: t })).toEqual([{ side: 'mine', speaker: '1', name: 'Mina', sentences: 1 }, { side: 'mine', speaker: '3', name: null, sentences: 1 }]);
    s.renameSpeaker({ transcriptId: t, side: 'mine', speaker: '1', name: ' ' });
    expect(s.getSentences({ transcriptId: t })[0].speakerName).toBeNull();
    expect(() => s.reassignSentence({ transcriptId: t, n: 9, speaker: '1' })).toThrow(expect.objectContaining({ code: 'NO_SENTENCE' }));
  });
});

describe('notes versions', () => {
  const BODY = {
    title: 'Budget review',
    overview: { text: 'We went through the budget.', format: 'plain' },
    topics: [{ title: 'Costs', summary: 'Travel is down by a fifth.' }],
    points: [{ text: 'Send the revised sheet by Friday.' }],
    names: [],
  };
  let t;
  const notes = (over = {}) => ({ recordId: ID, transcriptId: t, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'model-a' }, language: 'zh', state: 'complete', body: BODY, ...over });
  beforeEach(() => {
    s.openRecord(rec());
    t = s.createTranscript({ recordId: ID, origin: { service: 'soniox', kind: 'live' } });
  });

  it('every version is kept, newest first, and none replaces another', () => {
    const a = s.saveNotes(notes({ language: 'zh' }));
    const b = s.saveNotes(notes({ language: 'en' }));
    expect(s.listNotes({ recordId: ID }).map((x) => [x.id, x.language])).toEqual([[b, 'en'], [a, 'zh']]);
    expect(s.getNotes({ id: a }).body.title).toBe('Budget review');
    expect(s.getNotes({ id: 999 })).toBeNull();
  });

  it("a record's row says how its newest version ended", () => {
    expect(s.listRecords({})[0]).toEqual(expect.objectContaining({ notesState: null, notesComplete: false }));
    s.saveNotes(notes());
    s.saveNotes(notes({ state: 'failed', failure: 'Incorrect API key provided.', body: null }));
    expect(s.listRecords({})[0]).toEqual(expect.objectContaining({ notesVersions: 2, notesState: 'failed', notesComplete: true }));
  });

  it("a version's names to check can be replaced (dismissed ones kept, marked), and nothing else changes", () => {
    const id = s.saveNotes(notes({ body: { ...BODY, names: [{ written: 'Soku G', likely: 'Sokuji', sentences: [4] }] } }));
    s.updateNotesNames({ notesId: id, names: [{ written: 'Soku G', likely: 'Sokuji', sentences: [4], dismissed: true }] });
    expect(s.getNotes({ id }).body).toEqual({ ...BODY, names: [{ written: 'Soku G', likely: 'Sokuji', sentences: [4], dismissed: true }] });
    expect(() => s.updateNotesNames({ notesId: id, names: 'x' })).toThrow(expect.objectContaining({ code: 'BAD_NOTES' }));
    const failed = s.saveNotes(notes({ state: 'failed', failure: 'no', body: null }));
    expect(() => s.updateNotesNames({ notesId: failed, names: [] })).toThrow(expect.objectContaining({ code: 'BAD_NOTES' }));
    expect(() => s.updateNotesNames({ notesId: 999, names: [] })).toThrow(expect.objectContaining({ code: 'NO_NOTES' }));
  });

  it('a failed version is stored with its reason and no body', () => {
    const id = s.saveNotes(notes({ state: 'failed', failure: 'part 2 of 3 failed twice', body: null, requestIds: ['req-1', 'req-2'] }));
    expect(s.getNotes({ id })).toEqual(expect.objectContaining({ state: 'failed', failure: 'part 2 of 3 failed twice', body: null, requestIds: ['req-1', 'req-2'] }));
  });

  it('a complete version without a body is refused', () => {
    expect(() => s.saveNotes(notes({ body: null }))).toThrow(expect.objectContaining({ code: 'BAD_NOTES' }));
  });

  it("notes name their transcript, and it must be the record's", () => {
    s.openRecord(rec({ id: 'run-0002-bbbb' }));
    const other = s.createTranscript({ recordId: 'run-0002-bbbb', origin: { service: 'soniox', kind: 'live' } });
    expect(() => s.saveNotes(notes({ transcriptId: other }))).toThrow(expect.objectContaining({ code: 'TRANSCRIPT_MISMATCH' }));
    expect(s.listNotes({ recordId: ID })[0]).toBeUndefined();
  });

  it('the first complete version titles the record unless the user already did', () => {
    s.saveNotes(notes());
    expect(s.getRecord(ID).title).toBe('Budget review');
    s.renameRecord({ id: ID, title: 'Mine' });
    s.saveNotes(notes({ body: { ...BODY, title: 'Other' } }));
    expect(s.getRecord(ID).title).toBe('Mine');
  });
});

describe('search', () => {
  const sent = (n, text, over = {}) => ({ n, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: n * 1000, endMs: n * 1000 + 800, text, timeKind: 'given', ...over });
  /** A record with one live transcript holding these sentence texts; returns the transcript id. */
  const make = (id, startedAt, texts) => {
    s.openRecord(rec({ id, startedAt }));
    const t = s.createTranscript({ recordId: id, origin: { service: 'soniox', kind: 'live' } });
    s.appendSentences({ transcriptId: t, sentences: texts.map((x, i) => sent(i + 1, x)) });
    return t;
  };
  const A = 'run-000a-aaaa';
  const B = 'run-000b-bbbb';

  it('finds a record by a word in a sentence and says where', () => {
    const tA = make(A, 1000, ['我们讨论视频通话的延迟', '下周再看']);
    make(B, 2000, ['nothing here']);
    expect(s.search({ query: '视频通话' })).toEqual([{ recordId: A, title: null, startedAt: 1000, hits: 1, first: { kind: 'sentence', transcriptId: tA, n: 1, text: '我们讨论视频通话的延迟' } }]);
  });

  it('matches two-character words and is case-insensitive for Latin text', () => {
    make(A, 1000, ['我们讨论视频通话的延迟']);
    make(B, 2000, ['nothing here']);
    expect(s.search({ query: '通话' }).length).toBe(1);
    expect(s.search({ query: 'NOTHING' }).map((r) => r.recordId)).toEqual([B]);
  });

  it('treats % _ and backslash as plain characters', () => {
    make('run-000c-cccc', 1000, ['完成 100% 了']);
    make('run-000d-dddd', 2000, ['a_b']);
    make('run-000e-eeee', 3000, ['path C:\\temp']);
    expect(s.search({ query: '100%' }).map((r) => r.recordId)).toEqual(['run-000c-cccc']);
    expect(s.search({ query: '%' }).map((r) => r.recordId)).toEqual(['run-000c-cccc']);
    expect(s.search({ query: '_' }).map((r) => r.recordId)).toEqual(['run-000d-dddd']);
    expect(s.search({ query: 'C:\\temp' }).map((r) => r.recordId)).toEqual(['run-000e-eeee']);
  });

  it('also looks in translations, notes and titles, and counts them', () => {
    const t = make(A, 1000, ['开会']);
    s.putLeg({ recordId: A, leg: 'speaker', languages: { source: 'zh', target: 'en' } });
    s.putSegments({ recordId: A, leg: 'speaker', segments: [{ id: `${A}:speaker:2`, ref: 1, side: 'translation', text: 'The budget is tight', final: true, openedAt: 5, marks: [] }] });
    s.saveNotes({ recordId: A, transcriptId: t, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'en', state: 'complete',
      body: { title: 'Weekly', overview: { text: 'Budget first.', format: 'plain' }, topics: [], points: [], names: [] } });
    s.renameRecord({ id: A, title: 'Budget sync' });
    expect(s.search({ query: 'budget' })).toEqual([expect.objectContaining({ recordId: A, title: 'Budget sync', hits: 3, first: { kind: 'translation', segmentId: `${A}:speaker:2`, text: 'The budget is tight' } })]);
  });

  it('an empty query finds nothing', () => {
    make(A, 1000, ['anything']);
    expect(s.search({ query: '   ' })).toEqual([]);
  });

  it('leaves binned records out', () => {
    make(A, 1000, ['the plan']);
    make(B, 2000, ['the plan']);
    s.closeRecord({ id: A, endedAt: 5000 });
    s.binRecords({ ids: [A] });
    expect(s.search({ query: 'plan' }).map((r) => r.recordId)).toEqual([B]);
  });

  it('finds a file transcript\u2019s translation, at the sentence that carries it', () => {
    s.openRecord(rec({ id: A, startedAt: 1000 }));
    const t = s.createTranscript({ recordId: A, origin: { service: 'soniox', kind: 'file' } });
    s.appendSentences({ transcriptId: t, sentences: [
      sent(1, 'Hello.', { segmentId: 'file-participant-1', side: 'other', track: 'other', translation: '你好。' }),
      sent(2, 'The budget is tight.', { segmentId: 'file-participant-2', side: 'other', track: 'other', translation: '预算很紧，非常紧。' }),
      sent(3, 'Very tight.', { segmentId: 'file-participant-2', side: 'other', track: 'other' }),
    ] });
    expect(s.search({ query: '预算' })).toEqual([expect.objectContaining({ recordId: A, hits: 1, first: { kind: 'sentence', transcriptId: t, n: 2, text: '预算很紧，非常紧。' } })]);
    // A sentence found by its text and by its translation counts once; the text is what is shown.
    s.appendSentences({ transcriptId: t, sentences: [sent(4, 'Budget again.', { segmentId: 'file-participant-3', side: 'other', track: 'other', translation: 'Budget 再说一次。' })] });
    expect(s.search({ query: 'budget' })).toEqual([expect.objectContaining({ recordId: A, hits: 2, first: { kind: 'sentence', transcriptId: t, n: 2, text: 'The budget is tight.' } })]);
  });

  it('counts a sentence cut from the translation once, not again as its translation segment', () => {
    s.openRecord(rec({ id: A, startedAt: 1000 }));
    s.putLeg({ recordId: A, leg: 'participant', languages: { source: 'ja', target: 'zh' } });
    s.putSegments({ recordId: A, leg: 'participant', segments: [{ id: `${A}:participant:1`, ref: 1, side: 'translation', text: 'see you tomorrow', final: true, openedAt: 5, marks: [] }] });
    const t = s.createTranscript({ recordId: A, origin: { service: 'local_inference', kind: 'live' }, textKind: 'translation' });
    s.appendSentences({ transcriptId: t, sentences: [sent(1, 'see you tomorrow', { segmentId: `${A}:participant:1`, side: 'other', track: 'other' })] });
    expect(s.search({ query: 'tomorrow' })).toEqual([expect.objectContaining({ recordId: A, hits: 1, first: { kind: 'sentence', transcriptId: t, n: 1, text: 'see you tomorrow' } })]);
  });
});

describe('bin, purge and space', () => {
  const sent = (n, text = `s${n}`) => ({ n, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: n * 1000, endMs: n * 1000 + 800, text, timeKind: 'given' });
  const A = 'run-000a-aaaa';
  const B = 'run-000b-bbbb';
  /** A closed record with one sentence. */
  const kept = (id, startedAt = 1000, text = 's1') => {
    s.openRecord(rec({ id, startedAt }));
    const t = s.createTranscript({ recordId: id, origin: { service: 'soniox', kind: 'live' } });
    s.appendSentences({ transcriptId: t, sentences: [sent(1, text)] });
    s.closeRecord({ id, endedAt: startedAt + 5000 });
  };
  const track = (id, source, bytes) => {
    writeFileSync(join(s.recordDir(id), `${source}.ogg`), 'x'.repeat(bytes));
    s.putTrack({ recordId: id, source, file: `${source}.ogg`, format: 'ogg-opus', durationMs: 5000, bytes, offsetMs: 0 });
  };

  it('a binned record leaves the list, shows in the bin and can come back', () => {
    kept(A, 1000); kept(B, 2000);
    expect(s.binRecords({ ids: [A, 'run-0zzz-zzzz'] })).toEqual({ changed: 1 });
    expect(s.listRecords({}).map((r) => r.id)).toEqual([B]);
    expect(s.listRecords({ binned: true }).map((r) => r.id)).toEqual([A]);
    expect(s.restoreRecords({ ids: [A] })).toEqual({ changed: 1 });
    expect(s.listRecords({}).map((r) => r.id).sort()).toEqual([A, B].sort());
  });

  it('purging removes rows and the folder with whatever is in it', () => {
    kept(A, 1000); kept(B, 2000);
    writeFileSync(join(s.recordDir(A), 'mine.ogg'), 'x');
    writeFileSync(join(s.recordDir(A), 'stray.tmp'), 'y');
    s.binRecords({ ids: [A] });
    expect(s.purgeRecords({ ids: [A, B] })).toEqual({ purged: [A], failed: [] });
    expect(existsSync(join(dir, 'records', A))).toBe(false);
    expect(s.getRecord(A)).toBeNull();
    expect(s.getRecord(B)).not.toBeNull();
    expect(existsSync(join(dir, 'history.db'))).toBe(true);
  });

  it('after 30 days in the bin a record is purged, a day earlier it is not', () => {
    expect(BIN_DAYS).toBe(30);
    let clock = 1_000_000;
    s.close();
    s = openHistory({ dir, now: () => clock });
    kept(A);
    s.binRecords({ ids: [A] });
    clock += 29 * 86_400_000;
    expect(s.purgeExpired()).toEqual({ purged: [], failed: [] });
    clock += 1 * 86_400_000;
    expect(s.purgeExpired()).toEqual({ purged: [A], failed: [] });
  });

  // Review: a folder that cannot be removed (a file held open, a folder without write access) must not orphan its audio.
  it('a record whose folder cannot be removed stays in the bin with its audio, and the others are purged', () => {
    kept(A, 1000); kept(B, 2000);
    const held = join(s.recordDir(A), 'mine.ogg');
    writeFileSync(held, 'x');
    const failing = failFor('rmSync', s.recordDir(A), 'EPERM');
    try {
      s.binRecords({ ids: [A, B] });
      expect(s.purgeRecords({ ids: [A, B] })).toEqual({ purged: [B], failed: [A] });
      expect(s.getRecord(A)).toEqual(expect.objectContaining({ binnedAt: expect.any(Number) }));
      expect(existsSync(held)).toBe(true);
    } finally {
      failing.mockRestore();
    }
    expect(s.purgeRecords({ ids: [A] })).toEqual({ purged: [A], failed: [] });
    expect(existsSync(join(dir, 'records', A))).toBe(false);
  });

  it('dropping a track removes the file and keeps the text', () => {
    kept(A);
    track(A, 'microphone', 5);
    expect(s.listRecords({})[0]).toEqual(expect.objectContaining({ hasRecording: true, audioBytes: 5 }));
    s.dropTrack({ recordId: A, source: 'microphone' });
    expect(existsSync(join(dir, 'records', A, 'microphone.ogg'))).toBe(false);
    expect(s.listRecords({})[0]).toEqual(expect.objectContaining({ hasRecording: false, sentences: 1, audioBytes: 0 }));
    expect(s.getRecord(A).tracks).toEqual([expect.objectContaining({ source: 'microphone', goneAt: expect.any(Number) })]);
  });

  it('a track file name cannot leave its record folder', () => {
    kept(A);
    expect(() => s.putTrack({ recordId: A, source: 'microphone', file: '../x.ogg', format: 'ogg-opus', durationMs: 1, bytes: 1, offsetMs: 0 }))
      .toThrow(expect.objectContaining({ code: 'BAD_INPUT' }));
  });

  it('usage adds up what is on disk', () => {
    kept(A, 1000); kept(B, 2000);
    track(A, 'microphone', 100);
    track(A, 'other', 250);
    s.dropTrack({ recordId: A, source: 'other' });
    s.binRecords({ ids: [B] });
    expect(s.usage()).toEqual({ dbBytes: expect.any(Number), audioBytes: 100, records: 2, binned: 1 });
    expect(s.usage().dbBytes).toBeGreaterThan(0);
  });

  it('a record tells how much text it holds', () => {
    s.openRecord(rec({ id: A }));
    s.putLeg({ recordId: A, leg: 'speaker', languages: { source: 'zh', target: 'en' } });
    s.putSegments({ recordId: A, leg: 'speaker', segments: [{ id: `${A}:speaker:1`, ref: 1, side: 'source', text: '你好', final: true, openedAt: 1, marks: [] }] });
    const t = s.createTranscript({ recordId: A, origin: { service: 'soniox', kind: 'live' } });
    s.appendSentences({ transcriptId: t, sentences: [sent(1, 'Hello.')] });
    expect(s.getRecord(A).textBytes).toBe(12);
    // A file transcript's translations count too.
    const file = s.createTranscript({ recordId: A, origin: { service: 'soniox', kind: 'file' } });
    s.appendSentences({ transcriptId: file, sentences: [{ ...sent(1, 'Hi.'), translation: '嗨。' }] });
    expect(s.getRecord(A).textBytes).toBe(12 + 3 + 6);
  });

  it('at launch an empty folder without a record is removed and one with files is only named', () => {
    mkdirSync(join(dir, 'records', 'run-0009-empty'), { recursive: true });
    mkdirSync(join(dir, 'records', 'run-0008-files'), { recursive: true });
    writeFileSync(join(dir, 'records', 'run-0008-files', 'mine.ogg'), 'x');
    kept(A);
    s.recordDir(A);
    expect(s.reconcile()).toEqual({ removedEmpty: ['run-0009-empty'], strays: ['run-0008-files'], tracksGone: 0 });
    expect(existsSync(join(dir, 'records', 'run-0009-empty'))).toBe(false);
    expect(existsSync(join(dir, 'records', 'run-0008-files', 'mine.ogg'))).toBe(true);
    expect(existsSync(join(dir, 'records', A))).toBe(true);
  });

  it('at launch a folder that cannot be read is named and left alone, and the rest is still reconciled', () => {
    const unreadable = join(dir, 'records', 'run-0007-lock');
    mkdirSync(unreadable, { recursive: true });
    mkdirSync(join(dir, 'records', 'run-0009-empty'), { recursive: true });
    const failing = failFor('readdirSync', unreadable, 'EACCES');
    try {
      expect(s.reconcile()).toEqual(expect.objectContaining({ removedEmpty: ['run-0009-empty'], strays: ['run-0007-lock'] }));
    } finally {
      failing.mockRestore();
    }
    expect(existsSync(unreadable)).toBe(true);
  });

  it('at launch a track whose file is gone is marked gone and the text stays', () => {
    kept(A);
    track(A, 'microphone', 5);
    rmSync(join(dir, 'records', A, 'microphone.ogg'));
    expect(s.reconcile()).toEqual(expect.objectContaining({ tracksGone: 1 }));
    expect(s.listRecords({})[0]).toEqual(expect.objectContaining({ hasRecording: false, sentences: 1 }));
  });
});

describe('appending to a track file', () => {
  const piece = (n, fill = 1) => new Uint8Array(n).fill(fill);
  const statSize = (file) => nodeRequire('node:fs').statSync(file).size;

  it('creates the file and its row on the first piece, at the given offset', () => {
    s.openRecord(rec());
    expect(s.appendTrack({ recordId: ID, source: 'speaker', offsetMs: 120, durationMs: 997, data: piece(500) })).toEqual({ bytes: 500 });
    const file = join(s.recordDir(ID), 'speaker.opus');
    expect(statSize(file)).toBe(500);
    expect(s.getRecord(ID).tracks).toEqual([{ source: 'speaker', file: 'speaker.opus', format: 'ogg-opus', durationMs: 997, bytes: 500, offsetMs: 120, goneAt: null }]);
    expect(s.listRecords()[0]).toMatchObject({ hasRecording: true, audioBytes: 500 });
  });

  it('grows the file and the row with each piece, keeping the first offset', () => {
    s.openRecord(rec());
    s.appendTrack({ recordId: ID, source: 'participant', offsetMs: 2000, durationMs: 997, data: piece(300) });
    s.appendTrack({ recordId: ID, source: 'participant', offsetMs: 2000, durationMs: 1997, data: piece(200, 2) });
    const [t] = s.getRecord(ID).tracks;
    expect(t).toMatchObject({ bytes: 500, durationMs: 1997, offsetMs: 2000 });
    expect(statSize(join(s.recordDir(ID), 'participant.opus'))).toBe(500);
    expect(s.usage().audioBytes).toBe(500);
  });

  it('refuses another source, an empty or over-1 MiB piece, and negative times', () => {
    s.openRecord(rec());
    const bad = (a) => expect(() => s.appendTrack({ recordId: ID, source: 'speaker', offsetMs: 0, durationMs: 0, data: piece(1), ...a })).toThrow(expect.objectContaining({ code: 'BAD_INPUT' }));
    bad({ source: 'microphone' });
    bad({ source: '../x' });
    bad({ data: piece(0) });
    bad({ data: piece(1024 * 1024 + 1) });
    bad({ data: 'abc' });
    bad({ offsetMs: -1 });
    bad({ durationMs: -1 });
  });

  it("refuses a piece when the track's file or folder is gone, and does not make a new one", () => {
    s.openRecord(rec());
    s.appendTrack({ recordId: ID, source: 'speaker', offsetMs: 0, durationMs: 997, data: piece(500) });
    const folder = s.recordDir(ID);
    rmSync(folder, { recursive: true, force: true });
    expect(() => s.appendTrack({ recordId: ID, source: 'speaker', offsetMs: 0, durationMs: 1997, data: piece(500) }))
      .toThrow(expect.objectContaining({ code: 'TRACK_GONE' }));
    expect(existsSync(join(folder, 'speaker.opus'))).toBe(false);
  });

  it('refuses a record that is closed', () => {
    s.openRecord(rec());
    s.putSegments({ recordId: ID, leg: 'speaker', segments: [{ id: `${ID}:speaker:1`, ref: 1, side: 'source', text: 'kept', final: true, openedAt: 10, marks: [] }] });
    s.closeRecord({ id: ID, endedAt: 1_800_000_060_000 });
    expect(() => s.appendTrack({ recordId: ID, source: 'speaker', offsetMs: 0, durationMs: 0, data: piece(1) })).toThrow(expect.objectContaining({ code: 'RECORD_CLOSED' }));
  });
});

describe('a track file for the player', () => {
  it('gives the path of a track that is kept, and nothing otherwise', () => {
    s.openRecord(rec());
    s.appendTrack({ recordId: ID, source: 'speaker', offsetMs: 0, durationMs: 20, data: new Uint8Array(3) });
    expect(s.trackFile({ recordId: ID, source: 'speaker' })).toBe(join(s.recordDir(ID), 'speaker.opus'));
    expect(s.trackFile({ recordId: ID, source: 'participant' })).toBeNull();
    expect(s.trackFile({ recordId: 'run-0009-zzzz', source: 'speaker' })).toBeNull();
    expect(s.trackFile({ recordId: '../x', source: 'speaker' })).toBeNull();
    s.dropTrack({ recordId: ID, source: 'speaker' });
    expect(s.trackFile({ recordId: ID, source: 'speaker' })).toBeNull();
  });
});
