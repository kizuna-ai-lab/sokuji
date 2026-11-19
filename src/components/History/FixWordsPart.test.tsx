// The edit panel's "Fix words" (design draft P0 §3.1, option C): the one place a misheard word is fixed. A word handed
// over from the notes or a selection fills it; it never fixes by itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { createVirtualClock } from '../../lib/contract/clock';
import { createHistoryPageStore } from '../../lib/history/historyPageStore';
import { realStorePort, type RealStorePort } from '../../lib/history/testing/realStorePort';
import { useWordList } from '../../lib/words/list';
import '../../locales';
import { HistoryPageContext } from './historyContext';
import FixWordsPart from './FixWordsPart';

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
const B = 'run-0002-bbbb';
const START = new Date(2026, 0, 15, 9, 0, 0).getTime();
const BODY = { title: '周会', overview: { text: '搜库机上线', format: 'plain' }, topics: [], points: [], names: [] };
const sent = (n: number, text: string) => ({ n, side: 'mine', sideCertain: true, track: 'microphone', speaker: '1', startMs: n * 1000, endMs: n * 1000 + 800, text, timeKind: 'given' });

let real: RealStorePort;
let store: ReturnType<typeof createHistoryPageStore>;
const jump = vi.fn();
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });

function lay(id: string, finished = true, more: ReturnType<typeof sent>[] = []) {
  const s = real.store;
  s.openRecord({ id, startedAt: START, mode: 'both', myLanguage: 'zh', targetLanguage: 'en', services: { provider: 'soniox', models: {} }, appVersion: '1.2.3' });
  const t = s.createTranscript({ recordId: id, origin: { service: 'soniox', kind: 'live' } });
  s.appendSentences({ transcriptId: t, sentences: [sent(1, '我们用搜库机开会'), sent(2, '搜库机很快'), sent(3, 'Sokuji 已经上线'), ...more] });
  s.saveNotes({ recordId: id, transcriptId: t, writtenBy: { kind: 'sokuji', promptVersion: 1, model: 'm' }, language: 'zh', state: 'complete', body: BODY });
  if (finished) s.closeRecord({ id, endedAt: START + 10_000 });
}
async function show(id = A) {
  await store.getState().openRecord(id);
  render(
    <HistoryPageContext.Provider value={{ store, onClose: () => {} }}>
      <FixWordsPart onJump={jump} />
    </HistoryPageContext.Provider>,
  );
  await settle();
}
const heard = () => screen.getByRole('textbox', { name: 'Heard as' }) as HTMLInputElement;
const changeTo = () => screen.getByRole('textbox', { name: 'Change to' }) as HTMLInputElement;
const changeAll = () => screen.getByRole('button', { name: 'Change all' });

beforeEach(() => {
  settingsStored.clear();
  useWordList.setState({ entries: [], background: '', loaded: true });
  jump.mockClear();
  real = realStorePort();
  lay(A);
  store = createHistoryPageStore(real.port, createVirtualClock(0), (e) => `failed: ${(e as Error).message}`);
});
afterEach(() => { cleanup(); real.dispose(); vi.restoreAllMocks(); });

