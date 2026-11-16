// The app's one word list: written as, translation, often heard as; and the session background beside it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => { stored.set(key, value); return { success: true }; }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({ ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) } }));

import { BACKGROUND_KEY, WORDS_KEY, addWord, addWords, loadWordList, normaliseEntries, saveWordList, useWordList } from './list';

beforeEach(() => {
  stored.clear();
  useWordList.setState({ entries: [], background: '', loaded: false });
});

describe('the word list', () => {
  it('keeps what is typed, trimmed, and drops what cannot be an entry', () => {
    expect(normaliseEntries([
      { written: '  Kizuna AI ', translation: ' キズナ ', heardAs: '' },
      { written: '', translation: 'nothing written' },
      { written: 'Sokuji', heardAs: '  so kuji, soku G ' },
      { written: 'Kizuna AI', translation: 'キズナ' },
      { written: 'a = b, c\nd' },
      'not an entry', null, { translation: 'x' },
    ])).toEqual([
      { written: 'Kizuna AI', translation: 'キズナ' },
      { written: 'Sokuji', heardAs: 'so kuji, soku G' },
      { written: 'a = b, c\nd' },
    ]);
    expect(normaliseEntries('nonsense')).toEqual([]);
  });

  it('is stored as one value, and read back the same', async () => {
    const entries = [{ written: 'Soniox', translation: 'ソニオックス' }, { written: 'LiveKit', heardAs: 'live kid' }];
    expect(await saveWordList(entries)).toBe(true);
    expect(stored.get(WORDS_KEY)).toEqual({ version: 1, entries });
    expect(await loadWordList()).toEqual(entries);
    stored.set(WORDS_KEY, { version: 9, entries });
    expect(await loadWordList()).toEqual([]);
  });

  it('loads the list and the session background, and saves each change', async () => {
    stored.set(WORDS_KEY, { version: 1, entries: [{ written: 'Soniox' }] });
    stored.set(BACKGROUND_KEY, 'A design review of the mobile app.');
    await useWordList.getState().load();
    expect(useWordList.getState()).toMatchObject({ entries: [{ written: 'Soniox' }], background: 'A design review of the mobile app.', loaded: true });
    await useWordList.getState().setEntries([{ written: ' Qwen ' }, { written: '' }]);
    expect(useWordList.getState().entries).toEqual([{ written: 'Qwen' }]);
    expect(stored.get(WORDS_KEY)).toEqual({ version: 1, entries: [{ written: 'Qwen' }] });
    await useWordList.getState().setBackground('Weekly sync.');
    expect(stored.get(BACKGROUND_KEY)).toBe('Weekly sync.');
  });

  it('adds a word at the end, or into the entry already written that way', async () => {
    await useWordList.getState().setEntries([{ written: 'Soniox' }, { written: 'Kizuna AI', heardAs: 'kizuna eye' }]);
    await addWord({ written: 'Sokuji', heardAs: 'so cookie' });
    await addWord({ written: 'Kizuna AI', heardAs: 'kids una' });
    await addWord({ written: 'Kizuna AI', heardAs: 'kizuna eye' });
    await addWord({ written: 'Soniox', translation: 'ソニオックス' });
    expect(useWordList.getState().entries).toEqual([
      { written: 'Soniox', translation: 'ソニオックス' },
      { written: 'Kizuna AI', heardAs: 'kizuna eye, kids una' },
      { written: 'Sokuji', heardAs: 'so cookie' },
    ]);
  });

  it('adds many words with one write', async () => {
    await useWordList.getState().setEntries([{ written: 'Soniox' }]);
    setSetting.mockClear();
    await addWords([{ written: 'A' }, { written: 'B', translation: 'b' }, { written: 'Soniox', heardAs: 'sonic ox' }]);
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(useWordList.getState().entries).toEqual([{ written: 'Soniox', heardAs: 'sonic ox' }, { written: 'A' }, { written: 'B', translation: 'b' }]);
  });

  it('splits "often heard as" at full-width and ideographic commas too', async () => {
    await useWordList.getState().setEntries([{ written: '速记', heardAs: '速库季，苏库吉' }]);
    await addWord({ written: '速记', heardAs: '素记、速记 ' });
    expect(useWordList.getState().entries).toEqual([{ written: '速记', heardAs: '速库季, 苏库吉, 素记, 速记' }]);
  });
  it('keeps one entry for a word written and translated the same way, with the "often heard as" of both', () => {
    expect(normaliseEntries([
      { written: 'Kizuna AI', translation: 'キズナ', heardAs: 'kizuna eye' },
      { written: 'Kizuna AI', translation: 'キズナ', heardAs: 'kids una，kizuna eye' },
    ])).toEqual([{ written: 'Kizuna AI', translation: 'キズナ', heardAs: 'kizuna eye, kids una' }]);
  });

  it('takes a new translation for a word already in the list; a name added from the notes keeps the old one', async () => {
    await useWordList.getState().setEntries([{ written: 'Soniox', translation: 'ソニオクス' }]);
    await addWords([{ written: 'Soniox', translation: 'ソニオックス' }]);
    expect(useWordList.getState().entries).toEqual([{ written: 'Soniox', translation: 'ソニオックス' }]);
    await addWord({ written: 'Soniox', heardAs: 'sonic ox' });
    expect(useWordList.getState().entries).toEqual([{ written: 'Soniox', translation: 'ソニオックス', heardAs: 'sonic ox' }]);
  });
});
