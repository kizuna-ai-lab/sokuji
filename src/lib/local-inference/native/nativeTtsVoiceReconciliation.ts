import { defaultTtsVoice } from './nativeCatalog';
import type { NativeVoiceInfo } from './nativeProtocol';

/** Resolve a stored ttsVoice to a concrete in-model selection.
 *  - hasCustom=false (single/range, no custom-voice support): pass through
 *    ('' = default speaker, 'sid:n' = a speaker).
 *  - hasCustom=true (any custom-capable model — clip clone or style prompt):
 *    '' or a dead custom id → the language's default built-in. */
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
  return ttsVoice;
}
