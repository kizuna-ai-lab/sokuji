// The word list page — edit and keep across a restart, paste several, which columns each service uses.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => { stored.set(key, value); return { success: true }; }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({ ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) } }));

import '../../locales';
import { WORDS_KEY, addWord, useWordList } from '../../lib/words/list';
import { WORD_LIMITS, wordsFor } from '../../lib/words/forService';
import { WordsCategory } from './WordsCategory';

const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const storedEntries = () => (stored.get(WORDS_KEY) as { entries: unknown[] } | undefined)?.entries;
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement).value;
const rowCount = () => screen.queryAllByLabelText(/^Written as \d+$/).length;
const paste = async (text: string) => {
  fireEvent.change(screen.getByLabelText(/Paste several/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Add these' }));
  await settle();
};
/** A restart: the in-memory store is gone, only storage is left. */
const restart = () => useWordList.setState({ entries: [], background: '', loaded: false });

beforeEach(() => {
  cleanup();
  stored.clear();
  useWordList.setState({ entries: [], background: '', loaded: true });
});

describe('word list edit and persistence', () => {
  it('keeps every column of every row and the session background after a restart', async () => {
    const first = render(<WordsCategory locked={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    fireEvent.change(screen.getByLabelText('Written as 1'), { target: { value: 'Kizuna AI' } });
    fireEvent.change(screen.getByLabelText('Translation 1'), { target: { value: 'キズナAI' } });
    fireEvent.change(screen.getByLabelText('Often heard as 1'), { target: { value: 'kizuna eye, kids una' } });
    fireEvent.blur(screen.getByLabelText('Often heard as 1'));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    fireEvent.change(screen.getByLabelText('Written as 2'), { target: { value: 'Sokuji' } });
    fireEvent.blur(screen.getByLabelText('Written as 2'));
    await settle();
    fireEvent.change(screen.getByLabelText('Session background'), { target: { value: 'Weekly design review of the mobile app.' } });
    fireEvent.blur(screen.getByLabelText('Session background'));
    await settle();
    first.unmount();

    restart();
    render(<WordsCategory locked={false} />);
    await settle();
    expect(rowCount()).toBe(2);
    expect([value('Written as 1'), value('Translation 1'), value('Often heard as 1')]).toEqual(['Kizuna AI', 'キズナAI', 'kizuna eye, kids una']);
    expect([value('Written as 2'), value('Translation 2'), value('Often heard as 2')]).toEqual(['Sokuji', '', '']);
    expect(value('Session background')).toBe('Weekly design review of the mobile app.');
  });

  it('does not save a row without a written form, so it is gone after a restart', async () => {
    useWordList.setState({ entries: [{ written: 'Soniox' }], background: '', loaded: true });
    const first = render(<WordsCategory locked={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    fireEvent.change(screen.getByLabelText('Translation 2'), { target: { value: 'no written form' } });
    fireEvent.change(screen.getByLabelText('Often heard as 2'), { target: { value: 'something' } });
    fireEvent.blur(screen.getByLabelText('Often heard as 2'));
    // Another real change is saved; the blank-written row still is not.
    fireEvent.change(screen.getByLabelText('Translation 1'), { target: { value: 'ソニオックス' } });
    fireEvent.blur(screen.getByLabelText('Translation 1'));
    await settle();
    expect(storedEntries()).toEqual([{ written: 'Soniox', translation: 'ソニオックス' }]);
    expect(useWordList.getState().entries).toEqual([{ written: 'Soniox', translation: 'ソニオックス' }]);
    first.unmount();

    restart();
    render(<WordsCategory locked={false} />);
    await settle();
    expect(rowCount()).toBe(1);
  });

  it('removes a row at once: from the table and the list in memory, then from storage', async () => {
    useWordList.setState({ entries: [{ written: 'Soniox' }, { written: 'Sokuji' }], background: '', loaded: true });
    render(<WordsCategory locked={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove 1' }));
    // No waiting: the row and the in-memory list change in the same act.
    expect(rowCount()).toBe(1);
    expect(value('Written as 1')).toBe('Sokuji');
    expect(useWordList.getState().entries).toEqual([{ written: 'Sokuji' }]);
    await settle();
    expect(storedEntries()).toEqual([{ written: 'Sokuji' }]);
    restart();
    await act(async () => { await useWordList.getState().load(); });
    expect(useWordList.getState().entries).toEqual([{ written: 'Sokuji' }]);
  });
});

describe('bulk paste and replacement translations', () => {
  it('adds one row per pasted line, "written" and "written = translation" mixed', async () => {
    useWordList.setState({ entries: [{ written: 'Soniox' }], background: '', loaded: true });
    render(<WordsCategory locked={false} />);
    await paste('Alpha\nBeta = ベータ\n\nGamma=ガンマ\n  Delta  ');
    expect(rowCount()).toBe(5);
    expect(storedEntries()).toEqual([
      { written: 'Soniox' }, { written: 'Alpha' }, { written: 'Beta', translation: 'ベータ' }, { written: 'Gamma', translation: 'ガンマ' }, { written: 'Delta' },
    ]);
    // The box is emptied for the next paste.
    expect((screen.getByLabelText(/Paste several/) as HTMLTextAreaElement).value).toBe('');
  });

  it('pasting a written form again with a new translation replaces its translation, without a duplicate row', async () => {
    render(<WordsCategory locked={false} />);
    await paste('Alpha\nBeta = ベータ\nGamma = ガンマ');
    expect(rowCount()).toBe(3);
    await paste('Beta = ベータ2\nAlpha = アルファ');
    expect(rowCount()).toBe(3);
    expect(storedEntries()).toEqual([{ written: 'Alpha', translation: 'アルファ' }, { written: 'Beta', translation: 'ベータ2' }, { written: 'Gamma', translation: 'ガンマ' }]);
    expect([value('Written as 2'), value('Translation 2')]).toEqual(['Beta', 'ベータ2']);
  });

  it('keeps the last translation when one paste names the same written form twice', async () => {
    render(<WordsCategory locked={false} />);
    await paste('Gamma = g1\nGamma = g2');
    expect(rowCount()).toBe(1);
    expect(storedEntries()).toEqual([{ written: 'Gamma', translation: 'g2' }]);
  });

  it('a pasted line without a translation keeps the translation already there', async () => {
    useWordList.setState({ entries: [{ written: 'Beta', translation: 'ベータ' }], background: '', loaded: true });
    render(<WordsCategory locked={false} />);
    await paste('Beta');
    expect(rowCount()).toBe(1);
    expect(storedEntries()).toEqual([{ written: 'Beta', translation: 'ベータ' }]);
  });
});

describe('which columns each provider uses', () => {
  const NAMES: Record<string, string> = {
    soniox: 'Soniox', openai: 'OpenAI Realtime', qwen_livetranslate: 'Qwen LiveTranslate', volcengine_ast2: 'Doubao AST 2.0', gemini: 'Gemini Live', local_inference: 'This device',
  };
  const cells = (name: string) => Array.from(screen.getByRole('rowheader', { name }).closest('tr')!.querySelectorAll('td')).map((td) => td.textContent);

  it('lists the six word-list services, each once', () => {
    render(<WordsCategory locked={false} />);
    expect(Object.keys(WORD_LIMITS).sort()).toEqual(Object.keys(NAMES).sort());
    for (const name of Object.values(NAMES)) expect(screen.getAllByRole('rowheader', { name })).toHaveLength(1);
  });

  it('marks a column as used exactly when that service is sent that column', () => {
    render(<WordsCategory locked={false} />);
    const full = [{ written: 'Kizuna AI', translation: 'キズナAI', heardAs: 'kizuna eye' }];
    const field = { terms: 'terms', translations: 'translations', heardAs: 'heardAs', background: 'background' } as const;
    for (const [id, name] of Object.entries(NAMES)) {
      const sent = wordsFor(id, full, 'Weekly sync.');
      const marks = cells(name);
      (['terms', 'translations', 'heardAs', 'background'] as const).forEach((column, i) => {
        // "✓" and "Depends on model" are both "this service has a field for it"; "—" is "never sent".
        expect(marks[i] !== '—', `${name} ${column}`).toBe(sent[field[column]] !== undefined);
      });
    }
  });

  it('Soniox takes terms, translations and the background; Doubao written, translation and heard-as; Qwen translations only', () => {
    render(<WordsCategory locked={false} />);
    expect(cells('Soniox')).toEqual(['✓', '✓', '—', '✓']);
    expect(cells('Doubao AST 2.0')).toEqual(['✓', '✓', '✓', '—']);
    expect(cells('Qwen LiveTranslate')).toEqual(['—', '✓', '—', '—']);
  });
});

describe('a name added from the notes appears in the settings', () => {
  it('shows a word added outside the page (from the notes) while the page is open', async () => {
    useWordList.setState({ entries: [{ written: 'Kizuna AI' }], background: '', loaded: true });
    render(<WordsCategory locked={false} />);
    await act(async () => { await addWord({ written: 'Sokuji', heardAs: 'Soku G' }); });
    expect(rowCount()).toBe(2);
    expect([value('Written as 2'), value('Often heard as 2')]).toEqual(['Sokuji', 'Soku G']);
  });
});
