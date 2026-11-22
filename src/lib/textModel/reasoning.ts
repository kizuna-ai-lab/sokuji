// src/lib/textModel/reasoning.ts
//
// How much a text model is asked to reason. A reasoning model left at its own default can spend every token of a
// short answer on reasoning and answer nothing (measured 2026-11-22: gpt-5-nano with 400 tokens and no effort came
// back empty), and a translation of one sentence wants no reasoning at all. So the lowest effort each model takes is
// asked for, and a model that does not reason is sent none: it refuses the member.

import type { TextModelService } from './client';

/**
 * Models that take a `reasoning_effort` of 'none': GPT-5.1 and later. Any other model is sent none by the notes, and
 * uses its own default: an older reasoning model refuses 'none', a model without reasoning refuses the field at all.
 */
export function takesReasoningEffort(model: string): boolean {
  return /^gpt-(?:5\.[1-9]\d*|[6-9]|\d{2,})(?:[.-]|$)/.test(model);
}

/** Listed models that refuse `reasoning_effort: 'none'` (as tried on the service): they get their lowest, 'low'. */
const REFUSE_NONE: readonly string[] = ['gpt-6-astra', 'gpt-6.1-sol'];

/** Whether `model` is one of the listed models that refuse 'none', a dated snapshot of one included. */
export function refusesNone(model: string): boolean {
  return REFUSE_NONE.some((m) => model === m || model.startsWith(`${m}-`));
}

/** OpenAI's GPT-5, mini and nano, and their dated snapshots: they reason, and take 'minimal' at the least. */
const GPT5 = /^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/;
/** OpenAI's o-series: they reason, and take 'low' at the least. */
const O_SERIES = /^o\d(?:-|$)/;

/**
 * The `reasoning_effort` that asks `model` for the least reasoning it takes, or null to send none. OpenAI: 'minimal'
 * for GPT-5, mini and nano; 'none' for GPT-5.1 and later ('low' for the listed models that refuse 'none'); 'low' for
 * the o-series; none for a model that does not reason. Gemini: 'none'. A compatible service: none sent. A service that refuses
 * the value is asked again by the client, with 'low', then with none.
 */
export function lowestReasoningEffort(service: TextModelService, model: string): string | null {
  // A compatible service's model is unknown: an unexpected member may fail every request, so none is sent.
  if (service === 'compatible') return null;
  if (service !== 'openai') return 'none';
  if (GPT5.test(model)) return 'minimal';
  if (takesReasoningEffort(model)) return refusesNone(model) ? 'low' : 'none';
  if (O_SERIES.test(model)) return 'low';
  return null;
}
