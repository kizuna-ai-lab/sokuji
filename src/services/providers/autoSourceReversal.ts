import { Provider, kizunaBaseProvider } from '../../types/Provider';
import { isGeminiTranslateModel } from './geminiTranslateModel';

/**
 * Does this provider/model build its participant session by swapping a
 * *concrete* source language into the translate target?
 *
 * Most providers carry translation direction in the system instruction, and
 * the participant session is built from an already-reversed one — those are
 * indifferent to an `auto` source, because nothing has to be swapped.
 *
 * The two here are not:
 * - **Soniox** reverses `sourceLanguage`/`targetLanguage` directly.
 * - **Gemini Live Translate** reverses `translationConfig.targetLanguageCode`,
 *   which overrules the instruction, so the instruction swap cannot stand in
 *   for it. Only the translate models — the dialogue Live models carry
 *   direction in the instruction like everyone else.
 *
 * For both, an `auto` source would reverse into the literal `auto` as the
 * participant's translate target, which is not a language. Callers require a
 * concrete source language whenever a participant channel is in scope; see
 * `computeStartGate`'s `autoSourceParticipantBlocked`.
 */
export function reversesDirectionViaSourceLanguage(
  provider: Provider,
  model: string | null | undefined,
): boolean {
  const base = kizunaBaseProvider(provider) ?? provider;
  if (base === Provider.SONIOX) return true;
  if (base === Provider.GEMINI) return isGeminiTranslateModel(model);
  return false;
}
