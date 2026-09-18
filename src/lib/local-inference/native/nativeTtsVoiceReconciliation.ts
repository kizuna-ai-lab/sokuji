import { defaultTtsVoice } from './nativeCatalog';
import type { NativeVoiceInfo } from './nativeProtocol';

/** Resolve a stored ttsVoice to a concrete in-model selection.
 *
 *  Used for BOTH the engine's selection at session start (LocalNativeClient)
 *  and the picker's displayed selection (NativeVoiceSection), so that what
 *  the settings panel shows and what the model is told cannot diverge. It is
 *  pure and never writes settings: a stale selection is resolved for use, not
 *  erased, so switching back to the model it belongs to restores it.
 *
 *  - hasCustom=false (single/range, no custom-voice support): '' and 'sid:n'
 *    pass through, since those are that model's own id space ('' = default
 *    speaker). A `custom:` or `builtin:` value is still validated — `ttsVoice`
 *    is one global setting, so after a model switch it routinely holds another
 *    model's namespace.
 *  - hasCustom=true (any custom-capable model — clip clone or style prompt):
 *    '' or a dead custom id → the language's default built-in; a builtin name
 *    the current model doesn't have (stale setting from a previously selected
 *    model, e.g. pocket's 'eponine' arriving at gpt-sovits) → the language's
 *    default built-in. Builtin names are only validated when a voice list is
 *    available — an empty list can't distinguish "unknown" from "not loaded".
 *  - `hasBuiltin=false` IS that distinction: the family exposes no built-in
 *    voices at all (capability `builtin: 'none'` — every clone-only family,
 *    qwen3_tts/omnivoice/moss and the four added 2026-09-03), so a stored
 *    `builtin:` name is not merely unverifiable, it is unusable: applying it
 *    means setVoice() against an empty preset list, which fails and takes TTS
 *    down with it. Such a selection falls back like any other dead one.
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
  voices: NativeVoiceInfo[], hasCustom: boolean, hasBuiltin = true,
): string {
  const fallback = (): string => {
    const builtin = defaultTtsVoice(targetLanguage, voices);
    if (builtin) return builtin;
    return customVoiceIds.length > 0 ? `custom:${customVoiceIds[0]}` : '';
  };
  // Nullish/empty FIRST, before anything reads the string. `ttsVoice` is typed
  // `string` but genuinely arrives undefined — NativeVoiceSection's `selected`
  // comes from a settings object that may not have the field yet, and
  // LocalNativeClient only avoids it by passing `config.ttsVoice ?? ''`. The
  // old shape absorbed that by accident (a leading `!ttsVoice` check); moving
  // the namespace checks up made `.startsWith()` reachable with undefined,
  // which crashed the whole settings panel until the full suite caught it.
  if (!ttsVoice) return hasCustom ? fallback() : '';
  // Namespace next, `hasCustom` second. `hasCustom` used to short-circuit
  // this whole function, on the assumption that a model without custom-voice
  // support could only ever have stored '' or 'sid:n' — its own id space. But
  // `ttsVoice` is ONE global setting shared by every TTS model, so after a
  // model switch the stored value is routinely another model's namespace, and
  // trusting it is what made the picker print `custom:21` under supertonic.
  if (ttsVoice.startsWith('custom:')) {
    // No custom-voice store at all: the id cannot refer to anything here.
    if (!hasCustom) return fallback();
    const id = Number(ttsVoice.slice('custom:'.length));
    if (!Number.isFinite(id) || !customVoiceIds.includes(id)) return fallback();
    return ttsVoice;
  }
  if (ttsVoice.startsWith('builtin:')) {
    if (!hasBuiltin) return fallback();
    const name = ttsVoice.slice('builtin:'.length);
    if (voices.length > 0 && !voices.some((v) => v.name === name)) return fallback();
    return ttsVoice;
  }
  // Neither namespace, and non-empty by now: 'sid:n', which is a no-custom
  // model's own id space. Passes through untouched, as it always has — and on
  // a custom-capable model too, where a leftover sid: value is inert (nothing
  // sends a speaker id since the ONNX range backends died).
  return ttsVoice;
}
