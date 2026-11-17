import { parseCode } from '../../lib/language/code';
import { englishLanguageName, uiLocale } from '../../lib/language/label';
import type { NotesLanguage } from '../../lib/notes/runner';

/** The single languages in a record's language: none for automatic or unknown, both of a two-way pair. */
function languagesIn(code: string): string[] {
  const parsed = parseCode(code);
  if (!parsed || parsed.kind === 'auto') return [];
  return parsed.kind === 'pair' ? [parsed.a, parsed.b] : [parsed.tag];
}

/**
 * The languages a record's notes can be written in (owner, 2026-11-17; B-52): the record's own two, my language
 * first, and no other. My side detected automatically takes the interface language, as the notes written
 * automatically do (`notesLanguageOf`); the other side detected automatically adds none; so the list is never empty.
 */
export function notesLanguagesOf(record: { myLanguage: string; targetLanguage: string }, uiLanguage: string | null | undefined): NotesLanguage[] {
  const mine = languagesIn(record.myLanguage);
  const codes = [...(mine.length > 0 ? mine : [uiLocale(uiLanguage)]), ...languagesIn(record.targetLanguage)];
  return [...new Set(codes)].map((code) => ({ code, name: englishLanguageName(code) }));
}
