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
  /** The legacy models' guiding text: the session background. */
  prompt?: string;
}

/** True when `model` accepts the `languages` / `keywords` hints. */
export function supportsTranscriptionContext(model: string | undefined): boolean {
  return !!model && CONTEXT_CAPABLE_MODELS.has(model);
}

/**
 * A language value as a code the config accepts, or null: the region
 * stripped (`en-AU`, `zh-CN`, `es-419` are refused), three-letter codes kept
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

/**
 * The estimated tokens a legacy prompt may take. whisper-1 keeps only the last 224 tokens of a prompt and says nothing;
 * the same limit is assumed, not verified, for the other legacy models. 200 leaves room for the estimate's error.
 */
export const PROMPT_TOKEN_BUDGET = 200;

/**
 * Tokens of `text`, counted on the safe side: a CJK character, a punctuation mark and a line break one each, a run of
 * Latin letters or digits one per four characters.
 */
export function estimatePromptTokens(text: string): number {
  let tokens = 0;
  for (const run of text.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]/gu) ?? []) {
    if (/^\s$/u.test(run)) { if (run === '\n') tokens += 1; continue; }
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(run)) {
      // Letters of other scripts in the same run count by four.
      const cjk = run.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)!.length;
      tokens += cjk + Math.ceil((run.length - cjk) / 4);
    } else if (/[\p{L}\p{N}]/u.test(run)) tokens += Math.ceil(run.length / 4);
    else tokens += 1;
  }
  return tokens;
}

/**
 * A legacy model's prompt: the background, then the written forms on the last line. The model reads the prompt as the
 * text before the audio, so the line nearest it weighs most; and a prompt over the limit loses its beginning. Over the
 * budget, the background is cut to its first sentence, then dropped; written forms go from the end of the list last, the
 * user's first ones kept.
 */
function legacyPrompt(background: string, keywords: readonly string[]): string {
  const fits = (text: string) => estimatePromptTokens(text) <= PROMPT_TOKEN_BUDGET;
  const termsLine = (list: readonly string[]) => (list.length > 0 ? `${list.join(', ')}.` : '');
  let terms = [...keywords];
  while (terms.length > 0 && !fits(termsLine(terms))) terms = terms.slice(0, -1);
  const line = termsLine(terms);
  const join = (bg: string) => [bg, line].filter(Boolean).join('\n');
  const full = background.trim();
  if (fits(join(full))) return join(full);
  const first = full.match(/^[^。．.!?！？\n]*[。．.!?！？]/u)?.[0];
  if (first && first.length < full.length && fits(join(`${first}…`))) return join(`${first}…`);
  return line;
}

/**
 * The hint for `model` hearing `sourceLanguage`, with only the fields that model accepts: the word list's written forms
 * as `keywords` to the models that take them; to the legacy models, which have a prompt and no keywords, the session
 * background and then the written forms as the `prompt` (the newer ones' prompt is not verified, and a refused field
 * refuses the whole update), kept within `PROMPT_TOKEN_BUDGET`.
 */
export function buildTranscriptionHint(model: string, sourceLanguage: string | undefined, words: { terms?: readonly string[]; background?: string } = {}): TranscriptionHint {
  const hint: TranscriptionHint = { model };
  const language = normalizeTranscriptionLanguage(sourceLanguage);
  const keywords = [...new Set(words.terms ?? [])];
  if (supportsTranscriptionContext(model)) {
    // `languages` refuses an empty array: omitted when the language has no code.
    if (language) hint.languages = [language];
    if (keywords.length > 0) hint.keywords = keywords;
  } else {
    if (language) hint.language = language;
    const prompt = legacyPrompt(words.background ?? '', keywords);
    if (prompt) hint.prompt = prompt;
  }
  return hint;
}
