// src/lib/textModel/ids.ts
//
// The providers whose stage a text model serves (spec 2026-11-22 §2): OpenAI's text models, Gemini's, and a
// compatible service. Read where they are treated alike: the word list's row, the line-up card's state.

export const TEXT_MODEL_PROVIDERS = ['openai_text', 'gemini_text', 'openai_compatible'] as const;

/** Whether a provider (or a line-up's option) is a text model's. */
export function isTextModelProvider(id: string | null | undefined): boolean {
  return typeof id === 'string' && (TEXT_MODEL_PROVIDERS as readonly string[]).includes(id);
}
