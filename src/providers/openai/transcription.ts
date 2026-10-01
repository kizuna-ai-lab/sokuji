/**
 * The source transcript's hints for a Realtime session's
 * `audio.input.transcription` (choice 5): copied, pure, from
 * `src/services/providers/openaiTranscriptionContext.ts` (deleted since
 * with the old client), less its reverse helpers — the
 * builder takes each leg's own direction, so the participant's hint is
 * built for the language it hears (D17).
 *
 * What the object accepts depends on the transcription model, and getting it
 * wrong refuses the whole `session.update` — verified against the live API
 * on 2026-08-01 (model `gpt-realtime-2.1-mini`, session type `realtime`):
 *
 *   | field       | gpt-4o-*-transcribe / whisper-1 | gpt-transcribe / gpt-live-transcribe |
 *   |-------------|---------------------------------|--------------------------------------|
 *   | `language`  | accepted (singular)             | accepted                             |
 *   | `languages` | REJECTED: "not supported"       | accepted (min length 1)              |
 *   | `keywords`  | REJECTED: "not supported"       | accepted (array of strings)          |
 *
 * The `openai` SDK's `AudioTranscription` type lacks `languages` and
 * `keywords`: the wire widens it.
 */

/** Transcription models that accept the `languages` / `keywords` hints. */
const CONTEXT_CAPABLE_MODELS: ReadonlySet<string> = new Set(['gpt-transcribe', 'gpt-live-transcribe']);

/**
 * Language codes the transcription config accepts: the enumeration the API
 * returns when it refuses a code, plus `fil` and `yue`, absent from it yet
 * accepted when probed. Anything else is dropped rather than sent: a
 * refused `session.update` is a dead session.
 */
const SUPPORTED_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'af', 'ar', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
  'en', 'es', 'et', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hr', 'hu', 'hy',
  'id', 'is', 'it', 'iw', 'ja', 'kk', 'kn', 'ko', 'lt', 'lv', 'mi', 'mk',
  'mr', 'ms', 'ne', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr',
  'sv', 'sw', 'ta', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh',
  'fil', 'yue',
]);

/** The `audio.input.transcription` payload. */
export interface TranscriptionHint {
  model: string;
  language?: string;
  languages?: string[];
  keywords?: string[];
}

/** True when `model` accepts the `languages` / `keywords` hints. */
export function supportsTranscriptionContext(model: string | undefined): boolean {
  return !!model && CONTEXT_CAPABLE_MODELS.has(model);
}

/**
 * A language value as a code the config accepts, or null: the region
 * stripped (`en_AU`, `zh_CN`, `es_419` are refused), three-letter codes kept
 * whole, and a language with no supported code — `auto` among them — none.
 */
export function normalizeTranscriptionLanguage(value: string | undefined | null): string | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  if (!lower) return null;
  if (SUPPORTED_LANGUAGE_CODES.has(lower)) return lower;
  const base = lower.split(/[_-]/)[0];
  return SUPPORTED_LANGUAGE_CODES.has(base) ? base : null;
}

/** A typed glossary as the array the API wants: split on commas, full-width commas and newlines; trimmed; each term once. */
export function parseTranscriptionKeywords(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,、，\r\n]+/)) {
    const term = part.trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

/** The hint for `model` hearing `sourceLanguage`, with only the fields that model accepts. */
export function buildTranscriptionHint(model: string, sourceLanguage: string | undefined, rawKeywords: string | undefined): TranscriptionHint {
  const hint: TranscriptionHint = { model };
  const language = normalizeTranscriptionLanguage(sourceLanguage);
  const keywords = parseTranscriptionKeywords(rawKeywords);
  if (supportsTranscriptionContext(model)) {
    // `languages` refuses an empty array: omitted when the language has no code.
    if (language) hint.languages = [language];
    if (keywords.length > 0) hint.keywords = keywords;
  } else if (language) {
    hint.language = language;
  }
  return hint;
}
