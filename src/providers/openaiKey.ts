// src/providers/openaiKey.ts
//
// The three OpenAI providers (Realtime, Translate, Live) use one key, kept where
// OpenAI Realtime has always kept it (owner, 2026-11-15). A key stored only under
// one of the other two is still found when reading.
export const OPENAI_KEY_STORED_AT = { key: 'openai', fallbacks: ['openaiTranslate', 'openaiLive'] } as const;
