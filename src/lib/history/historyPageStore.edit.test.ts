// The page store's edits of a finished record (owner, 2026-11-19; design draft P0, option C): a misheard word fixed
// everywhere, one sentence edited, and every change undone, against the app's own History store.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVirtualClock, type VirtualClock } from '../contract/clock';
import { createHistoryPageStore } from './historyPageStore';
import { realStorePort, type RealStorePort } from './testing/realStorePort';
import { useWordList } from '../words/list';

const { settingsStored } = vi.hoisted(() => ({ settingsStored: new Map<string, unknown>() }));
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (settingsStored.has(key) ? settingsStored.get(key) : def),
      setSetting: async (key: string, value: unknown) => { settingsStored.set(key, value); return { success: true }; },
    }),
  },
}));

const A = 'run-000a-aaaa';
const B = 'run-000b-bbbb';
const START = 1_800_000_000_000;
const BODY = { title: '周会', overview: { text: '搜库机上线', format: 'plain' }, topics: [], points: [], names: [] };
const sent = (n: number, text: string, over: Record<string, unknown> = {}) => ({
  n, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: n * 1000, endMs: n * 1000 + 800, text, timeKind: 'given', ...over,
});

let real: RealStorePort;
let store: ReturnType<typeof createHistoryPageStore>;
let clock: VirtualClock;

