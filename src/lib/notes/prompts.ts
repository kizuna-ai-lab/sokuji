// src/lib/notes/prompts.ts
//
// The prompts of the notes written after a session. They are not retyped: `prompts.json` holds the texts the tested
// scripts build in the decided configuration (sentence numbers as anchors, kinds on points, a todo's owner cut to the
// side; parts of 20 minutes; the finishing call; the names step), extracted from
// the measured notes scripts (kept outside this repository). Only the language name is filled in.
// A change to any text is a new version of its family, which every notes version stores. Version 2 (stage 5): each
// prompt ends with what the data's `names` (the word list's spellings) are. Which copy is used — the built-in one or a
// newer one from the backend — is `promptSource`'s to say; a caller that makes several calls takes one set first.
import type { WordEntry } from '../words/list';
import { activePrompts, BUILT_IN_PROMPTS, type LivePrompts, type NotesPrompts } from './promptSource';

/** The versions the app carries. */
export const NOTES_PROMPT_VERSION = BUILT_IN_PROMPTS.notes.version;

const withLanguage = (text: string, languageName: string) => text.replace('__LANGUAGE__', languageName);

/** One part's prompt; `multiPart` adds what a part of a longer recording is. */
export const partPrompt = (languageName: string, multiPart: boolean, set: NotesPrompts = activePrompts().notes): string =>
  withLanguage(set.prompts[multiPart ? 'meeting-part' : 'whole-meeting'], languageName);

/** The finishing call over all points: title, overview, joins, and the marks that do not hold at the end. */
export const finishPrompt = (languageName: string, set: NotesPrompts = activePrompts().notes): string =>
  withLanguage(set.prompts['combine-parts'], languageName);

/** The word list as the notes calls carry it: each written form, with what it is often heard as. */
export function notesNames(entries: readonly WordEntry[] | undefined): Array<{ written: string; heard_as?: string }> {
  return (entries ?? []).map((e) => ({ written: e.written, ...(e.heardAs ? { heard_as: e.heardAs } : {}) }));
}

/** The names and terms the recognizer may have written wrongly. The same for every language. */
export const namesPrompt = (set: NotesPrompts = activePrompts().notes): string => set.prompts['check-names'];

/** The live notes' prompt (stage 4): two kinds of marks, to-dos that can be withdrawn, points anchored to sentence numbers, owners as sides. */
export const LIVE_PROMPT_VERSION = BUILT_IN_PROMPTS.live.version;
export const livePrompt = (languageName: string, set: LivePrompts = activePrompts().live): string =>
  withLanguage(set.prompts['live-update'], languageName);
