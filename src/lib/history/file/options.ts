// src/lib/history/file/options.ts
//
// What a file transcription is asked for, as the import and the "transcribe again" panels start it, and the changes
// the panels make. The languages are the ones spoken, the main one first; the translation is into one language, or,
// for a session with both its sides kept, each side into the other's language as the session had it (EACH_SIDE).
import type { FileTranscriptionOptions, HistoryLegComposition, HistoryRecord } from '../types';

/** "Translate into": each side into the other's language, as in the session. Never a language code. */
export const EACH_SIDE = 'each-side';

/** An import: the user's language spoken, and translated into it, until the user says otherwise. */
export function importOptions(myLanguage: string): FileTranscriptionOptions {
  return { languages: [myLanguage], translateTo: myLanguage };
}

/** The languages a stored code names: a two-way pair is both, "automatic" none. */
const languagesOf = (code: string) => code.split('+').filter((c) => c && c !== 'auto');
/** One language, not "automatic" and not a two-way pair. */
const isOne = (code: string | undefined): code is string => !!code && code !== 'auto' && !code.includes('+');

/** Options read from storage, when they are in the shape this code writes; else null. */
function asOptions(value: unknown): FileTranscriptionOptions | null {
  const o = value as Partial<FileTranscriptionOptions> | null | undefined;
  if (!o || !Array.isArray(o.languages) || o.languages.length === 0 || !o.languages.every((c) => typeof c === 'string' && c)) return null;
  if (typeof o.translateTo !== 'string' || !o.translateTo) return null;
  return { languages: [...o.languages], translateTo: o.translateTo };
}

/** The legs whose recording is still kept. */
function keptLegs(record: HistoryRecord): HistoryLegComposition[] {
  const kept = new Set(record.tracks.filter((t) => t.goneAt === null).map((t) => t.source));
  return record.legs.filter((l) => kept.has(l.leg));
}

/** The code as one of the offered languages: itself, or for a regional code its language; null when neither is offered. */
function offeredAs(code: string, offered: readonly string[]): string | null {
  if (offered.includes(code)) return code;
  const base = code.split(/[-_]/)[0].toLowerCase();
  return offered.includes(base) ? base : null;
}

/**
 * A session whose two sides are both kept, each with one language heard and one it was translated into; once the
 * service's languages are known, both of those it translates into among them (else a side would go untranslated).
 */
export function eachSideOffered(record: HistoryRecord, offered: readonly string[] = []): boolean {
  if (record.mode === 'import') return false;
  const legs = keptLegs(record);
  if (legs.length !== 2 || !legs.every((l) => isOne(l.languages.source) && isOne(l.languages.target))) return false;
  return offered.length === 0 || legs.every((l) => offeredAs(l.languages.target, offered) !== null);
}

/**
 * A record transcribed again: what its newest file transcript was asked for; else what an import was asked for when
 * it was made; else the session's own languages: both sides kept, the other side's language first and each side
 * translated as it was; one side kept, that side's language translated as it was.
 */
export function optionsFor(record: HistoryRecord): FileTranscriptionOptions {
  const asked = [...record.transcripts]
    .filter((t) => t.origin.kind === 'file')
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
    .map((t) => asOptions(t.origin.options))
    .find((o) => o !== null);
  const mine = record.myLanguage;
  if (asked) {
    if (asked.translateTo !== EACH_SIDE || eachSideOffered(record)) return asked;
    // "Each side" with one side's recording since deleted: the side left is translated as it was in the session.
    const left = keptLegs(record);
    const target = left.length === 1 ? left[0].languages.target : undefined;
    return { ...asked, translateTo: isOne(target) ? target : mine };
  }
  if (record.mode === 'import') {
    const atImport = asOptions(record.services.options);
    if (atImport) return atImport;
    const target = record.legs.find((l) => l.leg === 'participant')?.languages.target;
    const spoken = languagesOf(record.targetLanguage);
    return { languages: spoken.length > 0 ? spoken : [mine], translateTo: isOne(target) ? target : mine };
  }
  if (eachSideOffered(record)) {
    const [speaker, participant] = (['speaker', 'participant'] as const).map((name) => record.legs.find((l) => l.leg === name)!);
    return { languages: [...new Set([participant.languages.source, speaker.languages.source])], translateTo: EACH_SIDE };
  }
  const legs = keptLegs(record);
  if (legs.length === 1 && isOne(legs[0].languages.source)) {
    const { source, target } = legs[0].languages;
    return { languages: [source], translateTo: isOne(target) ? target : mine };
  }
  return { languages: [...new Set([...languagesOf(record.targetLanguage), ...languagesOf(mine)])], translateTo: mine };
}

/**
 * The options as the service can take them: "automatic" left out, a two-way pair as its two languages, a regional code
 * as its language when only that is offered, anything else not offered left out. The main language and the
 * translation fall back to the user's language, else the service's first; "each side" stays only where offered.
 * Until the service's languages are known, the options are left as they are.
 */
export function fitOptions(o: FileTranscriptionOptions, offered: readonly string[], fallback: string, eachSide: boolean): FileTranscriptionOptions {
  if (offered.length === 0) return o;
  const pick = (code: string) => offeredAs(code, offered);
  const first = pick(fallback) ?? offered[0];
  const languages = [...new Set(o.languages.flatMap(languagesOf).map(pick).filter((c): c is string => c !== null))];
  if (languages.length === 0) languages.push(first);
  if (o.translateTo === EACH_SIDE) return { languages, translateTo: eachSide ? EACH_SIDE : first };
  return { languages, translateTo: pick(o.translateTo) ?? first };
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