/** A finished record with three sentences (two misheard "Sokuji") and a complete notes version. */
function lay(id: string, finished = true): number {
  const s = real.store;
  s.openRecord({ id, startedAt: START, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
  const t = s.createTranscript({ recordId: id, origin: { service: 'soniox', kind: 'live' } }) as number;
  s.appendSentences({ transcriptId: t, sentences: [
    sent(1, '我们用搜库机开会'), sent(2, '搜库机很快', { side: 'other', track: 'other', speaker: '1.1' }), sent(3, 'Sokuji 已经上线'),
  ] });
  s.saveNotes({ recordId: id, transcriptId: t, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'zh', state: 'complete', body: BODY });
  if (finished) s.closeRecord({ id, endedAt: START + 10_000 });
  return t;
}
const texts = () => store.getState().open!.sentences.map((x) => x.text);

beforeEach(async () => {
  settingsStored.clear();
  useWordList.setState({ entries: [], background: '', loaded: true });
  real = realStorePort();
  lay(A);
  clock = createVirtualClock(0);
  store = createHistoryPageStore(real.port, clock, (e) => `failed: ${(e as Error).message}`);
  await store.getState().openRecord(A);
});
afterEach(() => { real.dispose(); });

describe('fixing a misheard word', () => {
  it('fixes a word everywhere, notes and word list too', async () => {
    expect(await store.getState().fixWords('搜库机', 'Sokuji', { notes: true, words: true })).toBe(2);
    expect(texts()).toEqual(['我们用Sokuji开会', 'Sokuji很快', 'Sokuji 已经上线']);
    expect(store.getState().open!.notes!.body!.overview.text).toBe('Sokuji上线');
    expect(useWordList.getState().entries).toEqual([{ written: 'Sokuji', heardAs: '搜库机' }]);
    expect(store.getState().toast).toMatchObject({ kind: 'fixed', from: '搜库机', to: 'Sokuji', count: 2, words: true });
    expect(store.getState().open!.corrections).toHaveLength(1);
    expect(store.getState().canUndo).toBe(true);
  });

  it('only one place', async () => {
    expect(await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false, only: 2 })).toBe(1);
    expect(texts()).toEqual(['我们用搜库机开会', 'Sokuji很快', 'Sokuji 已经上线']);
    expect(store.getState().open!.notes!.body!.overview.text).toBe('搜库机上线');
  });

  it('undo takes a fix back without a trace', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: true, words: true });
    await store.getState().undo();
    expect(texts()).toEqual(['我们用搜库机开会', '搜库机很快', 'Sokuji 已经上线']);
    expect(store.getState().open!.notes!.body!.overview.text).toBe('搜库机上线');
    expect(useWordList.getState().entries).toEqual([]);
    expect(store.getState().open!.corrections).toEqual([]);
    expect(store.getState().toast).toMatchObject({ kind: 'undone' });
    expect(store.getState().canUndo).toBe(false);
  });

  it('revert keeps the row', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false });
    const id = store.getState().open!.corrections[0].id;
    await store.getState().revertCorrection(id);
    expect(texts()).toEqual(['我们用搜库机开会', '搜库机很快', 'Sokuji 已经上线']);
    expect(store.getState().open!.corrections[0].revertedAt).toEqual(expect.any(Number));
    expect(store.getState().toast).toMatchObject({ kind: 'reverted', from: '搜库机', to: 'Sokuji', count: 2, kept: 0 });
  });

  // Final review I-7: the record's title, the notes' title copied, is fixed with the notes, in the list too.
  it('fixes the record title with the notes, in the list too', async () => {
    const t = (real.store.getRecord(A) as { transcripts: Array<{ id: number }> }).transcripts[0].id;
    real.store.saveNotes({ recordId: A, transcriptId: t, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'zh', state: 'complete', body: { ...BODY, title: '搜库机周会' } });
    await store.getState().load();
    await store.getState().openRecord(A);
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: true, words: false });
    expect(store.getState().open!.record.title).toBe('Sokuji周会');
    expect(store.getState().rows.find((r) => r.id === A)?.title).toBe('Sokuji周会');
    await store.getState().undo();
    expect(store.getState().rows.find((r) => r.id === A)?.title).toBe('搜库机周会');
  });

  // Final review I-2: a place already written right is not a place to fix.
  it('does not count a place already written right', async () => {
    expect(await store.getState().fixWords('搜库', '搜库机', { notes: true, words: false })).toBe(0);
    expect(texts()).toEqual(['我们用搜库机开会', '搜库机很快', 'Sokuji 已经上线']);
    expect(store.getState().open!.corrections).toEqual([]);
  });

  // Final review M-8: the word list is read before a fix adds to it, so a list not yet loaded is not written over.
  it('reads the word list before adding to it', async () => {
    settingsStored.set('settings.words', { version: 1, entries: [{ written: 'Palabra' }] });
    useWordList.setState({ entries: [], loaded: false });
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: true });
    expect(useWordList.getState().entries).toEqual([{ written: 'Palabra' }, { written: 'Sokuji', heardAs: '搜库机' }]);
  });

  // Owner, 2026-11-19: no fix to an empty word (deleting a word goes through editing its sentence).
  it('no fix to nothing, nor to the same word', async () => {
    expect(await store.getState().fixWords('搜库机', '  ', { notes: true, words: true })).toBe(0);
    expect(await store.getState().fixWords('搜库机', '搜库机', { notes: true, words: true })).toBe(0);
    expect(texts()[0]).toBe('我们用搜库机开会');
  });

  // Review focus: nothing is written on a record still running, or while it is transcribed again.
  it('no fix while live or transcribing', async () => {
    lay(B, false);
    await store.getState().openRecord(B);
    expect(store.getState().canEdit()).toBe(false);
    expect(await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false })).toBe(0);
    expect(texts()[0]).toBe('我们用搜库机开会');
    await store.getState().openRecord(A);
    store.setState({ job: { kind: 'transcribe', recordId: A, name: null, phase: 'uploading' } as never });
    expect(store.getState().canEdit()).toBe(false);
    expect(await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false })).toBe(0);
  });
});

