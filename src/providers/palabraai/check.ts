/**
 * Palabra AI's readiness (spec: "Readiness is one check"; ruling 1): the
 * REST session list the old validation read (`PalabraAIClient.ts:215-273`),
 * with the credentials of either mode in its headers. It creates nothing
 * and bills nothing. Not the socket: a wrong key there is a bare 403 on the
 * upgrade, which a browser sees only as a failed socket (the owner's probe).
 * Bounded by `CHECK_TIMEOUT_MS` and the caller's signal; a status the
 * credentials do not explain, or a failed fetch, throws — the store answers
 * "could not find out", where the old called every failure a bad key. The
 * settings side: not reached by the adapter, so it may use the real clock
 * by default.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import { boundedFetch } from '../../lib/provider/boundedFetch';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import type { PalabraCredentials, PalabraSettings } from './settings';
import { restHeaders, restWords, SESSIONS_URL } from './wire';

/** As long as every other provider's check waits. */
export const CHECK_TIMEOUT_MS = 15_000;

export interface PalabraCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

export function createPalabraCheck(deps: PalabraCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return (k: PalabraCredentials, _s: PalabraSettings, ctx: CheckContext): Promise<CheckResult> => {
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const late = `Palabra did not answer the credential check within ${CHECK_TIMEOUT_MS / 1000} s.`;
    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
      const response = await doFetch(SESSIONS_URL, { method: 'GET', headers: { Accept: 'application/json', ...restHeaders(k) }, signal });
      if (response.ok) return { ok: true };
      const body: unknown = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', reason: restWords(response.status, body, 'Palabra did not accept these credentials.') };
      if (response.status === 429) return { ok: false, code: 'rate_limit', reason: restWords(response.status, body, 'Palabra is limiting requests.') };
      throw new Error(`Palabra answered the credential check with HTTP ${response.status}.`);
    });
  };
}

export const checkPalabra = createPalabraCheck();
