// src/lib/textModel/notes.ts
//
// What one notes request asks a text model for (text models, part C). The notes make several kinds of call (a part
// of the meeting, the finishing call, the names step, a live update), each with a reasoning level and a budget of
// its own, measured when the notes were written (`src/lib/notes/write.ts`, `live/loop.ts`). The user chooses one
// reasoning for the notes per service:
//
// - The default, Medium (no value typed), stands for those measured levels, the most of which is medium: each call
//   asks its own, lowered where the model refuses it ('low', then none). OpenAI is sent it as the notes always sent
//   it (only to the models that take a `reasoning_effort`), so a line-up that wrote notes before sends what it sent.
//   A compatible service is sent none: its model is unknown, and an unexpected member may fail every request.
// - Any other level, or a value typed (Medium typed included), is sent exactly, to every call; a refusal of it is
//   said by the readiness check before the notes are asked.
//
// The budget: each call's own, which already leaves its own level room (OpenAI counts reasoning in it), plus the
// room the translation leaves each level (`maxTokensFor`) beyond the call's own level, where more is asked.

import { ANSWER_TOKENS, isDefaultNotesReasoning, maxTokensFor, reasoningAskOf, type ReasoningChoice } from './choice';
import type { ReasoningAsk, TextModelService } from './client';
import { refusesNone, takesReasoningEffort } from './reasoning';

/** One notes call as the notes make it: its own reasoning level and its own budget. */
export interface NotesCall {
  effort: string;
  maxTokens: number;
}

/** The room each level is left beyond an answer's own (the translation's rule, `maxTokensFor`). */
export const NOTES_REASONING_ROOM = { none: 0, low: ANSWER_TOKENS, medium: ANSWER_TOKENS * 3, high: ANSWER_TOKENS * 7 } as const;

const roomOf = (service: TextModelService, model: string, ask: Exclude<ReasoningAsk, 'default'>) => maxTokensFor(service, model, ask) - ANSWER_TOKENS;

/**
 * The level the default sends a call, or null for none: OpenAI as the notes always did (the call's own level to the
 * models that take one, 'low' for 'none' to the listed ones that refuse it, nothing to any other); Gemini the call's
 * own; a compatible service nothing.
 */
function defaultEffort(service: TextModelService, model: string, effort: string): string | null {
  if (service === 'compatible') return null;
  if (service === 'gemini') return effort;
  if (!takesReasoningEffort(model)) return null;
  return effort === 'none' && refusesNone(model) ? 'low' : effort;
}

/** The reasoning and the budget of one notes call to `model` of `service`, with the notes' reasoning `choice`. */
export function notesRequest(service: TextModelService, model: string, choice: ReasoningChoice, call: NotesCall): { reasoning: ReasoningAsk; maxTokens: number } {
  const own = roomOf(service, model, { exact: call.effort });
  if (isDefaultNotesReasoning(choice)) {
    const effort = defaultEffort(service, model, call.effort);
    // A compatible service's model reasons as it likes when sent nothing: the room of a medium level, as the
    // translation leaves it.
    const room = service === 'compatible' ? roomOf(service, model, { exact: 'medium' }) : own;
    return { reasoning: effort === null ? 'default' : { preferred: effort }, maxTokens: call.maxTokens + Math.max(0, room - own) };
  }
  const ask = reasoningAskOf(choice);
  return { reasoning: ask, maxTokens: call.maxTokens + Math.max(0, roomOf(service, model, ask) - own) };
}
