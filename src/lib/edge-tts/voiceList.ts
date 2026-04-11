// src/lib/edge-tts/voiceList.ts

import { fetchVoiceList, type Voice } from './edgeTts';

let cachedVoices: Voice[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
 * Filter voices by BCP-47 language code (e.g. 'en', 'ja', 'zh').
 * Matches the first segment of the voice's Locale (e.g. 'en-US' matches 'en').
 */
export function filterVoicesByLanguage(voices: Voice[], lang: string): Voice[] {
  const langLower = lang.toLowerCase();
  return voices.filter(v => {
    const voiceLang = v.Locale.split('-')[0].toLowerCase();
    return voiceLang === langLower;
  });
}

/**
 * Get a display-friendly name for a voice.
 * E.g. "en-US-AvaMultilingualNeural" → "Ava Multilingual (Female)"
 */
export function getVoiceDisplayName(voice: Voice): string {
  // FriendlyName is like "Microsoft Ava Online (Natural) - English (United States)"
  // ShortName is like "en-US-AvaMultilingualNeural"
  // Extract the descriptive part from ShortName
  const parts = voice.ShortName.split('-');
  // Last part is like "AvaMultilingualNeural" — strip "Neural" suffix
  const rawName = parts.slice(2).join('-').replace(/Neural$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return `${rawName} (${voice.Gender})`;
}

/**
 * Clear the cached voice list (for testing or forced refresh).
 */
export function clearVoiceCache(): void {
  cachedVoices = null;
  cacheTimestamp = 0;
}
