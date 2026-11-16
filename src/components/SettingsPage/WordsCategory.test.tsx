// The word list in the settings: the table, pasting several, the session background, who uses what, the lock.
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
import { BACKGROUND_KEY, WORDS_KEY, useWordList } from '../../lib/words/list';
import { WordsCategory, parsePasted } from './WordsCategory';

const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const storedEntries = () => (stored.get(WORDS_KEY) as { entries: unknown[] } | undefined)?.entries;

beforeEach(() => {
  cleanup();
  stored.clear();
  useWordList.setState({ entries: [{ written: 'Soniox' }], background: '', loaded: true });
});

describe('the word list in the settings', () => {
  it('adds a row, saves what is written when a cell is left, and removes a row', async () => {
    render(<WordsCategory locked={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    const written = screen.getByLabelText('Written as 2');
    fireEvent.change(written, { target: { value: 'Kizuna AI' } });
    fireEvent.change(screen.getByLabelText('Translation 2'), { target: { value: 'キズナAI' } });
    fireEvent.blur(written);
    await settle();
    expect(storedEntries()).toEqual([{ written: 'Soniox' }, { written: 'Kizuna AI', translation: 'キズナAI' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove 1' }));
    await settle();
    expect(storedEntries()).toEqual([{ written: 'Kizuna AI', translation: 'キズナAI' }]);
  });

  it('writes nothing when a cell is left unchanged', async () => {
    render(<WordsCategory locked={false} />);
    setSetting.mockClear();
    fireEvent.blur(screen.getByLabelText('Written as 1'));
    await settle();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('keeps a row still being filled in when another one is saved', async () => {
    render(<WordsCategory locked={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a row' }));
    fireEvent.change(screen.getByLabelText('Translation 2'), { target: { value: 'only a translation yet' } });
    fireEvent.blur(screen.getByLabelText('Written as 1'));
    await settle();
    expect((screen.getByLabelText('Translation 2') as HTMLInputElement).value).toBe('only a translation yet');
  });

  it('adds pasted lines, "written" or "written = translation", into the list', async () => {
    expect(parsePasted('Sokuji\nKizuna AI = キズナAI\n\n  = nothing')).toEqual([{ written: 'Sokuji' }, { written: 'Kizuna AI', translation: 'キズナAI' }]);
    render(<WordsCategory locked={false} />);
    fireEvent.change(screen.getByLabelText(/Paste several/), { target: { value: 'Sokuji\nSoniox = ソニオックス' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add these' }));
    await settle();
    expect(storedEntries()).toEqual([{ written: 'Soniox', translation: 'ソニオックス' }, { written: 'Sokuji' }]);
  });

  it('saves the session background when it is left', async () => {
    render(<WordsCategory locked={false} />);
    const field = screen.getByLabelText('Session background');
    fireEvent.change(field, { target: { value: 'A design review.' } });
    fireEvent.blur(field);
    await settle();
    expect(stored.get(BACKGROUND_KEY)).toBe('A design review.');
  });

  it('says which services use which column', () => {
    render(<WordsCategory locked={false} />);
    const row = screen.getByRole('rowheader', { name: 'Doubao AST 2.0' }).closest('tr')!;
    expect(Array.from(row.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['✓', '✓', '✓', '—']);
    const qwen = screen.getByRole('rowheader', { name: 'Qwen LiveTranslate' }).closest('tr')!;
    expect(Array.from(qwen.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['—', '✓', '—', '—']);
  });

  it('marks a column some of a service’s models do not take as depending on the model, and says which take it', () => {
    render(<WordsCategory locked={false} />);
    const cells = (name: string) => Array.from(screen.getByRole('rowheader', { name }).closest('tr')!.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells('OpenAI Realtime')).toEqual(['✓', '—', '—', 'Depends on model']);
    expect(cells('Gemini Live')).toEqual(['Depends on model', '—', '—', '—']);
    expect(cells('This device')).toEqual(['Depends on model', 'Depends on model', '—', 'Depends on model']);
    expect(cells('Soniox')).toEqual(['✓', '✓', '—', '✓']);
    expect(screen.getByText(/gemini-3\.8-live/)).toBeTruthy();
  });

  it('is locked during a session', () => {
    render(<WordsCategory locked />);
    expect(screen.getByLabelText('Written as 1')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add a row' })).toBeDisabled();
    expect(screen.getByLabelText('Session background')).toBeDisabled();
  });
});
