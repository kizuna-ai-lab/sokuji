// src/lib/textModel/check.ts
//
// A text-model provider's readiness: its model list, then one short request to the model each stage it serves would
// run, with the reasoning the user chose, so that whatever the service refuses (the key, the model, a reasoning
// value) is said before Start, in the service's own words. The stages: the translation, unless the plan gives the
// provider other run stages only (`stages`); the notes, when the check is told the provider writes them (`notes`).
// The list's text models are what the provider's options offer and what the build resolves the automatic model
// from. Bounded: 15 seconds for all the requests, and the caller's signal. A service not reached, or not answering
// in time, is no answer: the check throws, in the failure's words (`Provider.check` answers `ok: false` only for the
// service's no). The settings side: no session code runs it, so it may use the real clock by default.

import { realClock, type Clock } from '../contract/clock';
import type { CheckContext, CheckResult } from '../provider/types';
import { listModels, probeModel, textModelTimeout, type ReasoningAsk, type TextModelFailure, type TextModelService, type TextModelTransport } from './client';
import { modelToUse, notesProbeAsk, reasoningAskOf, type ModelChoice, type ReasoningChoice } from './choice';
import { textModelIds, type TextModelStage } from './models';
import type { TextModelCredentials } from './translation';

/** As long as the other checks wait. */
export const CHECK_TIMEOUT_MS = 15_000;

/** No model is chosen, and the service has no default for one: a compatible service's model is chosen or typed. */
export const TEXT_MODEL_UNSET = 'text_model_unset';

/** The stage settings a check reads: the translation's model and reasoning, and the notes'. */
export interface TextModelStageSettings {
  translationModel: ModelChoice;
  translationReasoning: ReasoningChoice;
  notesModel: ModelChoice;
  notesReasoning: ReasoningChoice;
}

/** The model a stage would run and the reasoning a probe asks it with. */
function stageAsk(stage: TextModelStage, s: TextModelStageSettings): { model: ModelChoice; reasoning: Exclude<ReasoningAsk, 'default'> } {
  return stage === 'notes'
    ? { model: s.notesModel, reasoning: notesProbeAsk(s.notesReasoning) }
    : { model: s.translationModel, reasoning: reasoningAskOf(s.translationReasoning) };
}

export interface TextModelCheckDeps {
  transport?: TextModelTransport;
  clock?: Pick<Clock, 'setTimeout'>;
}

/** The codes a refusal is said with. A deadline is the network's; every code here has words in every locale. */
const CODES: Readonly<Record<TextModelFailure['code'], string>> = {
  auth: 'auth',
  quota: 'quota',
  model_missing: 'model_missing',
  rate_limit: 'rate_limit',
  server: 'server',
  network: 'network',
  timeout: 'network',
  refused: 'refused',
};

/** The notice code a failure of the client is said with. */
export function failureNoticeCode(code: TextModelFailure['code']): string {
  return CODES[code];
}

/** The codes about the account a key belongs to: they name the provider, so the notice opens its row in Accounts and keys. */
const ACCOUNT = new Set(['auth', 'quota']);

/** The service's refusal as a check's answer: its code, and its own words. */
export function checkRefusal(providerId: string, failure: TextModelFailure): CheckResult {
  const code = CODES[failure.code];
  return { ok: false, code, reason: failure.message, ...(ACCOUNT.has(code) ? { params: { provider: providerId } } : {}) };
}

/** The failures that are no answer from the service: it was not reached, or did not answer in time. */
const UNANSWERED: ReadonlySet<TextModelFailure['code']> = new Set(['network', 'timeout']);

/** A failure as the check's answer: the service's refusal, said; no answer from it at all, thrown in its words. */
function refusedOrThrown(providerId: string, failure: TextModelFailure): CheckResult {
  if (UNANSWERED.has(failure.code)) throw new Error(failure.message);
  return checkRefusal(providerId, failure);
}

/** A signal that aborts with the caller's, or as a timeout once `ms` pass; and how to let its timer go. */
function bounded(clock: Pick<Clock, 'setTimeout'>, ms: number, caller: AbortSignal | undefined, late: string): { signal: AbortSignal; done(): void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(caller?.reason);
  if (caller?.aborted) onAbort();
  else caller?.addEventListener('abort', onAbort, { once: true });
  const cancel = clock.setTimeout(() => controller.abort(textModelTimeout(late)), ms);
  return { signal: controller.signal, done: () => { cancel(); caller?.removeEventListener('abort', onAbort); } };
}

/**
 * The check of one text-model provider. `name` is the service's name in the words of a deadline. A key or an
 * address that is missing never reaches here: the credentials' `read` says so first.
 */
export function createTextModelCheck(providerId: string, service: TextModelService, name: string, deps: TextModelCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return async (k: TextModelCredentials, s: TextModelStageSettings, ctx: CheckContext): Promise<CheckResult> => {
    const bound = bounded(clock, CHECK_TIMEOUT_MS, ctx.signal, `${name} did not answer within ${CHECK_TIMEOUT_MS / 1000} s.`);
    try {
      const apiKey = k.apiKey?.trim() || undefined;
      const where = {
        service,
        ...(k.baseUrl === undefined ? {} : { baseUrl: k.baseUrl }),
        ...(apiKey === undefined ? {} : { apiKey }),
        signal: bound.signal,
        ...(deps.transport ? { transport: deps.transport } : {}),
      };
      const listed = await listModels(where);
      if (!listed.ok) return refusedOrThrown(providerId, listed.failure);
      const ids = textModelIds(service, listed.ids);
      // The translation unless the plan gives this provider other run stages only; the notes when it writes them.
      const stages: TextModelStage[] = [
        ...(ctx.stages === undefined || ctx.stages.includes('translation') ? ['translation' as const] : []),
        ...(ctx.notes === true ? ['notes' as const] : []),
      ];
      /** What was asked already: the same model with the same reasoning is asked once. */
      const asked = new Set<string>();
      for (const stage of stages) {
        const { model: choice, reasoning } = stageAsk(stage, s);
        const model = modelToUse(service, choice, ids, stage);
        if (model === null) {
          return ids.length === 0 && service !== 'compatible'
            ? { ok: false, code: 'model_missing', reason: `${name} lists no text model for this key.` }
            : { ok: false, code: TEXT_MODEL_UNSET, reason: 'No model is chosen: choose one, or type its name.' };
        }
        const key = JSON.stringify([model, reasoning]);
        if (asked.has(key)) continue;
        asked.add(key);
        const probed = await probeModel({ ...where, model, reasoning });
        if (!probed.ok) return refusedOrThrown(providerId, probed.failure);
      }
      return { ok: true, models: ids.map((id) => ({ id })) };
    } finally {
      bound.done();
    }
  };
}
