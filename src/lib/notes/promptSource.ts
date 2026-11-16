// src/lib/notes/promptSource.ts
//
// Where the notes prompts come from. The app carries a copy (`prompts.json`, at the built-in versions); the backend
// publishes the newest version of each family at `GET /api/notes/prompts`. At launch the app reads the last good answer
// it stored, then asks again; an own key uses, family by family, the newest of the two, so a prompt fix reaches it
// without a release. With Kizuna AI the relay puts in its own copy of the version named, and the text is not sent.
// An answer is used only when each prompt of a family is a non-empty text, those written in a language keeping its
// `__LANGUAGE__` mark; anything else keeps what was there.
import { ServiceFactory } from '../../services/ServiceFactory';
import { persistSetting } from '../../services/persistSetting';
import { getApiUrl } from '../../utils/environment';
import texts from './prompts.json';

export type NotesPromptName = 'whole-meeting' | 'meeting-part' | 'combine-parts' | 'check-names';
export interface NotesPrompts { version: number; prompts: Record<NotesPromptName, string> }
export interface LivePrompts { version: number; prompts: { 'live-update': string } }
export interface PromptSets { notes: NotesPrompts; live: LivePrompts }

/** The setting the last good answer is kept in. */
export const PROMPTS_SETTING = 'settings.notes.prompts';

/** The copy the app carries. A change to any text is a new version of its family. */
export const BUILT_IN_PROMPTS: PromptSets = {
  notes: {
    version: 2,
    prompts: { 'whole-meeting': texts.part_single, 'meeting-part': texts.part_multi, 'combine-parts': texts.finish, 'check-names': texts.names },
  },
  live: { version: 2, prompts: { 'live-update': texts.live } },
};

const FAMILIES: Readonly<Record<keyof PromptSets, Readonly<Record<string, boolean>>>> = {
  // Each prompt's name, and whether it is written in a language (and so carries the mark).
  notes: { 'whole-meeting': true, 'meeting-part': true, 'combine-parts': true, 'check-names': false },
  live: { 'live-update': true },
};

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function readFamily(raw: unknown, names: Readonly<Record<string, boolean>>): { version: number; prompts: Record<string, string> } | null {
  if (!isObject(raw) || !Number.isInteger(raw.version) || (raw.version as number) < 1 || !isObject(raw.prompts)) return null;
  const prompts: Record<string, string> = {};
  for (const [name, inLanguage] of Object.entries(names)) {
    const text = raw.prompts[name];
    if (typeof text !== 'string' || !text.trim() || (inLanguage && !text.includes('__LANGUAGE__'))) return null;
    prompts[name] = text;
  }
  return { version: raw.version as number, prompts };
}

/** The families of `raw` that are whole and well-formed; the others are left out. */
export function readPromptSets(raw: unknown): Partial<PromptSets> {
  if (!isObject(raw)) return {};
  const notes = readFamily(raw.notes, FAMILIES.notes) as NotesPrompts | null;
  const live = readFamily(raw.live, FAMILIES.live) as LivePrompts | null;
  return { ...(notes ? { notes } : {}), ...(live ? { live } : {}) };
}

let stored: Partial<PromptSets> = {};

const newest = <T extends { version: number }>(a: T | undefined, b: T): T => (a && a.version > b.version ? a : b);

/** The prompts an own key uses now: per family, the newer of the stored answer and the built-in copy. */
export function activePrompts(): PromptSets {
  return { notes: newest(stored.notes, BUILT_IN_PROMPTS.notes), live: newest(stored.live, BUILT_IN_PROMPTS.live) };
}

export interface PromptSourceDeps {
  fetch?: typeof fetch;
  read?(key: string): Promise<unknown>;
  save?(key: string, value: unknown): Promise<boolean>;
}

const readSetting = (key: string) => ServiceFactory.getSettingsService().getSetting<unknown>(key, null);

/** The last good answer, as stored at an earlier launch. */
export async function loadStoredPrompts(deps: PromptSourceDeps = {}): Promise<void> {
  try {
    stored = { ...readPromptSets(await (deps.read ?? readSetting)(PROMPTS_SETTING)), ...stored };
  } catch {
    // Nothing stored that can be read: the built-in copy stands.
  }
}

/** Asks the backend; a good answer for a family replaces the stored one and is stored. */
export async function refreshPrompts(deps: PromptSourceDeps = {}): Promise<void> {
  const send = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  let answer: Partial<PromptSets>;
  try {
    const response = await send(`${getApiUrl()}/notes/prompts`, { method: 'GET' });
    if (!response.ok) return;
    answer = readPromptSets(await response.json());
  } catch {
    return;
  }
  if (!answer.notes && !answer.live) return;
  // Family by family, the newer: the server takes no version back (a fix is a new version), so an older answer is a
  // cached one, and a newer version stored is kept.
  stored = {
    ...stored,
    ...(answer.notes ? { notes: newest(stored.notes, answer.notes) } : {}),
    ...(answer.live ? { live: newest(stored.live, answer.live) } : {}),
  };
  await (deps.save ?? persistSetting)(PROMPTS_SETTING, stored);
}

/** At launch: the stored answer first, then the backend's. Never rejects. */
export async function startPromptSource(deps: PromptSourceDeps = {}): Promise<void> {
  await loadStoredPrompts(deps);
  await refreshPrompts(deps);
}

/** Back to the built-in copy (tests). */
export function resetPromptSource(): void {
  stored = {};
}
