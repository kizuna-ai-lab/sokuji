/**
 * Transcription-context helpers for the OpenAI Realtime API.
 *
 * The Realtime session's `audio.input.transcription` object accepts more than
 * a bare model name, but what it accepts depends on which transcription model
 * is selected. Getting this wrong is not a silent degradation — the server
 * rejects the whole `session.update` with an `invalid_parameter` error and the
 * session never starts. Everything below was verified against the live API on
 * 2026-08-01 (model `gpt-realtime-2.1-mini`, session type `realtime`):
 *
 *   | field       | gpt-4o-*-transcribe / whisper-1 | gpt-transcribe / gpt-live-transcribe |
 *   |-------------|---------------------------------|--------------------------------------|
 *   | `language`  | accepted (singular)             | accepted                             |
 *   | `languages` | REJECTED: "not supported"       | accepted (min length 1)              |
 *   | `keywords`  | REJECTED: "not supported"       | accepted (array of strings)          |
 *   | `prompt`    | accepted                        | accepted                             |
 *
 * That last row is what lets the glossary work everywhere: the legacy models
 * get it as a `prompt`, the current ones as `keywords`. Worth noting the
 * server echoes `prompt` back in `session.updated` but never `keywords`, so
 * the legacy path is the observable one.
 *
 * The `/v1/realtime/translations` session is a different story again: its
 * transcription object accepts ONLY `model`. Every other field — `keywords`,
 * `prompt`, `language`, `languages`, `delay` — comes back as
 * `unknown_parameter`, each verified alone on 2026-08-01. Note that is
 * `unknown_parameter`, not the `invalid_parameter` the legacy models return
 * in a voice-agent session: the field is absent from the endpoint's schema
 * rather than unsupported by the model. So this is NOT something a newer
 * transcription model can unlock — the very same `gpt-live-transcribe` takes
 * all of those fields happily in a `type: "realtime"` session and none of
 * them here. That path deliberately does not use this module; see
 * OpenAITranslateGAClient.buildSessionUpdate.
 */

/** Transcription models that accept `languages` / `keywords` context hints. */
const CONTEXT_CAPABLE_MODELS: ReadonlySet<string> = new Set([
  'gpt-transcribe',
  'gpt-live-transcribe',
]);

/**
 * Language codes the transcription config accepts.
 *
 * The first block is the enumeration the API itself returns when it rejects a
 * bad code. `fil` and `yue` are absent from that enumeration yet were both
 * accepted when probed, so they are kept as separately verified extras rather
 * than folded in silently — if OpenAI ever tightens the check, this is the
 * line to revisit.
 *
 * Anything outside this set is dropped rather than sent: a language hint is a
 * nice-to-have, and a rejected `session.update` is a dead session.
 */
const SUPPORTED_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'af', 'ar', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el',
  'en', 'es', 'et', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hr', 'hu', 'hy',
  'id', 'is', 'it', 'iw', 'ja', 'kk', 'kn', 'ko', 'lt', 'lv', 'mi', 'mk',
  'mr', 'ms', 'ne', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr',
  'sv', 'sw', 'ta', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh',
  // Verified accepted despite being absent from the API's own error listing.
  'fil', 'yue',
]);

/** Shape of the `audio.input.transcription` payload we emit. */
export interface InputAudioTranscriptionConfig {
  model: string;
  language?: string;
  languages?: string[];
  keywords?: string[];
  prompt?: string;
}

/** True when `model` accepts the `languages` / `keywords` context hints. */
export function supportsTranscriptionContext(model: string | undefined): boolean {
  return !!model && CONTEXT_CAPABLE_MODELS.has(model);
}

/**
 * Map a Sokuji language value onto a code the transcription config accepts,
 * or null when there is no usable equivalent.
 *
 * Sokuji's provider list carries regional variants (`en_AU`, `zh_CN`,
 * `es_419`, `pt_BR`) that the API rejects outright, so the region is stripped
 * and the base code checked. A handful of Sokuji languages (Amharic, Bengali,
 * Gujarati, Malayalam, Telugu) have no supported code at all and yield null.
 */
