// Editing a finished record on its page (design draft P0, option C), on the app's own History store: the toast with
// Undo, Ctrl/⌘+Z, and a word handed to the edit panel opening it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import { createVirtualClock } from '../../lib/contract/clock';
import { createHistoryPageStore } from '../../lib/history/historyPageStore';
import { realStorePort, type RealStorePort } from '../../lib/history/testing/realStorePort';
import { useWordList } from '../../lib/words/list';
import '../../locales';
import { HistoryPageContext } from './historyContext';
import RecordPage from './RecordPage';

const { settingsStored } = vi.hoisted(() => ({ settingsStored: new Map<string, unknown>() }));
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (settingsStored.has(key) ? settingsStored.get(key) : def),
      setSetting: async (key: string, value: unknown) => { settingsStored.set(key, value); return { success: true }; },
    }),
  },
}));

const A = 'run-0001-aaaa';
const START = new Date(2026, 0, 15, 9, 0, 0).getTime();
const sent = (n: number, text: string) => ({ n, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: n * 1000, endMs: n * 1000 + 800, text, timeKind: 'given' });

let real: RealStorePort;
let store: ReturnType<typeof createHistoryPageStore>;
const settle = () => act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
const textOf = (n: number) => document.querySelector(`[data-n="${n}"]`)?.textContent ?? '';
const panel = () => screen.queryByRole('complementary', { name: 'Edit' });

async function show(id = A) {
  await store.getState().openRecord(id);
  render(
    <HistoryPageContext.Provider value={{ store, onClose: () => {} }}>
      <RecordPage />
    </HistoryPageContext.Provider>,
  );
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  settingsStored.clear();
  useWordList.setState({ entries: [], background: '', loaded: true });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly cb: () => void) {}
    observe() { this.cb(); }
    unobserve() {}
    disconnect() {}
  });
  real = realStorePort();
  const s = real.store;
  s.openRecord({ id: A, startedAt: START, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
  const t = s.createTranscript({ recordId: A, origin: { service: 'soniox', kind: 'live' } });
  s.appendSentences({ transcriptId: t, sentences: [
    sent(1, '我们用搜库机开会'), sent(2, '搜库机很快'), sent(3, 'Sokuji 已经上线'), sent(4, '这是一句很长很长的话，长到选中它整句的时候已经超过了四十个字，不该给出改正的按钮。'),
    sent(5, '搜库上线'),
  ] });
  s.closeRecord({ id: A, endedAt: START + 10_000 });
  store = createHistoryPageStore(real.port, createVirtualClock(0), (e) => `failed: ${(e as Error).message}`);
});
afterEach(() => { cleanup(); real.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the toast and undo', () => {
  it('the toast says what changed and undoes it', async () => {
    await show();
    await act(async () => { await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: true }); });
    await settle();
    const toast = screen.getByRole('status', { name: 'What changed' });
    expect(toast).toHaveTextContent('Changed 2 places: 搜库机 → Sokuji, added to the word list');
    expect(textOf(1)).toContain('Sokuji');
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await settle();
    expect(textOf(1)).toContain('搜库机');
  });

  // PR review: no undo while the record is transcribed again, so the line offers none.
  it('no Undo on the line while the record is transcribed again', async () => {
    await show();
    await act(async () => { await store.getState().editSentence(3, 'Sokuji 已上线', { everywhere: false, words: false }); });
    await settle();
    act(() => store.setState({ job: { kind: 'transcribe', recordId: A, name: null, phase: 'uploading' } as never }));
    expect(within(screen.getByRole('status', { name: 'What changed' })).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('Ctrl+Z, or ⌘Z, undoes the last edit', async () => {
    await show();
    await act(async () => { await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false }); });
    await settle();
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await settle();
    expect(textOf(1)).toContain('搜库机');
    await act(async () => { await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false }); });
    await settle();
    fireEvent.keyDown(document, { key: 'z', metaKey: true });
    await settle();
    expect(textOf(2)).toContain('搜库机');
  });

  // Review focus: Ctrl+Z while typing is the field's own undo.
  it('Ctrl+Z in a field is the field\'s', async () => {
    await show();
    await act(async () => { await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false }); });
    await settle();
    const undo = vi.spyOn(store.getState(), 'undo');
    const field = screen.getByRole('textbox', { name: 'Heard as' });
    field.focus();
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
    await settle();
    expect(undo).not.toHaveBeenCalled();
    expect(textOf(1)).toContain('Sokuji');
  });
});