describe('fixing words in the edit panel', () => {
  it('counts as you type and changes all', async () => {
    await show();
    const fix = vi.spyOn(store.getState(), 'fixWords');
    fireEvent.change(heard(), { target: { value: '搜库机' } });
    expect(screen.getByText('2 places')).toBeInTheDocument();
    fireEvent.change(changeTo(), { target: { value: 'Sokuji' } });
    expect(screen.getByRole('checkbox', { name: 'Fix in the notes too (1)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Add to the word list' })).toBeChecked();
    fireEvent.click(changeAll());
    await settle();
    expect(fix).toHaveBeenCalledWith('搜库机', 'Sokuji', { notes: true, words: true, only: null });
  });

  // Owner, 2026-11-19: no fix to an empty word.
  it('cannot change to nothing, to the same, or what is not there', async () => {
    await show();
    fireEvent.change(heard(), { target: { value: '搜库机' } });
    fireEvent.change(changeTo(), { target: { value: '  ' } });
    expect(changeAll()).toBeDisabled();
    fireEvent.change(changeTo(), { target: { value: '搜库机' } });
    expect(changeAll()).toBeDisabled();
    fireEvent.change(heard(), { target: { value: '没有这个词' } });
    fireEvent.change(changeTo(), { target: { value: 'Sokuji' } });
    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(changeAll()).toBeDisabled();
  });

  it('lists the fixes made and reverts one', async () => {
    await show();
    await act(async () => { await store.getState().fixWords('搜库机', 'Sokuji', { notes: false, words: false }); });
    await settle();
    expect(screen.getByText('搜库机 → Sokuji · 2 places')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    await settle();
    expect(screen.queryByText('搜库机 → Sokuji · 2 places')).toBeNull();
    expect(store.getState().open!.sentences[0].text).toBe('我们用搜库机开会');
  });

  // Final review I-2: the count is what a fix would change; places already written right are not in it.
  it('counts only the places not yet written right', async () => {
    await show();
    fireEvent.change(heard(), { target: { value: '搜库' } });
    expect(screen.getByText('2 places')).toBeInTheDocument();
    fireEvent.change(changeTo(), { target: { value: '搜库机' } });
    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Fix in the notes too/ })).toBeNull();
  });

  // Design draft P0 §4: notes being written are about to be replaced, so they are not fixed.
  it('does not offer the notes while they are being written', async () => {
    await show();
    act(() => store.setState({ notesRunning: [A] }));
    fireEvent.change(heard(), { target: { value: '搜库机' } });
    expect(screen.queryByRole('checkbox', { name: 'Fix in the notes too (1)' })).toBeNull();
  });

  // PR review: "Only the selected one" stays on that place; once it reads right, there is nothing to change.
  it('the selected place only, even once it reads right', async () => {
    lay(B, true, [sent(4, '搜库上线')]);
    await show(B);
    const fix = vi.spyOn(store.getState(), 'fixWords');
    act(() => store.getState().openFix({ heard: '搜库', only: 1, source: 'selection' }));
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'Only the selected one' }));
    fireEvent.change(changeTo(), { target: { value: '搜库机' } });
    expect(changeAll()).toBeDisabled();
    fireEvent.click(changeAll());
    expect(fix).not.toHaveBeenCalled();
  });

  // PR review: a selection's place is in its own transcript; showing another one forgets it.
  it('a selection\'s place goes when another transcript is shown', async () => {
    await show();
    const t2 = real.store.createTranscript({ recordId: A, origin: { service: 'soniox', kind: 'file' } }) as number;
    real.store.appendSentences({ transcriptId: t2, sentences: [sent(1, '搜库机一'), sent(2, '搜库机二')] });
    act(() => store.getState().openFix({ heard: '搜库机', only: 2, source: 'selection' }));
    await settle();
    expect(screen.getByRole('radio', { name: 'Only the selected one' })).toBeInTheDocument();
    await act(async () => { await store.getState().showTranscript(t2); });
    await settle();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(heard().value).toBe('搜库机');
  });

  // PR review: a word handed over while a fix is being written is not cleared when that fix ends.
  it('a word handed over while a fix is written is kept', async () => {
    await show();
    let finish!: (n: number) => void;
    vi.spyOn(store.getState(), 'fixWords').mockImplementation(() => new Promise<number>((r) => { finish = r; }));
    fireEvent.change(heard(), { target: { value: '搜库机' } });
    fireEvent.change(changeTo(), { target: { value: 'Sokuji' } });
    fireEvent.click(changeAll());
    act(() => store.getState().openFix({ heard: '佐藤米崎', suggestion: '佐藤美咲', source: 'notes' }));
    await settle();
    await act(async () => { finish(2); });
    await settle();
    expect(heard().value).toBe('佐藤米崎');
    expect(changeTo().value).toBe('佐藤美咲');
  });

  it('hidden on a live record', async () => {
    lay(B, false);
    await show(B);
    expect(screen.queryByRole('textbox', { name: 'Heard as' })).toBeNull();
  });

  it('shows each place, and goes to it', async () => {
    await show();
    fireEvent.change(heard(), { target: { value: '搜库机' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show each' }));
    const places = screen.getAllByRole('button', { name: /^0:0[12] / });
    expect(places).toHaveLength(2);
    fireEvent.click(places[1]);
    expect(jump).toHaveBeenCalledWith(2);
  });

  // Option C: a word selected in the transcript is handed over; it may be fixed there only.
  it('a word handed over from a selection fills the part', async () => {
    await show();
    const fix = vi.spyOn(store.getState(), 'fixWords');
    act(() => store.getState().openFix({ heard: '搜库机', only: 2, source: 'selection' }));
    await settle();
    expect(heard().value).toBe('搜库机');
    expect(changeTo()).toHaveFocus();
    expect(store.getState().fixDraft).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Only the selected one' }));
    expect(screen.getByRole('checkbox', { name: 'Add to the word list' })).toBeDisabled();
    fireEvent.change(changeTo(), { target: { value: 'Sokuji' } });
    fireEvent.click(changeAll());
    await settle();
    expect(fix).toHaveBeenCalledWith('搜库机', 'Sokuji', { notes: false, words: false, only: 2 });
  });

  it('a name handed over from the notes comes with its suggestion', async () => {
    await show();
    act(() => store.getState().openFix({ heard: '搜库机', suggestion: 'Sokuji', source: 'notes' }));
    await settle();
    expect(screen.getByText('From the notes’ names to check')).toBeInTheDocument();
    expect(changeTo().value).toBe('Sokuji');
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
