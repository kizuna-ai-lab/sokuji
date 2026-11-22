// src/providers/geminiKey.ts
//
// Gemini Live and Gemini's text models use one key, kept where Gemini has always kept it (spec 2026-11-22 §2): a key
// already saved for Gemini serves both, with nothing to move.
export const GEMINI_KEY_STORED_AT = { key: 'gemini', fallbacks: [] } as const;
