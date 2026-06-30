import { defaultTtsVoice } from './nativeCatalog';

/** Resolve a stored ttsVoice to a concrete voice: '' → per-language default;
 *  a custom:<id> whose id is gone → default; otherwise pass through.
 *  Note: passes an empty voice list for now (Task 8 makes this shape-aware). */
export function reconcileTtsVoice(ttsVoice: string, customVoiceIds: number[], targetLanguage: string): string {
  if (!ttsVoice) return defaultTtsVoice(targetLanguage, []);
  if (ttsVoice.startsWith('custom:')) {
    const id = Number(ttsVoice.slice('custom:'.length));
    if (!Number.isFinite(id) || !customVoiceIds.includes(id)) return defaultTtsVoice(targetLanguage, []);
  }
  return ttsVoice;
}
