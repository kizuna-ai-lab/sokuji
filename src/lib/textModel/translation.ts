// src/lib/textModel/translation.ts
//
// One session of a text model translating another unit's source (spec §4): a job translator whose `translate` is one
// chat completion. Each job is told the session's system prompt, the last few stretches with their translations as
// earlier turns, then its own stretch. What the model was found to refuse is kept for the session (`memo`), so a
// refusal is met once. A refused key, a model the service does not know, or an account out of credit ends the leg,
// naming why; anything else fails that one job, in the service's words, and the next one runs.
//
// The session side of the three text-model providers (each one's `adapter.ts` starts it): no store, no reporter, and
// every timer on the request's clock (the job translator's).

import type { TranslationEvents, TranslationSession, TranslationStartRequest } from '../contract/translation';
import { describeCause } from '../diagnostics/describeCause';
import { createJobTranslator } from '../translation/jobTranslator';
import { chatCompletion, type ReasoningAsk, type TextModelFailure, type TextModelMemo, type TextModelService, type TextModelTransport } from './client';
import { translationMessages, translationOf } from './prompt';

/** One leg's translation: the model, how much it reasons, what it is told, and how long its answer may be. */
export interface TextModelTranslationConfig {
  model: string;
  reasoning: Exclude<ReasoningAsk, 'default'>;
  /** The session's system prompt, for the leg's direction. */
  system: string;
  maxTokens: number;
  /** Absent: none is sent, the model's own. */
  temperature?: number;
}

/** The key, where the service takes one; a compatible service's address. */
export interface TextModelCredentials {
  /** Absent or empty: no key is sent (a compatible service on this computer may need none). */
  apiKey?: string;
  /** A compatible service's address; OpenAI and Gemini have their own. */
  baseUrl?: string;
}

export interface TextModelSessionDeps {
  /** How requests are sent; absent, the client's own for the service. Tests hand a fake. */
  transport?: TextModelTransport;
}

/** A request that had no translation: the client's failure, kept whole for the job translator to judge. */
export class TextModelJobError extends Error {
  readonly failure: TextModelFailure;

  constructor(failure: TextModelFailure) {
    super(failure.message);
    this.name = 'TextModelJobError';
    this.failure = failure;
  }
}

/**
 * The failures that end the leg: the next job would meet them too. Said with their code, so the run's notice is the
 * service's own and leads to where it is fixed. A rate limit, the service's trouble, the network, a deadline and
 * any other refusal are one job's.
 */
export const FATAL_CODES: ReadonlySet<TextModelFailure['code']> = new Set(['auth', 'model_missing', 'quota']);

export function startTextModelTranslation(
  service: TextModelService,
  deps: TextModelSessionDeps,
  request: TranslationStartRequest<TextModelTranslationConfig, TextModelCredentials>,
  events: TranslationEvents,
): TranslationSession {
  const { clock, config, credentials, signal } = request;
  const { target } = request.context.direction;
  /** What this model was found to refuse, for every job of the session. */
  const memo: TextModelMemo = {};
  const apiKey = credentials.apiKey?.trim() || undefined;
  return createJobTranslator({
    events,
    clock,
    signal,
    language: target,
    async translate(text, job, context) {
      const result = await chatCompletion({
        service,
        ...(credentials.baseUrl === undefined ? {} : { baseUrl: credentials.baseUrl }),
        ...(apiKey === undefined ? {} : { apiKey }),
        signal: job,
        ...(deps.transport ? { transport: deps.transport } : {}),
        model: config.model,
        messages: translationMessages(config.system, text, context),
        maxTokens: config.maxTokens,
        reasoning: config.reasoning,
        memo,
        ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
      });
      if (!result.ok) throw new TextModelJobError(result.failure);
      return translationOf(result.text);
    },
    failureMessage: (error) => (error instanceof TextModelJobError ? error.failure.message : describeCause(error)),
    fatal: (error) => (error instanceof TextModelJobError && FATAL_CODES.has(error.failure.code) ? { code: error.failure.code } : false),
  });
}
