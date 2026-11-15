// src/lib/notes/prompts.ts
//
// The prompts of the notes written after a session. They are not retyped: `prompts.json` holds the texts the tested
// scripts build in the decided configuration (sentence numbers as anchors, kinds on points, a todo's owner cut to the
// side; parts of 20 minutes; the finishing call; the names step), extracted with
// `work/history/implementation/notes/extract_prompts.py` outside this repository. Only the language name is filled in.
// A change to any text is a new NOTES_PROMPT_VERSION, which every notes version stores.
import texts from './prompts.json';

export const NOTES_PROMPT_VERSION = 1;

const withLanguage = (text: string, languageName: string) => text.replace('__LANGUAGE__', languageName);

/** One part's prompt; `multiPart` adds what a part of a longer recording is. */
export const partPrompt = (languageName: string, multiPart: boolean): string =>
  withLanguage(multiPart ? texts.part_multi : texts.part_single, languageName);

/** The finishing call over all points: title, overview, joins, and the marks that do not hold at the end. */
export const finishPrompt = (languageName: string): string => withLanguage(texts.finish, languageName);

/** The names and terms the recognizer may have written wrongly. The same for every language. */
export const namesPrompt = (): string => texts.names;
