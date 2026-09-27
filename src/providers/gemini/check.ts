/**
 * Gemini's readiness (spec: "Readiness is one check"): the Live models this
 * key reaches, listed as the old client listed them
 * (`GeminiClient.ts:204-233`), with three changes — the key rides in the
 * `x-goog-api-key` header, never the URL (ruling 9); the whole listing is
 * bounded by `CHECK_TIMEOUT_MS` and the caller's signal; at most
 * `MAX_MODEL_PAGES` pages are read (choice 5). The settings side: not
 * reached by the adapter, so it may use the real clock by default.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { isGeminiLiveModel, sortGeminiModels, type GeminiCredentials, type GeminiSettings } from './settings';

export const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** As long as Soniox's check waits (Stage 2 Soniox, choice 10). */
export const CHECK_TIMEOUT_MS = 15_000;
/** A listing longer than this is cut there: the Live models sit well inside it. */
export const MAX_MODEL_PAGES = 10;

interface ModelsPage { models?: Array<{ name?: unknown }>; nextPageToken?: unknown }

export interface GeminiCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

export function createGeminiCheck(deps: GeminiCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return async (k: GeminiCredentials, _s: GeminiSettings, ctx: CheckContext): Promise<CheckResult> => {
    if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const controller = new AbortController();
    let timedOut = false;
    const cancel = clock.setTimeout(() => { timedOut = true; controller.abort(); }, CHECK_TIMEOUT_MS);
    const onAbort = () => controller.abort(ctx.signal?.reason);
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const names: string[] = [];
      let token: string | undefined;
      for (let page = 0; page < MAX_MODEL_PAGES; page++) {
        const url = token ? `${GEMINI_MODELS_URL}?pageToken=${encodeURIComponent(token)}` : GEMINI_MODELS_URL;
        const response = await doFetch(url, { method: 'GET', headers: { 'x-goog-api-key': k.apiKey }, signal: controller.signal });
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          // Google answers a bad key with 400 INVALID_ARGUMENT and its own sentence, which `notices.auth` shows as the detail.
          const body = (await response.json().catch(() => ({}))) as { error?: { message?: unknown } };
          const words = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'Gemini did not accept this key.';
          return { ok: false, code: 'auth', reason: `HTTP ${response.status}: ${words}` };
        }
        if (!response.ok) throw new Error(`Gemini answered the model list with HTTP ${response.status}.`);
        const body = (await response.json()) as ModelsPage;
        for (const m of body.models ?? []) if (typeof m.name === 'string') names.push(m.name.replace(/^models\//, ''));
        token = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined;
        if (!token) break;
      }
      // Each id once, whatever the pages repeat: the model select keys its options by id.
      const live = sortGeminiModels([...new Set(names)].filter(isGeminiLiveModel));
      if (live.length === 0) return { ok: false, code: 'no_realtime_model', reason: 'This key lists no Gemini Live model.' };
      return { ok: true, models: live.map((id) => ({ id })) };
    } catch (error) {
      if (timedOut) throw new Error(`Gemini did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`);
      throw error;
    } finally {
      cancel();
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  };
}

export const checkGemini = createGeminiCheck();
