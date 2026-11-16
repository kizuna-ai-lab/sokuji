// src/lib/notes/prompts.ts
//
// The prompts of the notes written after a session. They are not retyped: `prompts.json` holds the texts the tested
// scripts build in the decided configuration (sentence numbers as anchors, kinds on points, a todo's owner cut to the
// side; parts of 20 minutes; the finishing call; the names step), extracted from
// the measured notes scripts (kept outside this repository). Only the language name is filled in.
// A change to any text is a new NOTES_PROMPT_VERSION, which every notes version stores. Version 2 (stage 5): each
// prompt ends with what the data's `names` (the word list's spellings) are.
import type { WordEntry } from '../words/list';
import texts from './prompts.json';

export const NOTES_PROMPT_VERSION = 2;

const withLanguage = (text: string, languageName: string) => text.replace('__LANGUAGE__', languageName);

/** One part's prompt; `multiPart` adds what a part of a longer recording is. */
export const partPrompt = (languageName: string, multiPart: boolean): string =>
  withLanguage(multiPart ? texts.part_multi : texts.part_single, languageName);

/** The finishing call over all points: title, overview, joins, and the marks that do not hold at the end. */
export const finishPrompt = (languageName: string): string => withLanguage(texts.finish, languageName);

/** The word list as the notes calls carry it: each written form, with what it is often heard as. */
export function notesNames(entries: readonly WordEntry[] | undefined): Array<{ written: string; heard_as?: string }> {
  return (entries ?? []).map((e) => ({ written: e.written, ...(e.heardAs ? { heard_as: e.heardAs } : {}) }));
}

/** The names and terms the recognizer may have written wrongly. The same for every language. */
export const namesPrompt = (): string => texts.names;

/** The live notes' prompt (stage 4): two kinds of marks, to-dos that can be withdrawn, points anchored to sentence numbers, owners as sides. */
export const LIVE_PROMPT_VERSION = 2;
export const livePrompt = (languageName: string): string => withLanguage(texts.live, languageName);