describe('editing a sentence', () => {
  it('edits one sentence, everywhere when it is a swap', async () => {
    await store.getState().editSentence(1, '我们用Sokuji开会', { everywhere: true, words: false });
    expect(texts()).toEqual(['我们用Sokuji开会', 'Sokuji很快', 'Sokuji 已经上线']);
    await store.getState().editSentence(3, 'Sokuji 已上线', { everywhere: true, words: true });
    expect(texts()[2]).toBe('Sokuji 已上线');
    expect(useWordList.getState().entries).toEqual([]);
    expect(store.getState().toast).toMatchObject({ kind: 'edited' });
  });

  it('restores a sentence', async () => {
    await store.getState().editSentence(1, '我们开会', { everywhere: false, words: false });
    expect(store.getState().open!.sentences[0].heard).toBe('我们用搜库机开会');
    await store.getState().restoreSentence(1);
    expect(store.getState().open!.sentences[0]).toMatchObject({ text: '我们用搜库机开会', heard: null });
    expect(store.getState().toast).toMatchObject({ kind: 'restored' });
  });
});

// PR review (2026-11-19): undo of a revert, the word list, and edits that end late.
describe('undo, after review', () => {
  const tid = () => store.getState().open!.transcriptId!;

  it('undo of a revert writes back only what the revert restored', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false });
    await store.getState().editSentence(2, '搜库机很快很快', { everywhere: false, words: false });
    await store.getState().revertCorrection(store.getState().open!.corrections[0].id);
    expect(texts()).toEqual(['我们用搜库机开会', '搜库机很快很快', 'Sokuji 已经上线']);
    await store.getState().undo();
    expect(texts()).toEqual(['我们用Sokuji开会', '搜库机很快很快', 'Sokuji 已经上线']);
  });

  it('undo of a revert puts back the notes version it changed, shown or not', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: true, words: false });
    const first = store.getState().open!.notes!.id;
    const second = real.store.saveNotes({ recordId: A, transcriptId: tid(), writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'zh', state: 'complete', body: { ...BODY, overview: { text: '第二版', format: 'plain' } } }) as number;
    await store.getState().showNotes(second);
    await store.getState().revertCorrection(store.getState().open!.corrections[0].id);
    expect((await real.port.getNotes({ id: first }))!.body!.overview.text).toBe('搜库机上线');
    await store.getState().undo();
    expect((await real.port.getNotes({ id: first }))!.body!.overview.text).toBe('Sokuji上线');
    expect(store.getState().open!.notes!.id).toBe(second);
  });

  it('undo takes out only the entry the fix changed, as the fix left it', async () => {
    useWordList.setState({ entries: [{ written: 'Sokuji', translation: '即刻' }, { written: 'Sokuji', translation: '速记' }] });
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: true });
    await store.getState().undo();
    expect(useWordList.getState().entries).toEqual([{ written: 'Sokuji', translation: '即刻' }, { written: 'Sokuji', translation: '速记' }]);
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: true });
    const changed = useWordList.getState().entries.map((e, i) => (i === 0 ? { ...e, translation: '即时' } : e));
    await useWordList.getState().setEntries(changed);
    await store.getState().undo();
    expect(useWordList.getState().entries).toEqual(changed);
  });

  it('a fix is kept, and can be undone, when the word list cannot be read', async () => {
    useWordList.setState({ entries: [], loaded: false });
    vi.spyOn(useWordList.getState(), 'load').mockRejectedValueOnce(new Error('disk'));
    expect(await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: true })).toBe(2);
    expect(store.getState().open!.corrections).toHaveLength(1);
    expect(store.getState().toast).toMatchObject({ kind: 'fixed', words: false });
    expect(store.getState().canUndo).toBe(true);
  });

  it('an edit that ends after another record is shown leaves that record alone', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const write = real.port.editSentences;
    real.port.editSentences = async (a) => { await gate; return write(a); };
    const pending = store.getState().editSentence(3, 'Sokuji 已上线', { everywhere: false, words: false });
    lay(B);
    await store.getState().openRecord(B);
    release();
    await pending;
    expect(store.getState().open!.record.id).toBe(B);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().toast).toBeNull();
  });

  // PR review: a revert whose re-read ends after another record is shown records nothing for that record.
  it('a revert read back after another record is shown leaves that record alone', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false });
    const id = store.getState().open!.corrections[0].id;
    let entered!: () => void;
    const inRead = new Promise<void>((r) => { entered = r; });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let armed = true;
    const read = real.port.getSentences;
    real.port.getSentences = async (a) => { if (armed) { armed = false; entered(); await gate; } return read(a); };
    const pending = store.getState().revertCorrection(id);
    await inRead;
    lay(B);
    await store.getState().openRecord(B);
    release();
    await pending;
    expect(store.getState().open!.record.id).toBe(B);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().toast).toBeNull();
  });

  it('an undo that failed can be tried again', async () => {
    await store.getState().editSentence(3, 'Sokuji 已上线', { everywhere: false, words: false });
    const write = real.port.editSentences;
    real.port.editSentences = async () => { real.port.editSentences = write; throw new Error('busy'); };
    await store.getState().undo();
    expect(store.getState().error).toBe('failed: busy');
    expect(store.getState().canUndo).toBe(true);
    await store.getState().undo();
    expect(texts()[2]).toBe('Sokuji 已经上线');
  });

  // An undo whose fix is taken back is done, even when the word list then fails: it is not taken back twice.
  it('an undo whose word list fails is still done once', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: true });
    vi.spyOn(useWordList.getState(), 'setEntries').mockRejectedValueOnce(new Error('disk'));
    await store.getState().undo();
    expect(texts()).toEqual(['我们用搜库机开会', '搜库机很快', 'Sokuji 已经上线']);
    expect(store.getState().error).toBe('failed: disk');
    expect(store.getState().canUndo).toBe(false);
  });

  it('no undo while the record is transcribed again', async () => {
    await store.getState().editSentence(3, 'Sokuji 已上线', { everywhere: false, words: false });
    store.setState({ job: { kind: 'transcribe', recordId: A, name: null, phase: 'uploading' } as never });
    await store.getState().undo();
    expect(texts()[2]).toBe('Sokuji 已上线');
    expect(store.getState().canUndo).toBe(true);
  });
});

