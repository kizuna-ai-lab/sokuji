// src/lib/textModel/models.ts
//
// Which of a service's models are chat text models, and which one is chosen when the user has chosen none. A model
// list is what the service answers to `GET …/models` (`listModels`): OpenAI's and Gemini's hold speech, image,
// embedding and realtime models beside the text ones, and a listed model may still be refused at use (Gemini lists
// models that are no longer available to new keys), so a model is only known usable once a request to it has worked.

import type { TextModelService } from './client';

/** OpenAI's chat text models: the GPT and o-series families, not the ones that do something else. */
const OPENAI_FAMILY = /^(?:gpt-|chatgpt-|o\d(?:-|$))/;
const OPENAI_OTHER = /transcribe|tts|search|codex|-pro(?:-|$)|image|audio|realtime|embedding|moderation|instruct|computer-use|deep-research/;
/** Gemini's text models: Gemini and Gemma, not the ones that do something else. */
const GEMINI_FAMILY = /^(?:gemini|gemma)-/;
const GEMINI_OTHER = /image|tts|embedding|audio|live|imagen|veo|aqa|robotics|computer-use/;

/**
 * The chat text models among `ids`, in their order, each once. A compatible service's list is kept as it is: nothing
 * is known of its names.
 */
export function textModelIds(service: TextModelService, ids: readonly string[]): string[] {
  const kept = ids.filter((id) => {
    if (service === 'openai') return OPENAI_FAMILY.test(id) && !OPENAI_OTHER.test(id);
    if (service === 'gemini') return GEMINI_FAMILY.test(id) && !GEMINI_OTHER.test(id);
    return true;
  });
  return [...new Set(kept)];
}

/**
 * The models chosen when the user has chosen none, in order of preference: fast, cheap, and good enough for a
 * sentence's translation (measured 2026-11-22). The first one the service lists wins.
 */
export const TEXT_MODEL_PREFERENCES: Readonly<Record<Exclude<TextModelService, 'compatible'>, readonly string[]>> = {
  openai: ['gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini'],
  gemini: ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'],
};

/** The first preferred model among `ids`, or null: none of them is listed, or the service is a compatible one. */
export function defaultTextModel(service: TextModelService, ids: readonly string[]): string | null {
  if (service === 'compatible') return null;
  return TEXT_MODEL_PREFERENCES[service].find((id) => ids.includes(id)) ?? null;
}
