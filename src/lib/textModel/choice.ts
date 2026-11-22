// src/lib/textModel/choice.ts
//
// What the user chose for one stage a text model serves (the translation now, the notes later): a model and how
// much it reasons. Each is a choice from a list plus a value typed by hand, and the typed one wins when it is filled:
// a service may list models it refuses, list none at all (a compatible one), or take a reasoning value no list of
// ours holds. Stored per provider and per stage (`translationModel`, `translationReasoning`), so another stage only
// adds its own pair.

import type { ReasoningAsk, TextModelService } from './client';
import { defaultTextModel } from './models';
import { lowestReasoningEffort } from './reasoning';

/** A model chosen from the service's list (`''`: the default), and a model's name typed by hand (`''`: none). */
export interface ModelChoice { listed: string; typed: string }

/** The reasoning levels offered in the list, in its order. */
export const REASONING_LEVELS = ['off', 'lowest', 'low', 'medium', 'high'] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** A reasoning level from the list, and a value typed by hand (`''`: none), sent as it is when filled. */
export interface ReasoningChoice { level: ReasoningLevel; typed: string }

export const DEFAULT_MODEL_CHOICE: ModelChoice = { listed: '', typed: '' };
/** The least reasoning the model takes: a sentence's translation wants none, and a reasoning model is slow otherwise. */
export const DEFAULT_REASONING_CHOICE: ReasoningChoice = { level: 'lowest', typed: '' };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** What was stored, made valid: anything that is not a choice is the default. */
export function modelChoiceOf(stored: unknown): ModelChoice {
  if (!isRecord(stored)) return { ...DEFAULT_MODEL_CHOICE };
  return { listed: text(stored.listed), typed: text(stored.typed) };
}

/** What was stored, made valid: a level the list does not hold is the default's. */
export function reasoningChoiceOf(stored: unknown): ReasoningChoice {
  if (!isRecord(stored)) return { ...DEFAULT_REASONING_CHOICE };
  const level = (REASONING_LEVELS as readonly unknown[]).includes(stored.level) ? (stored.level as ReasoningLevel) : DEFAULT_REASONING_CHOICE.level;
  return { level, typed: text(stored.typed) };
}

/**
 * The model asked for: the typed name when it is filled; else the one chosen from the list; else the service's
 * default among `ids` (its text models, in the service's order): the first preferred one listed, or the first listed.
 * A compatible service has no default: nothing is known of its names, so its model is chosen or typed. Null: none.
 */
export function modelToUse(service: TextModelService, choice: ModelChoice, ids: readonly string[]): string | null {
  const typed = choice.typed.trim();
  if (typed !== '') return typed;
  if (choice.listed !== '') return choice.listed;
  return automaticModel(service, ids);
}

/** The model the list's "automatic" stands for: the service's preferred one it lists, else its first text model. Null for a compatible service. */
export function automaticModel(service: TextModelService, ids: readonly string[]): string | null {
  if (service === 'compatible') return null;
  return defaultTextModel(service, ids) ?? ids[0] ?? null;
}

/**
 * What the client is asked for: the typed value, sent as it is, when filled; 'lowest' for the lowest, which the
 * client lowers further when the service refuses it; otherwise the level's own value, sent exactly: Off is 'none'.
 */
export function reasoningAskOf(choice: ReasoningChoice): Exclude<ReasoningAsk, 'default'> {
  const typed = choice.typed.trim();
  if (typed !== '') return { exact: typed };
  if (choice.level === 'lowest') return 'lowest';
  return { exact: choice.level === 'off' ? 'none' : choice.level };
}

/** The tokens one answer may take before any reasoning: a long sentence's translation, with room to spare. */
export const ANSWER_TOKENS = 1024;

/**
 * The tokens one answer may take, reasoning included (OpenAI counts a model's reasoning in its budget): the answer's
 * own, and more the more the model is asked to reason. A compatible service asked for its lowest is sent no value,
 * so its model reasons as it does by default: it gets the room of a medium effort.
 */
export function maxTokensFor(service: TextModelService, model: string, ask: Exclude<ReasoningAsk, 'default'>): number {
  const effort = ask === 'lowest' ? (service === 'compatible' ? 'medium' : lowestReasoningEffort(service, model)) : ask.exact;
  switch (effort) {
    case null:
    case 'none':
    case 'minimal':
      return ANSWER_TOKENS;
    case 'low':
      return ANSWER_TOKENS * 2;
    case 'medium':
      return ANSWER_TOKENS * 4;
    default:
      // High, or a value typed by hand: the most a short answer could need.
      return ANSWER_TOKENS * 8;
  }
}

/** OpenAI's models that reason: they refuse a temperature other than their own. */
const OPENAI_REASONS = /^(?:gpt-5|gpt-[6-9]|gpt-\d{2,}|o\d)(?:[.-]|$)/;
/** Gemini's models before 3 and Gemma: Google asks that Gemini 3 and later keep their own temperature. */
const GEMINI_TAKES_TEMPERATURE = /^(?:gemini-[12](?:[.-]|$)|gemma-)/;

/** How steady a translation is asked to be, where it is safe to say so. */
export const TRANSLATION_TEMPERATURE = 0.2;

/**
 * The temperature a translation is sent, or undefined to send none: only to a model known to take one. OpenAI's
 * models that do not reason (gpt-4.x, gpt-4o, a `-chat-` model); Gemini before 3, and Gemma. A compatible service's
 * model is unknown, and may refuse it: none.
 */
export function translationTemperature(service: TextModelService, model: string): number | undefined {
  if (service === 'openai') return OPENAI_REASONS.test(model) && !model.includes('-chat') ? undefined : TRANSLATION_TEMPERATURE;
  if (service === 'gemini') return GEMINI_TAKES_TEMPERATURE.test(model) ? TRANSLATION_TEMPERATURE : undefined;
  return undefined;
}