describe('undo', () => {
  // Review focus: an undo never reaches a record other than the one shown.
  it('the undo steps are this record\'s only', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false });
    lay(B);
    await store.getState().openRecord(B);
    expect(store.getState().canUndo).toBe(false);
    await store.getState().undo();
    expect(texts()[0]).toBe('我们用搜库机开会');
    await store.getState().openRecord(A);
    expect(texts()[0]).toBe('我们用Sokuji开会');
  });

  // Final review I-1: the "Reverted" line has Undo too; it brings the fix back, and leaves earlier changes alone.
  it('undo right after a revert brings the fix back', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: true, words: true });
    await store.getState().renameSpeaker('other', '1.1', 'Mina');
    await store.getState().revertCorrection(store.getState().open!.corrections[0].id);
    expect(texts()[0]).toBe('我们用搜库机开会');
    await store.getState().undo();
    expect(texts()).toEqual(['我们用Sokuji开会', 'Sokuji很快', 'Sokuji 已经上线']);
    expect(store.getState().open!.notes!.body!.overview.text).toBe('Sokuji上线');
    expect(store.getState().open!.corrections.filter((c) => c.revertedAt === null)).toHaveLength(1);
    expect(store.getState().open!.speakers.find((x) => x.speaker === '1.1')?.name).toBe('Mina');
    expect(useWordList.getState().entries).toEqual([{ written: 'Sokuji', heardAs: '搜库机' }]);
  });

  // The fix brought back by undoing its revert is the one the next undo takes back: nothing is left listed.
  it('undo, then undo again, after a revert takes the fix back without a trace', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: true, words: true });
    await store.getState().revertCorrection(store.getState().open!.corrections[0].id);
    await store.getState().undo();
    await store.getState().undo();
    expect(texts()).toEqual(['我们用搜库机开会', '搜库机很快', 'Sokuji 已经上线']);
    expect(store.getState().open!.notes!.body!.overview.text).toBe('搜库机上线');
    expect(store.getState().open!.corrections.filter((c) => c.revertedAt === null)).toEqual([]);
    expect(useWordList.getState().entries).toEqual([]);
  });

  // Final review M-8: undo takes out what the fix added to the word list, and nothing added since.
  it('undo takes out only what the fix added to the word list', async () => {
    useWordList.setState({ entries: [{ written: 'Sokuji', heardAs: '搜酷鸡' }] });
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: true });
    expect(useWordList.getState().entries).toEqual([{ written: 'Sokuji', heardAs: '搜酷鸡, 搜库机' }]);
    await useWordList.getState().setEntries([...useWordList.getState().entries, { written: 'Palabra' }]);
    await store.getState().undo();
    expect(useWordList.getState().entries).toEqual([{ written: 'Sokuji', heardAs: '搜酷鸡' }, { written: 'Palabra' }]);
  });

  it('keeps 20 steps', async () => {
    for (let i = 1; i <= 21; i += 1) await store.getState().editSentence(3, `Sokuji 第 ${i} 版`, { everywhere: false, words: false });
    for (let i = 0; i < 21; i += 1) await store.getState().undo();
    expect(texts()[2]).toBe('Sokuji 第 1 版');
    expect(store.getState().canUndo).toBe(false);
  });

  it('undoes a speaker renamed or a sentence moved', async () => {
    await store.getState().renameSpeaker('other', '1.1', 'Mina');
    expect(store.getState().toast).toMatchObject({ kind: 'speaker' });
    await store.getState().undo();
    expect(store.getState().open!.speakers.find((x) => x.speaker === '1.1')?.name).toBeNull();
    await store.getState().reassign(2, 'u1');
    expect(store.getState().open!.sentences[1].speakerByUser).toBe('u1');
    await store.getState().undo();
    expect(store.getState().open!.sentences[1].speakerByUser).toBeNull();
  });

  it('the toast goes after 6 s', async () => {
    await store.getState().editSentence(3, 'Sokuji 已上线', { everywhere: false, words: false });
    expect(store.getState().toast).not.toBeNull();
    clock.advance(5999);
    expect(store.getState().toast).not.toBeNull();
    clock.advance(1);
    expect(store.getState().toast).toBeNull();
  });
});

