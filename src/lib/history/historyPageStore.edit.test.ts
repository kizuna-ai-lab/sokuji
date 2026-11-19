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
