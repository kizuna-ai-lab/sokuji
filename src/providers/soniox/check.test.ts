import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { createSonioxCheck } from './check';
import { SONIOX_DEFAULTS, type SonioxCredentials } from './settings';

const K: SonioxCredentials = { region: 'eu', stt: 'k-eu', tts: 'k-eu' };
const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal });

/** A fetch stub that rejects once its own request `signal` aborts — with the
 *  signal's own abort reason, as a real `fetch` does, falling back to a bare
 *  AbortError when none was given (an unreasoned abort). */
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

/** A virtual clock whose `setTimeout` cancel functions are spied, so a test can prove a timer was actually cancelled rather than merely left to fire harmlessly. */
function trackedClock(): { clock: Pick<Clock, 'setTimeout'>; advance: (ms: number) => void; cancelSpies: ReturnType<typeof vi.fn>[] } {
  const inner = createVirtualClock(0);
  const cancelSpies: ReturnType<typeof vi.fn>[] = [];
  return {
    clock: {
      setTimeout: (fn, ms) => {
        const spy = vi.fn(inner.setTimeout(fn, ms));
        cancelSpies.push(spy);
        return spy;
      },
    },
    advance: inner.advance,
    cancelSpies,
  };
}

describe('createSonioxCheck', () => {
  it("POSTs a 60-second temporary-key request for the key, at the key's region", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const check = createSonioxCheck({ fetch, clock: createVirtualClock(0) });
    await check(K, SONIOX_DEFAULTS, ctx());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.eu.soniox.com/v1/auth/temporary-api-key');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer k-eu', 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('200 and 201 answer ready, with no models', async () => {
    for (const status of [200, 201]) {
      const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
      const check = createSonioxCheck({ fetch, clock: createVirtualClock(0) });
      await expect(check(K, SONIOX_DEFAULTS, ctx())).resolves.toEqual({ ok: true });
    }
  });

  it('401 and 403 answer not ready, with the auth code', async () => {
    for (const status of [401, 403]) {
      const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
      const check = createSonioxCheck({ fetch, clock: createVirtualClock(0) });
      await expect(check(K, SONIOX_DEFAULTS, ctx())).resolves.toEqual({
        ok: false,
        code: 'auth',
        reason: expect.stringContaining(`HTTP ${status}`),
      });
    }
  });

  it('any other status throws: it could not find out', async () => {
    for (const status of [500, 429]) {
      const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
      const check = createSonioxCheck({ fetch, clock: createVirtualClock(0) });
      await expect(check(K, SONIOX_DEFAULTS, ctx())).rejects.toThrow(new RegExp(`HTTP ${status}`));
    }
  });

  it('a network failure throws', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const check = createSonioxCheck({ fetch, clock: createVirtualClock(0) });
    await expect(check(K, SONIOX_DEFAULTS, ctx())).rejects.toThrow(/Failed to fetch/);
  });

  it('bounds its own request: no answer within 15 s throws, and aborts the request', async () => {
    const { clock, advance } = trackedClock();
    const { fetch, aborted } = abortableFetchStub();
    const check = createSonioxCheck({ fetch, clock });
    const answer = check(K, SONIOX_DEFAULTS, ctx());
    const settled = vi.fn();
    answer.then(settled, settled);

    advance(14_999);
    // Read before the rejection could land: a bound shorter than 15 s has already aborted by now.
    expect(aborted()).toBe(false);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    advance(1);
    await expect(answer).rejects.toThrow(/did not answer.*15 s/);
    expect(aborted()).toBe(true);
  });

  it("the start's signal aborts the request", async () => {
    const { clock, advance, cancelSpies } = trackedClock();
    const { fetch, aborted } = abortableFetchStub();
    const check = createSonioxCheck({ fetch, clock });
    const c = new AbortController();
    const answer = check(K, SONIOX_DEFAULTS, ctx(c.signal));
    c.abort(new Error('cancelled'));
    await expect(answer).rejects.toThrow(/cancelled/);
    expect(aborted()).toBe(true);
    // The check's own 15 s timer was cancelled, not merely left to fire.
    expect(cancelSpies[0]).toHaveBeenCalled();
    advance(20_000);
  });

  it('an already aborted signal throws before any request', async () => {
    const fetch = vi.fn();
    const c = new AbortController();
    c.abort(new Error('nope'));
    const check = createSonioxCheck({ fetch, clock: createVirtualClock(0) });
    await expect(check(K, SONIOX_DEFAULTS, ctx(c.signal))).rejects.toThrow(/nope/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