// Option C: a word is handed to the fix; handing it over changes nothing.
describe('handing a word to the fix', () => {
  it('openFix hands a word over and changes nothing', () => {
    store.getState().openFix({ heard: '佐藤米崎', suggestion: '佐藤美咲', source: 'notes' });
    expect(store.getState().fixDraft).toEqual({ seq: 1, heard: '佐藤米崎', suggestion: '佐藤美咲', only: null, source: 'notes' });
    expect(texts()[0]).toBe('我们用搜库机开会');
    store.getState().openFix({ heard: '搜库机', only: 2, source: 'selection' });
    expect(store.getState().fixDraft).toMatchObject({ seq: 2, suggestion: null, only: 2 });
    store.getState().clearFixDraft();
    expect(store.getState().fixDraft).toBeNull();
  });
});

// Design P1 §1: the notes edited in place, marked "edited by hand", and every change undone with the mark as it was.
describe('editing the notes', () => {
  const RICH = {
    title: '周会', overview: { text: '搜库机上线', format: 'plain' },
    topics: [{ title: '上线', summary: '下周三。', first: 1 }],
    points: [{ topic: 0, text: '写发布说明', sentences: [1], kinds: ['todo'], owner: 'My side', due: 'Friday' }],
    names: [{ written: '搜库机', likely: 'Sokuji', sentences: [1] }],
  };
  const notes = () => store.getState().open!.notes!;
  beforeEach(async () => {
    const t = store.getState().open!.transcriptId!;
    real.store.saveNotes({ recordId: A, transcriptId: t, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'zh', state: 'complete', body: RICH });
    await store.getState().openRecord(A);
    clock.advance(1000);
  });

  it('writes the version shown, marks it, says so, and reads it again', async () => {
    expect(notes().body!.points).toHaveLength(1);
    await store.getState().editNotes({ field: { part: 'overview' }, text: 'Sokuji 上线了' });
    expect(notes().body!.overview.text).toBe('Sokuji 上线了');
    expect(notes().editedAt).toBe(1000);
    expect(store.getState().toast).toMatchObject({ kind: 'notesEdited' });
    expect(store.getState().canUndo).toBe(true);
    await store.getState().editNotes({ field: { part: 'point', point: 0 }, text: '' });
    expect(notes().body!.points).toEqual([]);
    expect(store.getState().toast).toMatchObject({ kind: 'notesRemoved' });
  });

  it('editing the notes title renames the record when it followed them', async () => {
    await store.getState().load();
    await store.getState().editNotes({ field: { part: 'title' }, text: '上线周会' });
    expect(store.getState().open!.record.title).toBe('上线周会');
    expect(store.getState().rows.find((r) => r.id === A)!.title).toBe('上线周会');
  });

  it('undo puts back the text and the mark as it was', async () => {
    await store.getState().editNotes({ field: { part: 'overview' }, text: '新的' });
    await store.getState().undo();
    expect(notes().body!.overview.text).toBe('搜库机上线');
    expect(notes().editedAt).toBeNull();
    expect(store.getState().toast).toMatchObject({ kind: 'undone' });
  });

  it('undo still restores the field after a name was dismissed', async () => {
    await store.getState().editNotes({ field: { part: 'point', point: 0 }, text: '写发布说明和公告', owner: 'Ana', due: '' });
    await store.getState().dismissName(0);
    await store.getState().undo();
    expect(notes().body!.points[0]).toMatchObject({ text: '写发布说明', owner: 'My side', due: 'Friday' });
    expect(notes().body!.names[0]).toMatchObject({ dismissed: true });
  });

  it('undo of a field changed since leaves it and says so', async () => {
    await store.getState().editNotes({ field: { part: 'overview' }, text: '第一次' });
    const shown = notes();
    real.store.editNotes({ id: shown.id, before: JSON.stringify(shown.body), after: JSON.stringify({ ...shown.body, overview: { text: '别处改的', format: 'plain' } }), editedAt: 5 });
    await store.getState().undo();
    await store.getState().refreshRecord();
    expect(notes().body!.overview.text).toBe('别处改的');
    expect(store.getState().toast).toMatchObject({ kind: 'undoKept' });
    expect(store.getState().canUndo).toBe(false);
  });

  it('nothing is edited while a version is being written, the record is open, or it is transcribed again', async () => {
    expect(store.getState().canEditNotes()).toBe(true);
    store.setState({ notesRunning: [A] });
    expect(store.getState().canEditNotes()).toBe(false);
    await store.getState().editNotes({ field: { part: 'overview' }, text: '不该写进去' });
    expect((real.store.getNotes({ id: notes().id }) as { body: { overview: { text: string } } }).body.overview.text).toBe('搜库机上线');
    store.setState({ notesRunning: [] });
    store.setState({ job: { kind: 'transcribe', recordId: A } as never });
    expect(store.getState().canEditNotes()).toBe(false);
    store.setState({ job: null });
    lay(B, false);
    await store.getState().openRecord(B);
    expect(store.getState().canEditNotes()).toBe(false);
  });

  it('a word fix that changes the notes marks them; its undo takes the mark back', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: true, words: false });
    expect(notes().editedAt).toBe(1000);
    await store.getState().undo();
    expect(notes().editedAt).toBeNull();
  });

  it('a fix reverted from the list marks its notes; undoing the revert puts the earlier mark back', async () => {
    await store.getState().fixWords('搜库机', 'Sokuji', { notes: true, words: false });
    clock.advance(500);
    await store.getState().revertCorrection(store.getState().open!.corrections[0].id);
    expect(notes()).toMatchObject({ editedAt: 1500 });
    expect(notes().body!.overview.text).toBe('搜库机上线');
    await store.getState().undo();
    expect(notes()).toMatchObject({ editedAt: 1000 });
    expect(notes().body!.overview.text).toBe('Sokuji上线');
  });
});

