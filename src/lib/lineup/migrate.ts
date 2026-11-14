// src/lib/lineup/migrate.ts
//
// The one migration (owner, 2026-11-15): when no line-up is stored, it is
// worked out from what today's session runs, so that nobody's session changes:
// the selected provider on the stages it serves; for the local provider, Bing
// and Edge where today's choices resolve to them, this machine's models
// otherwise. Granite Speech is a local model, so it stays `local_inference`.
import { caps, familyDefaults } from './catalog';
import type { LineUp } from './types';

export interface TodayValues {
  /** The selected provider, after today's fallback for retired or absent ids. */
  selected: string;
  /** For the local provider: what today's choices resolve to, with Bing and Edge among them, after the scan; null otherwise. */
  local: { translation: string | null; tts: string | null } | null;
}

export function lineUpFromToday(v: TodayValues): LineUp {
  if (v.selected === 'local_inference') {
    return {
      transcription: 'local_inference',
      translation: v.local?.translation === 'bing-translator' ? 'bing' : 'local_inference',
      speech: v.local?.tts === 'edge-tts' ? 'edge' : 'local_inference',
      summarisation: null,
    };
  }
  const family = caps(v.selected)?.family ?? 'local_inference';
  return { ...familyDefaults(family), summarisation: null };
}
