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
 *    available — an empty list can't distinguish "unknown" from "not loaded".
 *  - `customVoiceIds` must already be filtered to ELIGIBLE clips (the caller's
 *    job — see LocalNativeClient's use of `eligibleCustomVoices`), in the same
 *    order the voice picker lists them: `customVoiceIds[0]` IS "the first
 *    eligible clip" the fallback below picks.
 *  - R35: when no builtin default exists either (a clone-only family — no
 *    built-in voice at all, e.g. qwen3_tts, omnivoice — reached this function
 *    only because the caller's pre-init gate already found ≥1 eligible clip),
 *    an invalid selection falls back to the first eligible custom clip instead
 *    of '' — landing on no reference voice at all for a model that the caller
 *    already knows CAN speak would be worse than picking one deterministically. */
export function reconcileTtsVoice(
  ttsVoice: string, customVoiceIds: number[], targetLanguage: string,
  voices: NativeVoiceInfo[], hasCustom: boolean,
): string {
  if (!hasCustom) return ttsVoice;
  const fallback = (): string => {
    const builtin = defaultTtsVoice(targetLanguage, voices);
    if (builtin) return builtin;
    return customVoiceIds.length > 0 ? `custom:${customVoiceIds[0]}` : '';
  };
  if (!ttsVoice) return fallback();
  if (ttsVoice.startsWith('custom:')) {
    const id = Number(ttsVoice.slice('custom:'.length));
    if (!Number.isFinite(id) || !customVoiceIds.includes(id)) return fallback();
  }
  if (ttsVoice.startsWith('builtin:') && voices.length > 0) {
    const name = ttsVoice.slice('builtin:'.length);
    if (!voices.some((v) => v.name === name)) return fallback();
  }
  return ttsVoice;
}
