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

/** The stages a text model serves: the translation, a run stage; the notes, which are not one. */
export type TextModelStage = 'translation' | 'notes';

/**
 * The models chosen when the user has chosen none, in order of preference: fast, cheap, and good enough for a
 * sentence's translation (measured 2026-11-22). The first one the service lists wins.
 */
export const TEXT_MODEL_PREFERENCES: Readonly<Record<Exclude<TextModelService, 'compatible'>, readonly string[]>> = {
  openai: ['gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini'],
  gemini: ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'],
};

/**
 * The notes' own preferences (text models, part C): a meeting's notes are worth a stronger model than a sentence's
 * translation, and they are not written in real time. OpenAI's first is the model the notes were written with before
 * they could be chosen per service (the old setting's default, the one the notes were measured with on OpenAI's own
 * endpoint), so a user who never chose another still writes with it; then the translation's. Gemini's: its stronger
 * flash model first, then the translation's.
 */
export const NOTES_MODEL_PREFERENCES: Readonly<Record<Exclude<TextModelService, 'compatible'>, readonly string[]>> = {
  openai: ['gpt-6-luna', ...TEXT_MODEL_PREFERENCES.openai],
  gemini: ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'],
};

/**
 * The first preferred model among `ids` for `stage`, or null: none of them is listed, or the service is a compatible
 * one.
 */
export function defaultTextModel(service: TextModelService, ids: readonly string[], stage: TextModelStage = 'translation'): string | null {
  if (service === 'compatible') return null;
  const preferences = stage === 'notes' ? NOTES_MODEL_PREFERENCES : TEXT_MODEL_PREFERENCES;
  return preferences[service].find((id) => ids.includes(id)) ?? null;
}
