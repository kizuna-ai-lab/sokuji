/**
 * An OpenAI key's readiness for one family of models: the model list, as
 * OpenAI Translate's and OpenAI Realtime's checks each read it, lifted at its
 * third user, OpenAI Live (Stage 2 OpenAI Live, ruling 9; choice 4). The
 * request is bounded by `CHECK_TIMEOUT_MS` and the caller's signal
 * (`boundedFetch`); the key rides in the `Authorization` header, never the
 * URL; a region OpenAI does not serve, a refused key (a restricted project
 * key's 403 among them) and a rate limit answer a code the surfaces put into
 * words, and a status the key does not explain (a 404, a 5xx) or a failed
 * fetch throws. A family with no model listed answers its provider's own
 * code. The settings side: no session code runs it, so it may use the real
 * clock by default.
 */
import { realClock, type Clock } from '../contract/clock';
import { boundedFetch } from './boundedFetch';
import type { CheckContext, CheckResult } from './types';

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
/** As long as the other checks wait. */
export const CHECK_TIMEOUT_MS = 15_000;

interface ModelList { data?: Array<{ id?: unknown; created?: unknown }> }
interface ErrorBody { error?: { message?: unknown; code?: unknown } }

/** Which models make a key ready, and the refusal when it lists none. */
export interface ModelFamily {
  keep(id: string): boolean;
  none: { code: string; reason: string };
}

export interface OpenAIModelCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

/** The family's models this key lists, newest first — each id once, the id breaking a tie — or why not. */
export function createOpenAIModelCheck(family: ModelFamily, deps: OpenAIModelCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return (apiKey: string, ctx: CheckContext): Promise<CheckResult> => {
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const late = `OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`;
    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal });
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
        .flatMap((m) => (typeof m.id === 'string' && family.keep(m.id) ? [{ id: m.id, created: typeof m.created === 'number' ? m.created : 0 }] : []))
        .sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const ids = [...new Set(models.map((m) => m.id))];
      if (ids.length === 0) return { ok: false, ...family.none };
      return { ok: true, models: ids.map((id) => ({ id })) };
    });
  };
}
