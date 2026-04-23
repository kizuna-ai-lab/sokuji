// src/lib/edge-tts/voiceList.ts

import { fetchVoiceList, type Voice } from './edgeTts';

let cachedVoices: Voice[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Per-language voice matching rules.
 *
 * `prefixes` — locale prefixes that a voice's Locale must start with to be
 *   considered a match. Used when the app's language code does not map 1:1
 *   to an Edge TTS Locale primary subtag (e.g. our `cantonese` → `zh-HK`).
 * `excludes` — locales to exclude even though they match the primary subtag.
 *   E.g. `zh` in this app means Mandarin, so Cantonese (`zh-HK`) and Taiwanese
 *   Hakka-adjacent variants should be offered under `cantonese` instead.
 * `preferred` — the default Locale to pick when auto-selecting a voice.
 *   Voices matching this Locale are sorted to the front of the filtered list
 *   so that consumers who take the first result get the expected dialect.
 */
interface LocaleRule {
  prefixes?: string[];
  excludes?: string[];
  preferred?: string;
}

const LOCALE_RULES: Record<string, LocaleRule> = {
  zh: { excludes: ['zh-HK'], preferred: 'zh-CN' },          // Mandarin
  cantonese: { prefixes: ['zh-HK'], preferred: 'zh-HK' },   // Cantonese
  en: { preferred: 'en-US' },
  pt: { preferred: 'pt-BR' },
  es: { preferred: 'es-ES' },
  fr: { preferred: 'fr-FR' },
  de: { preferred: 'de-DE' },
  ar: { preferred: 'ar-EG' },
};

/**
 * Get the full Edge TTS voice list, with 24h in-memory cache.
 */
export async function getEdgeTtsVoices(): Promise<Voice[]> {
  if (cachedVoices && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVoices;
  }
  cachedVoices = await fetchVoiceList();
  cacheTimestamp = Date.now();
  return cachedVoices;
}

/**
 * Filter voices for a given app language code.
 *
 * Matching:
 *   - If a rule defines `prefixes`, a voice matches when its Locale starts
 *     with any prefix (case-insensitive).
 *   - Otherwise, match by primary subtag of Locale (`zh-CN` → `zh`).
 *   - Voices whose Locale is in `excludes` are removed.
 *
 * Ordering: voices matching the rule's `preferred` Locale are placed first,
 * so callers that rely on `candidates[0]` land on the expected dialect
 * (e.g. Mandarin `zh-CN` rather than Cantonese `zh-HK` for `zh`).
 */
export function filterVoicesByLanguage(voices: Voice[], lang: string): Voice[] {
  const langLower = lang.toLowerCase();
  const rule = LOCALE_RULES[langLower];
  const excludes = new Set((rule?.excludes ?? []).map(l => l.toLowerCase()));

  const matched = voices.filter(v => {
    const localeLower = v.Locale.toLowerCase();
    if (excludes.has(localeLower)) return false;
    if (rule?.prefixes) {
      return rule.prefixes.some(p => localeLower.startsWith(p.toLowerCase()));
    }
    return localeLower.split('-')[0] === langLower;
  });

  const preferred = rule?.preferred?.toLowerCase();
  if (!preferred) return matched;
  return [...matched].sort((a, b) => {
    const aPref = a.Locale.toLowerCase() === preferred ? 0 : 1;
    const bPref = b.Locale.toLowerCase() === preferred ? 0 : 1;
    return aPref - bPref;
  });
}

/**
 * Get a display-friendly name for a voice.
 * E.g. "zh-HK-HiuGaaiNeural" → "Hiu Gaai (Female, zh-HK)"
 * The locale suffix is included so users can distinguish regional variants
 * (e.g. Mandarin `zh-CN` vs Cantonese `zh-HK` vs Taiwanese `zh-TW`).
 */
export function getVoiceDisplayName(voice: Voice): string {
  // ShortName is like "en-US-AvaMultilingualNeural"
  const parts = voice.ShortName.split('-');
  const rawName = parts.slice(2).join('-').replace(/Neural$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return `${rawName} (${voice.Gender}, ${voice.Locale})`;
}

/**
 * Clear the cached voice list (for testing or forced refresh).
 */
export function clearVoiceCache(): void {
  cachedVoices = null;
  cacheTimestamp = 0;
}
