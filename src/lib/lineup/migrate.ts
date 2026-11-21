// src/lib/lineup/migrate.ts
//
// The one migration (owner, 2026-11-15): when no line-up is stored, it is
// worked out from what today's session runs, so that nobody's session changes:
// the stored provider on the stages it serves; for the local provider, Bing
// and Edge where today's choices resolve to them, this machine's models
// otherwise. Granite Speech is a local model, so it stays `local_inference`.
import { caps, hostDefaults } from './catalog';
import type { LineUp } from './types';

export interface TodayValues {
  /** The provider that runs today: the stored one, after today's fallback for retired or absent ids. */
  provider: string;
  /** For the local provider: what today's choices resolve to, with Bing and Edge among them, after the scan; null otherwise. */
  local: { translation: string | null; tts: string | null } | null;
}

export function lineUpFromToday(v: TodayValues): LineUp {
  if (v.provider === 'local_inference') {
    return {
      transcription: 'local_inference',
      translation: v.local?.translation === 'bing-translator' ? 'bing' : 'local_inference',
      speech: v.local?.tts === 'edge-tts' ? 'edge' : 'local_inference',
      summarisation: null,
    };
  }
  const host = caps(v.provider)?.host ?? 'local_inference';
  return { ...hostDefaults(host), summarisation: null };
}
