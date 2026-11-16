// src/lib/words/list.ts
//
// The app's one word list (spec §9): each entry is how a word is written, optionally its translation and what it is
// often heard as. It is sent to each service in the field that service has for each column (`forService.ts`), and
// the notes prefer its spellings. The session background, free text about the session, is kept beside it. Both are
// stored as one value each; entries keep the user's order and are told apart by their place in it.
import { create } from 'zustand';
import { HEARD_AS_SEPARATOR } from './forService';
import { persistSetting } from '../../services/persistSetting';
import { ServiceFactory } from '../../services/ServiceFactory';

export const WORDS_KEY = 'settings.words';
export const BACKGROUND_KEY = 'settings.sessionBackground';

export interface WordEntry {
  written: string;
  translation?: string;
  heardAs?: string;
}

interface StoredWords { version: 1; entries: WordEntry[] }

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The entries as the list keeps them: cells trimmed, an entry with nothing written dropped, empty optional cells
 * left out, and the same written form with the same translation kept once. What is typed inside a cell (commas,
 * `=`, line breaks) is kept as typed: each service's sender escapes it for that service.
 */
export function normaliseEntries(raw: unknown): WordEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WordEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const written = text(r.written);
    if (!written) continue;
    const translation = text(r.translation);
    const heardAs = text(r.heardAs);
    const key = JSON.stringify([written, translation]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ written, ...(translation ? { translation } : {}), ...(heardAs ? { heardAs } : {}) });
  }
  return out;
}

export async function loadWordList(): Promise<WordEntry[]> {
  const value = await ServiceFactory.getSettingsService().getSetting<unknown>(WORDS_KEY, null);
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return [];
  return normaliseEntries((value as StoredWords).entries);
}

export function saveWordList(entries: readonly WordEntry[]): Promise<boolean> {
  const value: StoredWords = { version: 1, entries: normaliseEntries(entries) };
  return persistSetting(WORDS_KEY, value);
}

export interface WordListStore {
  entries: WordEntry[];
  background: string;
  loaded: boolean;
  load(): Promise<void>;
  setEntries(entries: readonly WordEntry[]): Promise<boolean>;
  setBackground(background: string): Promise<boolean>;
}

export const useWordList = create<WordListStore>()((set) => ({
  entries: [],
  background: '',
  loaded: false,
  async load() {
    const [entries, background] = await Promise.all([
      loadWordList(),
      ServiceFactory.getSettingsService().getSetting<unknown>(BACKGROUND_KEY, ''),
    ]);
    set({ entries, background: typeof background === 'string' ? background : '', loaded: true });
  },
  setEntries(entries) {
    const kept = normaliseEntries(entries);
    set({ entries: kept });
    return saveWordList(kept);
  },
  setBackground(background) {
    set({ background });
    return persistSetting(BACKGROUND_KEY, background);
  },
}));

/** One entry into a list: appended, or filling in the entry already written that way (its "often heard as" joined). */
function merged(entries: readonly WordEntry[], added: WordEntry): WordEntry[] {
  const at = entries.findIndex((e) => e.written === added.written);
  if (at < 0) return [...entries, added];
  const known = entries[at];
  const heard = [known.heardAs, added.heardAs].filter((h): h is string => !!h)
    .flatMap((h) => h.split(HEARD_AS_SEPARATOR).map((x) => x.trim())).filter(Boolean);
  const heardAs = [...new Set(heard)].join(', ');
  const one: WordEntry = {
    written: known.written,
    ...(known.translation || added.translation ? { translation: known.translation || added.translation } : {}),
    ...(heardAs ? { heardAs } : {}),
  };
  return entries.map((e, i) => (i === at ? one : e));
}

/** Adds entries, each appended or merged into the one already written that way, with one write. */
export function addWords(entries: readonly WordEntry[]): Promise<boolean> {
  const added = normaliseEntries(entries);
  if (added.length === 0) return Promise.resolve(false);
  return useWordList.getState().setEntries(added.reduce(merged, useWordList.getState().entries));
}

/** Adds one entry: appended, or merged into the entry already written that way. */
export function addWord(entry: WordEntry): Promise<boolean> {
  return addWords([entry]);
}
