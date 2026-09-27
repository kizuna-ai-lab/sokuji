import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { CHECK_TIMEOUT_MS, createGeminiCheck, GEMINI_MODELS_URL, MAX_MODEL_PAGES } from './check';
import { GEMINI_DEFAULTS } from './settings';

const K = { apiKey: 'AIzaTestKey0123456789' };
const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'en-US', target: 'ja-JP' }, legs: ['speaker'], signal });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const named = (...names: string[]) => names.map((name) => ({ name: `models/${name}` }));

/** A fetch stub that rejects once its request's `signal` aborts, with the signal's reason, as a real `fetch` does (Soniox's `check.test.ts` helper). */
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

/** A virtual clock whose cancel functions are spied: a stop proves its timer was cancelled, not merely left to fire. */
function spiedClock(): { clock: Pick<Clock, 'setTimeout'>; advance: (ms: number) => void; cancels: ReturnType<typeof vi.fn>[] } {
  const inner = createVirtualClock(0);
  const cancels: ReturnType<typeof vi.fn>[] = [];
  return {
    clock: { setTimeout: (fn, ms) => { const spy = vi.fn(inner.setTimeout(fn, ms)); cancels.push(spy); return spy; } },
    advance: inner.advance,
    cancels,
  };
}

describe("Gemini's key check", () => {
  it('GETs the model list with the key in the x-goog-api-key header, never in the URL (ruling 9)', async () => {
    const fetch = vi.fn(async () => json({ models: named('gemini-2.5-flash-native-audio-latest') }));
    await createGeminiCheck({ fetch, clock: createVirtualClock(0) })(K, GEMINI_DEFAULTS, ctx());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GEMINI_MODELS_URL);
    expect(url).not.toContain(K.apiKey);
    expect(init).toMatchObject({ method: 'GET', headers: { 'x-goog-api-key': K.apiKey } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads every page, and answers ready with the Live models, newest first', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ models: named('gemini-2.5-flash', 'gemini-2.0-flash-live-001', 'gemini-3.5-transcribe-live'), nextPageToken: 'p/2' }))
      .mockResolvedValueOnce(json({ models: named('gemini-3.5-live-translate-preview', 'gemini-2.5-flash-native-audio-preview-12-2025') }));
    const answer = await createGeminiCheck({ fetch, clock: createVirtualClock(0) })(K, GEMINI_DEFAULTS, ctx());
    expect(fetch.mock.calls[1][0]).toBe(`${GEMINI_MODELS_URL}?pageToken=p%2F2`);
    expect(answer).toEqual({ ok: true, models: [{ id: 'gemini-3.5-live-translate-preview' }, { id: 'gemini-2.5-flash-native-audio-preview-12-2025' }, { id: 'gemini-2.0-flash-live-001' }] });
  });

  it('reads at most ten pages, and lists an id the pages repeat once', async () => {
    const fetch = vi.fn(async () => json({ models: named('gemini-2.0-flash-live-001'), nextPageToken: 'again' }));
    const answer = await createGeminiCheck({ fetch, clock: createVirtualClock(0) })(K, GEMINI_DEFAULTS, ctx());
    expect(fetch).toHaveBeenCalledTimes(MAX_MODEL_PAGES);
    // One entry, not ten: the model select keys its options by id.
    expect(answer).toEqual({ ok: true, models: [{ id: 'gemini-2.0-flash-live-001' }] });
  });

  it("answers a refused key not ready with the auth code and Google's own words (400, 401, 403)", async () => {
    for (const status of [400, 401, 403]) {
      const fetch = vi.fn(async () => json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, status));
      await expect(createGeminiCheck({ fetch, clock: createVirtualClock(0) })(K, GEMINI_DEFAULTS, ctx()))
        .resolves.toEqual({ ok: false, code: 'auth', reason: `HTTP ${status}: API key not valid. Please pass a valid API key.` });
    }
    const bare = vi.fn(async () => new Response('', { status: 403 }));
    await expect(createGeminiCheck({ fetch: bare, clock: createVirtualClock(0) })(K, GEMINI_DEFAULTS, ctx()))
      .resolves.toEqual({ ok: false, code: 'auth', reason: 'HTTP 403: Gemini did not accept this key.' });
  });

  it('answers a key that lists no Live model not ready, in the old words (`no_realtime_model`)', async () => {
    const fetch = vi.fn(async () => json({ models: named('gemini-2.5-flash', 'gemini-3.5-transcribe-live') }));
    await expect(createGeminiCheck({ fetch, clock: createVirtualClock(0) })(K, GEMINI_DEFAULTS, ctx()))
      .resolves.toEqual({ ok: false, code: 'no_realtime_model', reason: 'This key lists no Gemini Live model.' });
  });

  it('throws on any other status, or a network failure: it could not find out', async () => {
    for (const status of [429, 500, 503]) {
      const fetch = vi.fn(async () => json({}, status));
      await expect(createGeminiCheck({ fetch, clock: createVirtualClock(0) })(K, GEMINI_DEFAULTS, ctx())).rejects.toThrow(`HTTP ${status}`);
    }
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(createGeminiCheck({ fetch: offline, clock: createVirtualClock(0) })(K, GEMINI_DEFAULTS, ctx())).rejects.toThrow('Failed to fetch');
  });

  it('bounds its own listing: no answer within 15 s throws, and aborts the request', async () => {
    const { clock, advance } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const answer = createGeminiCheck({ fetch, clock })(K, GEMINI_DEFAULTS, ctx());
    const settled = vi.fn();
    answer.then(settled, settled);
    advance(CHECK_TIMEOUT_MS - 1);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    advance(1);
    await expect(answer).rejects.toThrow(/did not answer.*15 s/);
    expect(aborted()).toBe(true);
  });

  it("the start's signal aborts the listing, and cancels its timer", async () => {
    const { clock, cancels } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const c = new AbortController();
    const answer = createGeminiCheck({ fetch, clock })(K, GEMINI_DEFAULTS, ctx(c.signal));
    c.abort(new Error('cancelled'));
    await expect(answer).rejects.toThrow('cancelled');
    expect(aborted()).toBe(true);
    expect(cancels[0]).toHaveBeenCalled();
  });

  it('an already aborted signal throws before any request', async () => {
    const fetch = vi.fn();
    await expect(createGeminiCheck({ fetch, clock: createVirtualClock(0) })(K, GEMINI_DEFAULTS, ctx(AbortSignal.abort(new Error('gone'))))).rejects.toThrow('gone');
    expect(fetch).not.toHaveBeenCalled();
  });
});
