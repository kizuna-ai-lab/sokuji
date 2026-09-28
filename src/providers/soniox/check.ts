/**
 * Soniox's readiness (spec: "Readiness is one check"): the old
 * temporary-key probe (`SonioxClient.ts:305-346`) against the key's own
 * region, bounded by its own timeout and the caller's signal (choice 10).
 * The settings side: not reached by the adapter, so it may use the real
 * clock by default.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import { boundedFetch } from '../../lib/provider/boundedFetch';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { sonioxHosts } from '../../lib/soniox/regions';
import type { SonioxCredentials, SonioxSettings } from './settings';

/** As long as the sibling REST calls wait (`SonioxVoicesClient`'s 15 s). */
export const CHECK_TIMEOUT_MS = 15_000;

export interface SonioxCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

export function createSonioxCheck(deps: SonioxCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return (k: SonioxCredentials, _s: SonioxSettings, ctx: CheckContext): Promise<CheckResult> => {
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const late = `Soniox did not answer the key check within ${CHECK_TIMEOUT_MS / 1000} s.`;
    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
      const response = await doFetch(`https://${sonioxHosts(k.region).api}/v1/auth/temporary-api-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${k.stt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 }),
        signal,
      });
      if (response.status === 200 || response.status === 201) return { ok: true };
      if (response.status === 401 || response.status === 403) {
        // A key probed on another region's host answers 401 too: the region is part of the words.
        return { ok: false, code: 'auth', reason: `HTTP ${response.status}: Soniox did not accept this key for the ${k.region.toUpperCase()} region` };
      }
      throw new Error(`Soniox answered the key check with HTTP ${response.status}.`);
    });
  };
}

export const checkSoniox = createSonioxCheck();
