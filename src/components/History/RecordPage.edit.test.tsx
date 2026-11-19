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

async function show() {
  await store.getState().openRecord(A);
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
  s.appendSentences({ transcriptId: t, sentences: [sent(1, '我们用搜库机开会'), sent(2, '搜库机很快'), sent(3, 'Sokuji 已经上线')] });
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
});
