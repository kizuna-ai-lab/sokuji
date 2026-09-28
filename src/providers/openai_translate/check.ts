/**
 * OpenAI Translate's readiness (spec: "Readiness is one check"): the model
 * list the old validation read (`OpenAIClient.ts:140-203`,
 * `OpenAITranslateGAClient.ts:224-257`), with three changes (choice 11) —
 * the request is bounded by `CHECK_TIMEOUT_MS` and the caller's signal; a
 * status the key does not explain (a 404, a 5xx) or a failed fetch throws,
 * where the old one called every failure an invalid key (survey §1.14.9);
 * and a refusal answers a code the surfaces put into words. The key rides in
 * the `Authorization` header, never the URL. The settings side: not reached
 * by the adapter, so it may use the real clock by default.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { isTranslateModelId, type TranslateCredentials, type TranslateSettings } from './settings';

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
/** As long as Soniox's, Gemini's and Doubao's checks wait. */
export const CHECK_TIMEOUT_MS = 15_000;

interface ModelList { data?: Array<{ id?: unknown; created?: unknown }> }
interface ErrorBody { error?: { message?: unknown; code?: unknown } }

export interface TranslateCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

export function createTranslateCheck(deps: TranslateCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return async (k: TranslateCredentials, _s: TranslateSettings, ctx: CheckContext): Promise<CheckResult> => {
    if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const controller = new AbortController();
    let timedOut = false;
    const cancel = clock.setTimeout(() => { timedOut = true; controller.abort(); }, CHECK_TIMEOUT_MS);
    const onAbort = () => controller.abort(ctx.signal?.reason);
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${k.apiKey}` }, signal: controller.signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        const said = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'OpenAI did not accept this key.';
        const reason = `HTTP ${response.status}: ${said}`;
        // A region OpenAI does not serve reads as such, whatever the status (`OpenAIClient.ts:170-179`).
        if (body.error?.code === 'unsupported_country_region_territory') return { ok: false, code: 'region_unsupported', reason };
        if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', reason };
        if (response.status === 429) return { ok: false, code: 'rate_limit', reason };
        throw new Error(`OpenAI answered the model list with HTTP ${response.status}.`);
      }
      const body = (await response.json()) as ModelList;
      const models = (body.data ?? [])
        .flatMap((m) => (typeof m.id === 'string' && isTranslateModelId(m.id) ? [{ id: m.id, created: typeof m.created === 'number' ? m.created : 0 }] : []))
        // Newest first, as the old list sorted them (`OpenAITranslateGAClient.ts:231-234`); the id breaks a tie.
        .sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // Each id once: a readiness answer's models are keyed by id.
      const ids = [...new Set(models.map((m) => m.id))];
      if (ids.length === 0) return { ok: false, code: 'no_translate_model', reason: 'This key lists no gpt-realtime-translate model.' };
      return { ok: true, models: ids.map((id) => ({ id })) };
    } catch (error) {
      if (timedOut) throw new Error(`OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`);
      throw error;
    } finally {
      cancel();
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  };
}

export const checkTranslate = createTranslateCheck();
