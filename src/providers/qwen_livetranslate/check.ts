/**
 * Qwen LiveTranslate's readiness and storefront (spec 2026-10-13, §2): the
 * key is asked for a one-minute token at each storefront in turn. A 200
 * names the storefront — the token is never read: it expires on its own,
 * opens no session and costs nothing. A 401 or 403 moves on; refused by
 * both is `auth`, a 429 is `rate_limit`, and anything else throws: the check
 * could not tell. HTTPS, not the socket: a browser hides a refused upgrade's
 * status. CORS answers any origin, the extension's and `file://` included
 * (probe 2026-10-13). The settings side; the adapter runs `detectEndpoint`
 * only when its config names no storefront, handed in as a dependency, on
 * the request's clock and signal.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import { boundedFetch } from '../../lib/provider/boundedFetch';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { ENDPOINT_ORDER, ENDPOINTS, type EndpointId } from './endpoints';
import type { QwenCredentials, QwenSettings } from './settings';

/** As long as the other checks wait, per storefront. */
export const DETECT_TIMEOUT_MS = 15_000;

export interface DetectDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
  signal?: AbortSignal;
}

export type Detection = { endpoint: EndpointId } | { refused: string; code: 'auth' | 'rate_limit' };
export type DetectEndpoint = (apiKey: string, o: DetectDeps) => Promise<Detection>;

export const detectEndpoint: DetectEndpoint = async (apiKey, o) => {
  // Read at call time, so a test's stubbed global is seen.
  const doFetch = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const clock = o.clock ?? realClock;
  const late = `Qwen did not answer the key check within ${DETECT_TIMEOUT_MS / 1000} s.`;
  let status = 0;
  for (const id of ENDPOINT_ORDER) {
    status = await boundedFetch({ clock, ms: DETECT_TIMEOUT_MS, signal: o.signal, late }, async (signal) => {
      const response = await doFetch(`${ENDPOINTS[id].tokens}?expire_in_seconds=60`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, signal });
      return response.status;
    });
    if (status === 200) return { endpoint: id };
    if (status === 429) return { refused: `${ENDPOINTS[id].name} is limiting requests (HTTP 429).`, code: 'rate_limit' };
    if (status !== 401 && status !== 403) throw new Error(`Qwen answered the key check with HTTP ${status}.`);
  }
  return { refused: `Neither QwenCloud nor 千问云 accepted this key (HTTP ${status}).`, code: 'auth' };
};

export function createQwenCheck(deps: Omit<DetectDeps, 'signal'> = {}) {
  return async (k: QwenCredentials, _s: QwenSettings, ctx: CheckContext): Promise<CheckResult> => {
    const found = await detectEndpoint(k.apiKey, { ...deps, signal: ctx.signal });
    // The one model entry names the storefront: `build` reads it from `shared.models`, the settings view from `models`.
    return 'endpoint' in found ? { ok: true, models: [{ id: found.endpoint }] } : { ok: false, reason: found.refused, code: found.code };
  };
}

export const checkQwen = createQwenCheck();
