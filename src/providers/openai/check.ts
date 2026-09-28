/**
 * OpenAI Realtime's readiness (spec: "Readiness is one check"): the model
 * list the old validation read (`OpenAIClient.ts:140-336`), with three
 * changes (choice 16) — the request is bounded (`boundedFetch`, choice 2);
 * a status the key does not explain (a 404, a 5xx) or a failed fetch
 * throws, where the old one called every failure an invalid key; and a
 * refusal answers a code the surfaces put into words. The key rides in the
 * `Authorization` header, never the URL. It reads no setting (ruling 9:
 * `checkReads: []`). The settings side: not reached by the adapter, so it
 * may use the real clock by default.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import { boundedFetch } from '../../lib/provider/boundedFetch';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { isRealtimeModelId, type RealtimeCredentials, type RealtimeSettings } from './settings';

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
/** As long as the other checks wait. */
export const CHECK_TIMEOUT_MS = 15_000;

interface ModelList { data?: Array<{ id?: unknown; created?: unknown }> }
interface ErrorBody { error?: { message?: unknown; code?: unknown } }

export interface RealtimeCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

export function createRealtimeCheck(deps: RealtimeCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return (k: RealtimeCredentials, _s: RealtimeSettings, ctx: CheckContext): Promise<CheckResult> => {
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const late = `OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`;
    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${k.apiKey}` }, signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        const said = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'OpenAI did not accept this key.';
        const reason = `HTTP ${response.status}: ${said}`;
        // A region OpenAI does not serve reads as such, whatever the status (`OpenAIClient.ts:170-179`).
        if (body.error?.code === 'unsupported_country_region_territory') return { ok: false, code: 'region_unsupported', reason };
        // A restricted project key's 403 reads as a refused key, as the old validation did (ruling 17).
        if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', reason };
        if (response.status === 429) return { ok: false, code: 'rate_limit', reason };
        throw new Error(`OpenAI answered the model list with HTTP ${response.status}.`);
      }
      const body = (await response.json()) as ModelList;
      const models = (body.data ?? [])
        .flatMap((m) => (typeof m.id === 'string' && isRealtimeModelId(m.id) ? [{ id: m.id, created: typeof m.created === 'number' ? m.created : 0 }] : []))
        // Newest first, as the old list sorted them (`OpenAIClient.ts:329-335`); the id breaks a tie.
        .sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // Each id once: a readiness answer's models are keyed by id.
      const ids = [...new Set(models.map((m) => m.id))];
      if (ids.length === 0) return { ok: false, code: 'no_realtime_model', reason: 'This key lists no gpt-realtime model.' };
      return { ok: true, models: ids.map((id) => ({ id })) };
    });
  };
}

export const checkRealtime = createRealtimeCheck();
