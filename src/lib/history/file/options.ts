// src/lib/history/file/options.ts
//
// What a file transcription is asked for, as the import and the "transcribe again" panels start it, and the changes
// the panels make. The languages are the ones spoken, the main one first; the translation is into one language.
import type { FileTranscriptionOptions, HistoryRecord } from '../types';

/** An import: the user's language spoken, and translated into it, until the user says otherwise. */
export function importOptions(myLanguage: string): FileTranscriptionOptions {
  return { languages: [myLanguage], translateTo: myLanguage };
}

/** The languages a stored code names: a two-way pair is both, "automatic" none. */
const languagesOf = (code: string) => code.split('+').filter((c) => c && c !== 'auto');

/**
 * A record transcribed again: what its newest file transcript was asked for; else the languages of the session (the
 * other side's first, then the user's) or of the import, translated into the user's language.
 */
export function optionsFor(record: HistoryRecord): FileTranscriptionOptions {
  const asked = [...record.transcripts]
    .filter((t) => t.origin.kind === 'file' && t.origin.options)
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)[0]?.origin.options;
  if (asked) return asked;
  const mine = record.myLanguage;
  const spoken = languagesOf(record.targetLanguage);
  if (record.mode !== 'import' || spoken.length === 0) spoken.push(mine);
  return { languages: [...new Set(spoken)], translateTo: mine };
}

export function withMain(o: FileTranscriptionOptions, main: string): FileTranscriptionOptions {
  return { ...o, languages: [main, ...o.languages.slice(1).filter((c) => c !== main)] };
}

export function withOther(o: FileTranscriptionOptions, code: string): FileTranscriptionOptions {
  return o.languages.includes(code) ? o : { ...o, languages: [...o.languages, code] };
}

export function withoutOther(o: FileTranscriptionOptions, code: string): FileTranscriptionOptions {
  return { ...o, languages: [o.languages[0], ...o.languages.slice(1).filter((c) => c !== code)] };
}
