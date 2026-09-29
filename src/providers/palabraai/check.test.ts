import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { CHECK_TIMEOUT_MS, createPalabraCheck } from './check';
import { PALABRA_DEFAULTS, type PalabraCredentials } from './settings';
import { SESSIONS_URL } from './wire';

const KEY: Extract<PalabraCredentials, { kind: 'apiKey' }> = { kind: 'apiKey', apiKey: 'plbr_checkKey0123456789abcdef' };
const APP: PalabraCredentials = { kind: 'app', clientId: 'check-client-id', clientSecret: 'check-client-secret' };
const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const check = (fetch: typeof globalThis.fetch, k: PalabraCredentials = KEY) => createPalabraCheck({ fetch, clock: createVirtualClock(0) })(k, PALABRA_DEFAULTS, ctx());

/** A fetch stub that rejects once its request's `signal` aborts, with the signal's reason, as a real `fetch` does. */
function abortableFetchStub() {
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
    });
  });
  return { fetch, aborted: () => !!signal?.aborted };
}

/** A virtual clock whose cancel functions are spied: a settled check proves its timer was cancelled, not merely left to fire. */
function spiedClock(): { clock: Pick<Clock, 'setTimeout'>; advance: (ms: number) => void; cancels: ReturnType<typeof vi.fn>[] } {
  const inner = createVirtualClock(0);
  const cancels: ReturnType<typeof vi.fn>[] = [];
  return {
    clock: { setTimeout: (fn, ms) => { const spy = vi.fn(inner.setTimeout(fn, ms)); cancels.push(spy); return spy; } },
    advance: inner.advance,
    cancels,
  };
}

describe("Palabra AI's check (ruling 1)", () => {
  it('lists the REST sessions with the key as a Bearer token, or the app pair as its headers — never in the URL', async () => {
    const fetch = vi.fn(async () => json({ ok: true, data: [] }));
    await check(fetch);
    await check(fetch, APP);
    const [[url, init], [, appInit]] = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(url).toBe(SESSIONS_URL);
    expect(url).not.toContain(KEY.apiKey);
    expect(init).toMatchObject({ method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${KEY.apiKey}` } });
    expect(appInit.headers).toEqual({ Accept: 'application/json', ClientId: 'check-client-id', ClientSecret: 'check-client-secret' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers ready for a list, whatever it holds: it reads nothing of it and creates nothing', async () => {
    await expect(check(vi.fn(async () => json({ ok: true, data: [{ id: 'x' }] })))).resolves.toEqual({ ok: true });
    await expect(check(vi.fn(async () => new Response('', { status: 200 })))).resolves.toEqual({ ok: true });
  });

  it("answers refused credentials not ready with the auth code and Palabra's own words (401, 403)", async () => {
    const fetch = vi.fn(async () => json({ ok: false, errors: [{ title: 'Unauthorized', detail: 'Invalid API key.' }] }, 401));
    await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'auth', reason: 'HTTP 401: Invalid API key.' });
    const forbidden = vi.fn(async () => json({ errors: [{ title: 'Forbidden resource' }] }, 403));
    await expect(check(forbidden, APP)).resolves.toEqual({ ok: false, code: 'auth', reason: 'HTTP 403: Forbidden resource' });
    const bare = vi.fn(async () => new Response('', { status: 401 }));
    await expect(check(bare)).resolves.toEqual({ ok: false, code: 'auth', reason: 'HTTP 401: Palabra did not accept these credentials.' });
  });

  it('answers a rate limit with its code', async () => {
    await expect(check(vi.fn(async () => json({}, 429)))).resolves.toEqual({ ok: false, code: 'rate_limit', reason: 'HTTP 429: Palabra is limiting requests.' });
  });

  it("throws on a status the credentials do not explain, or a failed fetch: it could not find out", async () => {
    await expect(check(vi.fn(async () => json({}, 500)))).rejects.toThrow('Palabra answered the credential check with HTTP 500.');
    await expect(check(vi.fn(async () => json({}, 404)))).rejects.toThrow('Palabra answered the credential check with HTTP 404.');
    const offline = new TypeError('Failed to fetch');
    await expect(check(vi.fn(async () => { throw offline; }))).rejects.toBe(offline);
  });

  it('bounds its request: still pending at 14 999 ms, the late words at 15 000 ms, the request aborted', async () => {
    const { clock, advance } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const answer = createPalabraCheck({ fetch, clock })(KEY, PALABRA_DEFAULTS, ctx());
    const settled = vi.fn();
    answer.then(settled, settled);
    advance(CHECK_TIMEOUT_MS - 1);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    advance(1);
    await expect(answer).rejects.toThrow('Palabra did not answer the credential check within 15 s.');
    expect(aborted()).toBe(true);
  });

  it("aborts with the caller's signal, cancels its timer, and throws the caller's reason before a request when already aborted", async () => {
    const { clock, cancels } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const caller = new AbortController();
    const reason = new Error('superseded');
    const answer = createPalabraCheck({ fetch, clock })(KEY, PALABRA_DEFAULTS, ctx(caller.signal));
    caller.abort(reason);
    await expect(answer).rejects.toBe(reason);
    expect(aborted()).toBe(true);
    expect(cancels[0]).toHaveBeenCalled();
    const never = vi.fn();
    await expect(createPalabraCheck({ fetch: never, clock })(KEY, PALABRA_DEFAULTS, ctx(AbortSignal.abort(reason)))).rejects.toBe(reason);
    expect(never).not.toHaveBeenCalled();
  });
});
