import { GeminiSessionConfig } from '../interfaces/IClient';

/**
 * Support for Gemini Live Translate (`gemini-3.5-live-translate-preview`).
 *
 * The model is a dedicated interpreter served over the *same* Live API as the
 * dialogue models: same client, same setup message, and — measured against the
 * live API on 2026-08-10 — not one field rejected that a dialogue model
 * accepts. It is not a separate provider, because nothing about the session
 * contract diverges. What differs is which fields carry meaning:
 *
 * - `translationConfig.targetLanguageCode` is what actually pins the output
 *   language. With it set, a system instruction demanding a *different*
 *   language is overruled. Without it, the model infers the target from the
 *   instruction, which holds for a short direct prompt but drifted into an
 *   unrelated language on a longer one — and took the output transcript down
 *   with it, so the conversation log and subtitles went blank too. Sending it
 *   is what makes a user-written Advanced-mode prompt safe.
 * - `systemInstruction` still earns its place and keeps being sent: an
 *   instruction naming proper nouns corrected both the translation *and* the
 *   input transcript in the same measurement. That is also the only working
 *   glossary mechanism here — the dedicated
 *   `AudioTranscriptionConfig.customVocabulary` field is accepted and then
 *   silently ignored (0/9 trials showed any effect).
 * - `speechConfig` is likewise accepted and silently ignored: the model
 *   reproduces the speaker's own voice, which is the point of using it.
 *   Sending a voice would imply a choice we do not actually have.
 */

/** Substring identifying the dedicated translation models within the Gemini
 *  Live family. Deliberately narrower than `translate` alone so a future
 *  text-translation model cannot match by accident. */
const TRANSLATE_MODEL_MARKER = 'live-translate';

export function isGeminiTranslateModel(modelId: string | null | undefined): boolean {
  return typeof modelId === 'string' && modelId.includes(TRANSLATE_MODEL_MARKER);
}

/** Gemini spells Mandarin `cmn-CN` in its own language list, so the generic
 *  rule would send `cmn`. Both codes are accepted, but they are not
 *  equivalent: measured against the live API on 2026-08-10, `zh` came back in
 *  Simplified and `cmn` in Traditional. The dropdown entry is "Mandarin
 *  Chinese (China)", so Simplified is the one that matches it.
 *
 *  Every other value we offer reduces correctly by taking the primary subtag —
 *  `ar-XA` -> `ar`, `sw-KE` -> `sw` and `uk-UA` -> `uk` were each confirmed
 *  against the API in the same run. */
const EXPLICIT_TRANSLATION_CODES: Record<string, string> = {
  'cmn-CN': 'zh',
};

/**
 * Reduce one of the Gemini provider's regional language values (`ja-JP`,
 * `cmn-CN`, `en-US`) to the short BCP-47 code `targetLanguageCode` expects
 * (`ja`, `zh`, `en`). The model auto-detects the source, so this is only ever
 * applied to a target.
 *
 * Do not reach for `languageCodeShort()` in SubtitleApp for this — that one is
 * a two-character display truncation and turns `cmn-CN` into `CM`.
 */
export function toTranslationLanguageCode(bcp47: string | null | undefined): string {
  if (!bcp47) return '';
  return EXPLICIT_TRANSLATION_CODES[bcp47] ?? bcp47.split('-')[0];
}

/**
 * Build the `translationConfig` for a Gemini session, or `undefined` when the
 * selected model is an ordinary dialogue model that has no use for it.
 *
 * `echoTargetLanguage` stays false: when the other party already speaks the
 * target language there is nothing to interpret, and echoing would re-speak
 * audio the listener just understood.
 */
export function buildGeminiTranslationConfig(
  model: string | null | undefined,
  targetLanguage: string,
): GeminiSessionConfig['translationConfig'] {
  if (!isGeminiTranslateModel(model)) return undefined;
  return {
    targetLanguageCode: toTranslationLanguageCode(targetLanguage),
    echoTargetLanguage: false,
  };
}

/**
 * Reverse a Gemini session's translation direction in place, for the
 * participant channel.
 *
 * The dialogue models get this for free: their direction lives in the system
 * instruction, and the participant session is built from an already-swapped
 * one. A translate session does not, because `targetLanguageCode` overrules
 * that instruction — leaving it alone would translate the other party's speech
 * into the language they are already speaking.
 *
 * No-op for dialogue sessions, which carry no `translationConfig`.
 */
export function reverseGeminiTranslationDirection(config: GeminiSessionConfig): void {
  if (!config.translationConfig || !config.sourceLanguageCode) return;
  const previousTarget = config.translationConfig.targetLanguageCode;
  config.translationConfig = {
    ...config.translationConfig,
    targetLanguageCode: config.sourceLanguageCode,
  };
  config.sourceLanguageCode = previousTarget;
}