export function normalizeTranscriptionLanguage(value: string | undefined | null): string | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  if (!lower) return null;
  // Check the full value first so three-letter codes (`fil`) aren't truncated
  // by the region split below.
  if (SUPPORTED_LANGUAGE_CODES.has(lower)) return lower;
  const base = lower.split(/[_-]/)[0];
  return SUPPORTED_LANGUAGE_CODES.has(base) ? base : null;
}

/**
 * Split a user-entered keyword list into the array-of-strings the API wants.
 * Accepts commas, newlines, and full-width commas as separators — users
 * pasting a glossary should not have to think about which one we parse.
 */
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

/** Shared assembly for the two entry points below. */
function assemble(
  model: string,
  sourceLanguage: string | undefined,
  keywords: string[]
): InputAudioTranscriptionConfig {
  const config: InputAudioTranscriptionConfig = { model };
  const language = normalizeTranscriptionLanguage(sourceLanguage);

  if (supportsTranscriptionContext(model)) {
    // `languages` rejects an empty array, so it is omitted rather than sent
    // empty when the source language has no supported code.
    if (language) config.languages = [language];
    if (keywords.length > 0) config.keywords = keywords;
  } else {
    if (language) config.language = language;
    // The legacy models reject `keywords` but accept `prompt`, which is how
    // vocabulary has always been fed to Whisper — a bare comma-separated list
    // read as prior text. Kept bare deliberately: wrapping it in an English
    // carrier sentence ("Terms that may appear: …") would inject English into
    // the prior text of a session that may be transcribing Japanese.
    // This is the only thing that writes `prompt`, which is what lets
    // retargetTranscriptionLanguage read the glossary back out of it.
    if (keywords.length > 0) config.prompt = keywords.join(', ');
  }

  return config;
}

/**
 * Build the `audio.input.transcription` payload for a realtime session,
 * emitting only the fields the selected model actually accepts.
 */
export function buildInputAudioTranscription(
  model: string | undefined,
  sourceLanguage?: string,
  rawKeywords?: string
): InputAudioTranscriptionConfig | undefined {
  if (!model) return undefined;
  return assemble(model, sourceLanguage, parseTranscriptionKeywords(rawKeywords));
}

/**
 * Rebuild an existing transcription config around a different spoken language,
 * keeping the model and glossary.
 *
 * Needed because the participant session reverses the translation direction:
 * the other party speaks the configured TARGET language, so a hint built from
 * the user's source language would push their ASR toward the wrong language —
 * the exact opposite of what the hint is for. Every other provider reverses
 * direction by swapping explicit sourceLanguage/targetLanguage fields; for
 * OpenAI the direction lives in `instructions`, and this config is the one
 * other place it leaks into.
 */
export function retargetTranscriptionLanguage(
  config: InputAudioTranscriptionConfig | undefined,
  sourceLanguage: string | undefined
): InputAudioTranscriptionConfig | undefined {
  if (!config) return undefined;
  // On a legacy model the glossary lives in `prompt`, so read it back from
  // there — dropping it would silently strip the participant's glossary.
  // Safe to re-split because assemble() is the only writer of `prompt` and
  // always joins with ', '.
  const keywords = config.keywords ?? parseTranscriptionKeywords(config.prompt);
  return assemble(config.model, sourceLanguage, keywords);
}

/** The direction-carrying slice of an OpenAI session config. Structural rather
 *  than importing OpenAISessionConfig, to keep this module free of the wire
 *  interfaces it feeds. */
export interface DirectionalTranscriptionConfig {
  sourceLanguage?: string;
  targetLanguage?: string;
  inputAudioTranscription?: InputAudioTranscriptionConfig;
}

/**
 * Flip an OpenAI session config to the participant's direction, in place.
 *
 * Mutates like the sibling swaps in createParticipantSessionConfig, which all
 * do `[a.source, a.target] = [a.target, a.source]` on the config object.
 */
export function reverseTranscriptionDirection(config: DirectionalTranscriptionConfig): void {
  [config.sourceLanguage, config.targetLanguage] = [config.targetLanguage, config.sourceLanguage];
  config.inputAudioTranscription = retargetTranscriptionLanguage(
    config.inputAudioTranscription,
    config.sourceLanguage
  );
}