// Design P1 §2: one speaker's sentences all moved to another of the same side, in one write; undo puts each back.
describe('merging speakers', () => {
  const C = 'run-000c-cccc';
  let t: number;
  const other = (n: number, speaker: string, text: string) => sent(n, text, { side: 'other', track: 'other', speaker });
  const who = () => store.getState().open!.sentences.map((x) => [x.n, x.speakerByUser ?? x.speaker]);
  beforeEach(async () => {
    const s = real.store;
    s.openRecord({ id: C, startedAt: START, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
    t = s.createTranscript({ recordId: C, origin: { service: 'soniox', kind: 'live' } }) as number;
    s.appendSentences({ transcriptId: t, sentences: [
      sent(1, '我先说'), other(2, '1.1', '好的'), other(3, '1.2', '我补充'), other(4, '1.2', '还有一点'), other(5, '1.1', '这句其实是她说的'),
    ] });
    s.reassignSentence({ transcriptId: t, n: 5, speaker: '1.2' });
    s.reassignSentence({ transcriptId: t, n: 4, speaker: 'u1' });
    s.reassignSentence({ transcriptId: t, n: 4, speaker: '1.2' });
    s.closeRecord({ id: C, endedAt: START + 10_000 });
    await store.getState().openRecord(C);
  });

  it('moves every sentence of the speaker in one write, and says how many', async () => {
    const spy = vi.spyOn(real.port, 'reassignSentences');
    expect(await store.getState().mergeSpeaker('other', '1.2', '1.1', { from: '对方 2', into: '对方 1' })).toBe(3);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(who()).toEqual([[1, '1'], [2, '1.1'], [3, '1.1'], [4, '1.1'], [5, '1.1']]);
    expect(store.getState().toast).toMatchObject({ kind: 'merged', from: '对方 2', into: '对方 1', count: 3 });
    expect(store.getState().canUndo).toBe(true);
  });

  it('undo puts each sentence back to its own speaker, set by hand or not', async () => {
    const before = store.getState().open!.sentences.map((x) => [x.n, x.speakerByUser]);
    await store.getState().mergeSpeaker('other', '1.2', '1.1', { from: 'a', into: 'b' });
    await store.getState().undo();
    expect(store.getState().open!.sentences.map((x) => [x.n, x.speakerByUser])).toEqual(before);
  });

  it('a name given to the merged speaker comes back with the undo', async () => {
    await store.getState().renameSpeaker('other', '1.2', 'Ana');
    await store.getState().mergeSpeaker('other', '1.2', '1.1', { from: 'Ana', into: '对方 1' });
    expect(store.getState().open!.speakers.find((x) => x.side === 'other' && x.speaker === '1.2')?.sentences ?? 0).toBe(0);
    await store.getState().undo();
    expect(store.getState().open!.speakers.find((x) => x.side === 'other' && x.speaker === '1.2')).toMatchObject({ name: 'Ana', sentences: 3 });
  });

  it('only within one side, never a speaker into itself, and only in a finished record', async () => {
    expect(await store.getState().mergeSpeaker('mine', '1.2', '1', { from: 'a', into: 'b' })).toBe(0);
    expect(await store.getState().mergeSpeaker('other', '1.1', '1.1', { from: 'a', into: 'a' })).toBe(0);
    expect(store.getState().canUndo).toBe(false);
    lay(B, false);
    await store.getState().openRecord(B);
    expect(await store.getState().mergeSpeaker('other', '1.1', '9', { from: 'a', into: 'b' })).toBe(0);
  });
});
