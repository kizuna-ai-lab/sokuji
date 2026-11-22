// src/lib/notes/textModelChat.ts
//
// The notes written by a text model with the user's own key (text models, part C): the chat port over the shared
// client (`src/lib/textModel/client.ts`), for OpenAI, Gemini and a compatible service alike. The notes' prompts and
// payloads are the ones every notes service is sent: a system prompt, the user's part as compact JSON, a JSON object
// back. Each call's reasoning and budget come from the user's choice for the notes (`notesRequest`).
//
// As the notes always did with the user's own key: a rate limit is waited out (15 s, then 30, 45, 60; on the clock
// given, the real one in the app), an account out of credit is not; anything else the service refuses comes back as a
// ChatError carrying the service's own words, final where another try cannot fix it. The client waits nothing out
// itself. One port is one run: what the model was found to refuse is kept across its calls.
import { realClock, type Clock } from '../contract/clock';
import type { ReasoningChoice } from '../textModel/choice';
import { chatCompletion, jsonObjectOf, type TextModelFailure, type TextModelMemo, type TextModelService, type TextModelTransport } from '../textModel/client';
import { notesRequest } from '../textModel/notes';
import { ChatError, RATE_LIMIT_WAITS, wait, type ChatPort } from './chat';

export interface TextModelNotesChatOptions {
  service: TextModelService;
  /** A compatible service's address; OpenAI and Gemini have their own. */
  baseUrl?: string;
  /** Absent: none is sent (a compatible service on this computer may need none). */
  apiKey?: string;
  model: string;
  /** The user's reasoning for the notes, per service. */
  reasoning: ReasoningChoice;
  /** How requests are sent; absent, the client's own for the service. */
  transport?: TextModelTransport;
  /** The clock a rate limit is waited out on; absent, the real one. */
  clock?: Pick<Clock, 'setTimeout'>;
}

/** A rate limit is waited out this long times the attempt, `RATE_LIMIT_WAITS` times at most. */
const RATE_LIMIT_WAIT_MS = 15_000;

/** The client's own words for a refusal the service gave none for: the notes say it by its status instead. */
const NO_WORDS = /^The service answered \d+\.$/;

/** The thinking a local reasoning model writes before its answer. */
const THINKING = /^\s*<think>[\s\S]*?(?:<\/think>|$)/i;

/**
 * A failure of the client as the notes say it: with the service's status, its own words and whether another try can
 * help (a refused key, model or value cannot; an account out of credit cannot); without one, a reason of the notes'
 * own (`network`, `timeout`, `no-answer`) or the words the client gave.
 */
function chatErrorOf(failure: TextModelFailure): ChatError {
  const { code, status, message } = failure;
  if (status !== undefined) {
    const final = code === 'auth' || code === 'quota' || code === 'model_missing';
    return new ChatError(`The notes model refused the request (${status})`, {
      status,
      ...(NO_WORDS.test(message) ? {} : { serviceMessage: message }),
      ...(final ? { retryable: false } : {}),
    });
  }
  if (code === 'network' || code === 'timeout') return new ChatError(message, { code });
  // An answer that could not be read: as the notes said of one before.
  if (code === 'server') return new ChatError(message, { code: 'no-answer' });
  // Refused before any request (a compatible service's address), or the model refused to answer: final, in words.
  return new ChatError(message, { serviceMessage: message, retryable: false });
}

/** The model's answer as the notes take it: a JSON object, from the whole text or from within it. */
function objectOf(text: string): object {
  const answer = text.replace(THINKING, '').trim();
  if (answer === '') throw new ChatError('The notes model gave no answer', { code: 'no-answer' });
  const value = jsonObjectOf(answer);
  if (!value) throw new ChatError('The notes model answered with something other than a JSON object', { code: 'not-json' });
  return value;
}

export function textModelNotesChat(o: TextModelNotesChatOptions): ChatPort {
  const clock = o.clock ?? realClock;
  /** What the model was found to refuse, for every call of this run. */
  const memo: TextModelMemo = {};
  return async (r) => {
    const { reasoning, maxTokens } = notesRequest(o.service, o.model, o.reasoning, { effort: r.effort, maxTokens: r.maxTokens });
    for (let waited = 0; ;) {
      const result = await chatCompletion({
        service: o.service,
        ...(o.baseUrl === undefined ? {} : { baseUrl: o.baseUrl }),
        ...(o.apiKey === undefined ? {} : { apiKey: o.apiKey }),
        signal: r.signal,
        ...(o.transport ? { transport: o.transport } : {}),
        model: o.model,
        messages: [{ role: 'system', content: r.system }, { role: 'user', content: JSON.stringify(r.user) }],
        maxTokens,
        json: true,
        reasoning,
        memo,
      });
      r.onAnswered?.(result.ok && result.id ? { requestId: result.id } : {});
      if (result.ok) return objectOf(result.text);
      if (result.failure.code === 'rate_limit' && waited < RATE_LIMIT_WAITS) {
        waited += 1;
        await wait(RATE_LIMIT_WAIT_MS * waited, r.signal, clock);
        continue;
      }
      throw chatErrorOf(result.failure);
    }
  };
}