// Option C: a word handed over opens the edit panel, wherever it was.
describe('a word handed to the fix', () => {
  it('opens the edit panel switched off, and fills its part', async () => {
    localStorage.setItem('history.sidePanelClosed', '1');
    await show();
    expect(panel()).toBeNull();
    act(() => store.getState().openFix({ heard: '搜库机', suggestion: 'Sokuji', source: 'notes' }));
    await settle();
    expect(panel()).not.toBeNull();
    expect((within(panel()!).getByRole('textbox', { name: 'Heard as' }) as HTMLInputElement).value).toBe('搜库机');
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true');
  });
});

// Option C: the notes' names hand their word over; one fixed elsewhere shows "Fixed" (owner, 2026-11-19).
// PR review: on a narrow page "Show each" is used from the Edit tab; a place shown goes to the Transcript tab.
describe('fixing words on a narrow page', () => {
  it('a place shown from the Edit tab opens the Transcript tab', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
    await show();
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    const part = screen.getByRole('region', { name: 'Fix words' });
    fireEvent.change(within(part).getByRole('textbox', { name: 'Heard as' }), { target: { value: '搜库机' } });
    fireEvent.click(within(part).getByRole('button', { name: 'Show each' }));
    fireEvent.click(within(part).getAllByRole('button', { name: /^0:0/ })[0]);
    await settle();
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the notes\' names to check', () => {
  const withNames = (names: Array<Record<string, unknown>>) => {
    const t = real.store.getRecord(A) as { transcripts: Array<{ id: number }> };
    real.store.saveNotes({ recordId: A, transcriptId: t.transcripts[0].id, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'zh', state: 'complete',
      body: { title: '周会', overview: { text: '上线', format: 'plain' }, topics: [], points: [], names } });
  };
  const names = () => screen.getByRole('region', { name: 'Names to check' });

  it('Go fix hands the name to the edit panel, with its suggestion', async () => {
    withNames([{ written: '搜库机', likely: 'Sokuji', sentences: [1] }, { written: 'Mr Kawase', likely: null, sentences: [2] }]);
    await show();
    fireEvent.click(within(names()).getAllByRole('button', { name: 'Go fix' })[0]);
    await settle();
    const part = screen.getByRole('region', { name: 'Fix words' });
    expect((within(part).getByRole('textbox', { name: 'Heard as' }) as HTMLInputElement).value).toBe('搜库机');
    expect((within(part).getByRole('textbox', { name: 'Change to' }) as HTMLInputElement).value).toBe('Sokuji');
    expect(within(part).getByText('From the notes’ names to check')).toBeInTheDocument();
    expect(textOf(1)).toContain('搜库机');
    fireEvent.click(within(names()).getAllByRole('button', { name: 'Go fix' })[1]);
    await settle();
    expect((within(part).getByRole('textbox', { name: 'Change to' }) as HTMLInputElement).value).toBe('');
  });

  it('a name fixed elsewhere shows Fixed; one never seen as written keeps Go fix', async () => {
    withNames([{ written: '搜库机', likely: 'Sokuji', sentences: [1] }, { written: '苏库吉', likely: 'Sokuji', sentences: [2] }]);
    await show();
    await act(async () => { await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false }); });
    await settle();
    const [fixed, unseen] = within(names()).getAllByRole('listitem');
    expect(fixed).toHaveTextContent('Fixed');
    expect(within(unseen).getByRole('button', { name: 'Go fix' })).toBeInTheDocument();
  });

  // PR review: no "Go fix" where words cannot be fixed (the record is being transcribed again).
  it('no Go fix while the record is transcribed again', async () => {
    withNames([{ written: '搜库机', likely: 'Sokuji', sentences: [1] }]);
    await show();
    act(() => store.setState({ job: { kind: 'transcribe', recordId: A, name: null, phase: 'uploading' } as never }));
    await settle();
    expect(within(names()).queryByRole('button', { name: 'Go fix' })).toBeNull();
    expect(within(names()).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  // Final review I-2: a name whose right form holds it ("搜库" → "搜库机") is Fixed once only the right form is left.
  it('a name inside its right form shows Fixed once fixed', async () => {
    withNames([{ written: '搜库', likely: '搜库机', sentences: [5] }]);
    await show();
    expect(within(names()).getByRole('button', { name: 'Go fix' })).toBeInTheDocument();
    await act(async () => { await store.getState().fixWords('搜库', '搜库机', { notes: false, words: false }); });
    expect(textOf(5)).toContain('搜库机上线');
    await settle();
    expect(within(names()).getByRole('listitem')).toHaveTextContent('Fixed');
  });
});

// Option C: a word selected in one sentence of the transcript is handed to "Fix words", where it may be fixed alone.
describe('a word selected in the transcript', () => {
  const select = (from: [number, number], to: [number, number]) => {
    const node = (n: number) => [...document.querySelector(`[data-n="${n}"]`)!.childNodes].find((c) => c.nodeType === Node.TEXT_NODE)!;
    const r = document.createRange();
    r.setStart(node(from[0]), from[1]);
    r.setEnd(node(to[0]), to[1]);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
  };
  const fixButton = () => screen.queryByRole('button', { name: 'Fix…' });

  it('a word selected in one sentence offers Fix…, which hands it over', async () => {
    await show();
    select([2, 0], [2, 3]);
    fireEvent.click(fixButton()!);
    await settle();
    const part = screen.getByRole('region', { name: 'Fix words' });
    expect((within(part).getByRole('textbox', { name: 'Heard as' }) as HTMLInputElement).value).toBe('搜库机');
    expect(within(part).getByRole('radio', { name: 'Only the selected one' })).toBeInTheDocument();
    expect(fixButton()).toBeNull();
  });

  it('no Fix… for a selection across sentences, of spaces only, or longer than 40 characters', async () => {
    await show();
    select([1, 3], [2, 2]);
    expect(fixButton()).toBeNull();
    select([3, 6], [3, 7]);
    expect(fixButton()).toBeNull();
    select([4, 0], [4, 41]);
    expect(fixButton()).toBeNull();
    select([3, 0], [3, 6]);
    expect(fixButton()).not.toBeNull();
  });

  it('no Fix… on a live record', async () => {
    const B = 'run-0002-bbbb';
    real.store.openRecord({ id: B, startedAt: START, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
    const t = real.store.createTranscript({ recordId: B, origin: { service: 'soniox', kind: 'live' } });
    real.store.appendSentences({ transcriptId: t, sentences: [sent(1, '搜库机很快')] });
    await show(B);
    select([1, 0], [1, 3]);
    expect(fixButton()).toBeNull();
  });
});

// Design draft P0 §3.4–3.5: one sentence edited in place; a one-word swap seen elsewhere may be made everywhere; an
// edited sentence is marked and can go back to what was heard.
describe('editing one sentence', () => {
  const editButton = (n: number) => within(document.querySelector(`[data-n="${n}"]`) as HTMLElement).queryByRole('button', { name: 'Edit this sentence' });
  const field = () => screen.getByRole('textbox', { name: 'Sentence' }) as HTMLTextAreaElement;

  it('edits a sentence in place: Enter saves, Shift+Enter is a new line, Escape cancels, a click elsewhere saves', async () => {
    await show();
    const edit = vi.spyOn(store.getState(), 'editSentence');
    fireEvent.click(editButton(3)!);
    expect(field().value).toBe('Sokuji 已经上线');
    fireEvent.change(field(), { target: { value: 'Sokuji 已上线' } });
    fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true });
    expect(edit).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'Enter' });
    await settle();
    expect(edit).toHaveBeenCalledWith(3, 'Sokuji 已上线', { everywhere: false, words: false });
    fireEvent.click(editButton(3)!);
    fireEvent.change(field(), { target: { value: '不要这个' } });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Sentence' })).toBeNull();
    expect(edit).toHaveBeenCalledTimes(1);
    fireEvent.click(editButton(3)!);
    fireEvent.change(field(), { target: { value: 'Sokuji 上线了' } });
    fireEvent.blur(field());
    await settle();
    expect(edit).toHaveBeenLastCalledWith(3, 'Sokuji 上线了', { everywhere: false, words: false });
  });

  it('offers everywhere for a one-word swap seen elsewhere', async () => {
    await show();
    const edit = vi.spyOn(store.getState(), 'editSentence');
    fireEvent.click(editButton(1)!);
    fireEvent.change(field(), { target: { value: '我们用Sokuji开会' } });
    expect(screen.getByText('Heard as 搜库机 · 1 more place')).toBeInTheDocument();
    const editor = document.querySelector('.record-sentence-edit') as HTMLElement;
    expect(within(editor).getByRole('radio', { name: 'Change everywhere' })).toBeChecked();
    expect(within(editor).getByRole('checkbox', { name: 'Add to the word list' })).toBeChecked();
    fireEvent.keyDown(field(), { key: 'Enter' });
    await settle();
    expect(edit).toHaveBeenCalledWith(1, '我们用Sokuji开会', { everywhere: true, words: true });
  });

  // Final review I-5: once the editor's own choices have the focus, a click elsewhere still saves, and Escape still
  // cancels the edit only (the page does not take it as a way back).
  it('the editor keeps its exits when its choices have the focus', async () => {
    await show();
    const edit = vi.spyOn(store.getState(), 'editSentence');
    const pageKeys = vi.fn();
    document.addEventListener('keydown', pageKeys);
    fireEvent.click(editButton(1)!);
    fireEvent.change(field(), { target: { value: '我们用Sokuji开会' } });
    const only = within(document.querySelector('.record-sentence-edit') as HTMLElement).getByRole('radio', { name: 'Only this sentence' });
    fireEvent.blur(field(), { relatedTarget: only });
    fireEvent.click(only);
    fireEvent.keyDown(only, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Sentence' })).toBeNull();
    expect(pageKeys).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    fireEvent.click(editButton(1)!);
    fireEvent.change(field(), { target: { value: '我们用Sokuji开会' } });
    const only2 = within(document.querySelector('.record-sentence-edit') as HTMLElement).getByRole('radio', { name: 'Only this sentence' });
    fireEvent.blur(field(), { relatedTarget: only2 });
    fireEvent.click(only2);
    fireEvent.blur(only2, { relatedTarget: document.body });
    await settle();
    expect(edit).toHaveBeenCalledWith(1, '我们用Sokuji开会', { everywhere: false, words: false });
    document.removeEventListener('keydown', pageKeys);
  });

  // Final review M-9: a save ending after another sentence's editor opened does not close that one.
  it('a save does not close the next sentence\'s editor', async () => {
    await show();
    fireEvent.click(editButton(1)!);
    fireEvent.change(field(), { target: { value: '我们开会' } });
    fireEvent.blur(field(), { relatedTarget: editButton(3) });
    fireEvent.click(editButton(3)!);
    await settle();
    expect(field().value).toBe('Sokuji 已经上线');
    expect(textOf(1)).toContain('我们开会');
  });

  it('marks an edited sentence and restores it', async () => {
    await show();
    await act(async () => { await store.getState().editSentence(1, '我们开会', { everywhere: false, words: false }); });
    await settle();
    const mark = within(document.querySelector('[data-n="1"]') as HTMLElement).getByRole('button', { name: 'Edited' });
    expect(mark).toHaveAttribute('title', 'Original: 我们用搜库机开会');
    fireEvent.click(mark);
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }));
    await settle();
    expect(textOf(1)).toContain('我们用搜库机开会');
    expect(within(document.querySelector('[data-n="1"]') as HTMLElement).queryByRole('button', { name: 'Edited' })).toBeNull();
  });

  it('no editing on a live record', async () => {
    const B = 'run-0003-cccc';
    real.store.openRecord({ id: B, startedAt: START, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
    const t = real.store.createTranscript({ recordId: B, origin: { service: 'soniox', kind: 'live' } });
    real.store.appendSentences({ transcriptId: t, sentences: [sent(1, '搜库机很快')] });
    await show(B);
    expect(editButton(1)).toBeNull();
  });
});

// Design P1 §1: the notes column edits only when the store allows it, and says what an edit did, with Undo.
describe('editing the notes', () => {
  const lay = () => {
    const t = real.store.getRecord(A) as { transcripts: Array<{ id: number }> };
    real.store.saveNotes({ recordId: A, transcriptId: t.transcripts[0].id, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'zh', state: 'complete',
      body: { title: '周会', overview: { text: '上线', format: 'plain' }, topics: [{ title: '上线', summary: '周三', first: 1 }], points: [{ topic: 0, text: '写说明', sentences: [1], kinds: [] }], names: [] } });
  };

  it('saves through the store and says so, with Undo', async () => {
    lay();
    await show();
    const edit = vi.spyOn(store.getState(), 'editNotes');
    fireEvent.click(screen.getByRole('button', { name: 'Edit the overview' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Overview' }), { target: { value: '下周上线' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Overview' }), { key: 'Enter' });
    await settle();
    expect(edit).toHaveBeenCalledWith({ field: { part: 'overview' }, text: '下周上线' });
    const toast = screen.getByRole('status', { name: 'What changed' });
    expect(within(toast).getByText('Notes changed')).toBeInTheDocument();
    expect(screen.getByText('Edited by hand')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the point' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Point' }), { target: { value: '' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Point' }), { key: 'Enter' });
    await settle();
    expect(within(screen.getByRole('status', { name: 'What changed' })).getByText('Point removed')).toBeInTheDocument();
    expect(within(screen.getByRole('status', { name: 'What changed' })).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('no pencils while a version is being written', async () => {
    lay();
    await show();
    expect(screen.getByRole('button', { name: 'Edit the overview' })).toBeInTheDocument();
    act(() => store.setState({ notesRunning: [A] }));
    expect(screen.queryByRole('button', { name: 'Edit the overview' })).toBeNull();
  });
});

// Design P1 §2: a speaker merged into another of its side from the edit panel, or when a new name matches another's.
describe('merging speakers', () => {
  const B = 'run-0002-bbbb';
  const other = (n: number, speaker: string, text: string) => ({ ...sent(n, text), side: 'other', track: 'other', speaker });
  beforeEach(() => {
    const s = real.store;
    s.openRecord({ id: B, startedAt: START, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
    const t = s.createTranscript({ recordId: B, origin: { service: 'soniox', kind: 'live' } });
    s.appendSentences({ transcriptId: t, sentences: [sent(1, '我先说'), other(2, '1.1', '好的'), other(3, '1.2', '我补充'), other(4, '1.2', '还有一点')] });
    s.closeRecord({ id: B, endedAt: START + 10_000 });
  });
  const panel = () => screen.getByRole('complementary', { name: 'Edit' });

  it('offers the side’s other speakers and merges into the one chosen, with Undo', async () => {
    await show(B);
    expect(within(panel()).queryByRole('button', { name: 'Merge Me into…' })).toBeNull();
    const merge = vi.spyOn(store.getState(), 'mergeSpeaker');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Merge Other 2 into…' }));
    const menu = screen.getByRole('menu', { name: 'Merge into' });
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Other 1']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Other 1' }));
    await settle();
    expect(merge).toHaveBeenCalledWith('other', '1.2', '1.1', { from: 'Other 2', into: 'Other 1' });
    const toast = screen.getByRole('status', { name: 'What changed' });
    expect(within(toast).getByText('Other 2 merged into Other 1 (2 sentences)')).toBeInTheDocument();
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: 'Merge Other 2 into…' })).toBeNull();
  });

  it('no merging while the record is transcribed again', async () => {
    await show(B);
    act(() => store.setState({ job: { kind: 'transcribe', recordId: B } as never }));
    expect(within(panel()).queryByRole('button', { name: 'Merge Other 2 into…' })).toBeNull();
  });

  it('a new name that is another speaker’s on the side asks whether to merge', async () => {
    await show(B);
    const merge = vi.spyOn(store.getState(), 'mergeSpeaker');
    const rename = vi.spyOn(store.getState(), 'renameSpeaker');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Rename Other 2' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: ' other 1 ' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' });
    await settle();
    expect(screen.getByText('Other 1 is already a speaker on this side.')).toBeInTheDocument();
    expect(rename).not.toHaveBeenCalled();
    // Escape goes back to the name, as typed.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Merge into one' }), { key: 'Escape' });
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(' other 1 ');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Merge into one' }));
    await settle();
    expect(merge).toHaveBeenCalledWith('other', '1.2', '1.1', { from: 'Other 2', into: 'Other 1' });
    expect(rename).not.toHaveBeenCalled();
  });

  // Final review I-2: the question is part of the name being typed. Leaving the panel does not drop it.
  const askTwin = (end: 'enter' | 'blur') => {
    fireEvent.click(within(panel()).getByRole('button', { name: 'Rename Other 2' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Other 1' } });
    if (end === 'enter') fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' });
    else fireEvent.blur(screen.getByRole('textbox', { name: 'Name' }));
  };

  it('while the question is open the panel stays: hiding it is refused, and nothing is lost', async () => {
    await show(B);
    const rename = vi.spyOn(store.getState(), 'renameSpeaker');
    askTwin('blur');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await settle();
    expect(panel()).toBeInTheDocument();
    expect(screen.getByText('Other 1 is already a speaker on this side.')).toBeInTheDocument();
    expect(rename).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep apart' }));
    await settle();
    expect(rename).toHaveBeenCalledWith('other', '1.2', 'Other 1');
  });

  it('Back while the question is open keeps them apart: the name is saved as typed', async () => {
    await show(B);
    const rename = vi.spyOn(store.getState(), 'renameSpeaker');
    askTwin('enter');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    await settle();
    expect(rename).toHaveBeenCalledWith('other', '1.2', 'Other 1');
    expect(store.getState().open).toBeNull();
  });

  it('another transcript shown drops the question: it was about the transcript it was asked on', async () => {
    await show(B);
    const t2 = real.store.createTranscript({ recordId: B, origin: { service: 'soniox', kind: 'file' } });
    real.store.appendSentences({ transcriptId: t2, sentences: [other(1, '1.1', '你好'), other(2, '1.2', '我也在')] });
    askTwin('enter');
    await settle();
    await act(async () => { await store.getState().showTranscript(t2 as number); });
    await settle();
    expect(within(panel()).getByRole('button', { name: 'Rename Other 2' })).toBeInTheDocument();
    expect(screen.queryByText('Other 1 is already a speaker on this side.')).toBeNull();
  });

  it('the question takes the focus when the name ended with Enter, not when focus left for somewhere else', async () => {
    await show(B);
    askTwin('blur');
    await settle();
    expect(screen.getByRole('button', { name: 'Merge into one' })).not.toHaveFocus();
    // Escape goes back to the name as typed; Enter there asks again, and the question takes the focus.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Merge into one' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' });
    await settle();
    expect(screen.getByRole('button', { name: 'Merge into one' })).toHaveFocus();
  });

  // PR review: an answer that fails to save brings the question back, with the name as typed, to try again.
  it('an answer that fails to save brings the question back; so does Back', async () => {
    await show(B);
    const fail = () => { store.setState({ error: 'failed: disk' }); };
    vi.spyOn(store.getState(), 'renameSpeaker').mockImplementation(async () => { fail(); });
    vi.spyOn(store.getState(), 'mergeSpeaker').mockImplementation(async () => { fail(); return 0; });
    askTwin('enter');
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Keep apart' }));
    await settle();
    expect(screen.getByText('Other 1 is already a speaker on this side.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Merge into one' }));
    await settle();
    expect(screen.getByText('Other 1 is already a speaker on this side.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    await settle();
    expect(store.getState().open).not.toBeNull();
    expect(screen.getByText('Other 1 is already a speaker on this side.')).toBeInTheDocument();
  });

  it('keeping them apart saves the name as typed', async () => {
    await show(B);
    const rename = vi.spyOn(store.getState(), 'renameSpeaker');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Rename Other 2' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Other 1' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Keep apart' }));
    await settle();
    expect(rename).toHaveBeenCalledWith('other', '1.2', 'Other 1');
  });
});
