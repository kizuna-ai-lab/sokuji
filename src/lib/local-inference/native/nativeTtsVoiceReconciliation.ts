import { defaultTtsVoice } from './nativeCatalog';
import type { NativeVoiceInfo } from './nativeProtocol';

/** Resolve a stored ttsVoice to a concrete in-model selection.
 *  - hasCustom=false (single/range, no custom-voice support): pass through
 *    ('' = default speaker, 'sid:n' = a speaker).
 *  - hasCustom=true (any custom-capable model — clip clone or style prompt):
 *    '' or a dead custom id → the language's default built-in; a builtin name
 *    the current model doesn't have (stale setting from a previously selected
 *    model, e.g. pocket's 'eponine' arriving at gpt-sovits) → the language's
 *    default built-in. Builtin names are only validated when a voice list is
 *    available — an empty list can't distinguish "unknown" from "not loaded". */
export function reconcileTtsVoice(
  ttsVoice: string, customVoiceIds: number[], targetLanguage: string,
  voices: NativeVoiceInfo[], hasCustom: boolean,
): string {
  if (!hasCustom) return ttsVoice;
  if (!ttsVoice) return defaultTtsVoice(targetLanguage, voices);
  if (ttsVoice.startsWith('custom:')) {
    const id = Number(ttsVoice.slice('custom:'.length));
    if (!Number.isFinite(id) || !customVoiceIds.includes(id)) return defaultTtsVoice(targetLanguage, voices);
  }
  if (ttsVoice.startsWith('builtin:') && voices.length > 0) {
    const name = ttsVoice.slice('builtin:'.length);
    if (!voices.some((v) => v.name === name)) return defaultTtsVoice(targetLanguage, voices);
  }
  return ttsVoice;
}
