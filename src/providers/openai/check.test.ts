import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { CHECK_TIMEOUT_MS, createRealtimeCheck, OPENAI_MODELS_URL } from './check';
import { REALTIME_DEFAULTS } from './settings';

const K = { apiKey: 'sk-proj-checkKey0123456789' };
const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const listing = (...models: Array<[string, number]>) => json({ object: 'list', data: models.map(([id, created]) => ({ id, object: 'model', created, owned_by: 'system' })) });
const check = (fetch: typeof globalThis.fetch) => createRealtimeCheck({ fetch, clock: createVirtualClock(0) })(K, REALTIME_DEFAULTS, ctx());

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

describe("OpenAI Realtime's check (choice 16)", () => {
  it('GETs the model list with the key as a Bearer token, never in the URL', async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime-2.1-mini', 1_780_000_000]));
    await check(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENAI_MODELS_URL);
    expect(url).not.toContain(K.apiKey);
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${K.apiKey}` } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers ready with the voice-agent models alone — no transcription or translation family — newest first, each id once', async () => {
    const fetch = vi.fn(async () => listing(
      ['gpt-realtime-2.1-mini', 1_780_000_000],
      ['gpt-realtime-translate', 1_790_000_000],
      ['gpt-realtime-whisper', 1_790_000_001],
      ['gpt-realtime-2.1', 1_785_000_000],
      ['gpt-audio-1.5', 1_786_000_000],
      ['gpt-4o-realtime-preview', 1_700_000_000],
      ['gpt-realtime-mini', 1_760_000_000],
      ['gpt-realtime-2.1-mini', 1_780_000_000],
    ));
    await expect(check(fetch)).resolves.toEqual({ ok: true, models: [{ id: 'gpt-realtime-2.1' }, { id: 'gpt-realtime-2.1-mini' }, { id: 'gpt-realtime-mini' }] });
  });

  it("answers a key that reaches no voice-agent model not ready, in the old validation's words (`no_realtime_model`)", async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime-translate', 1], ['gpt-4o-mini', 2]));
    await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'no_realtime_model', reason: 'This key lists no gpt-realtime model.' });
    const empty = vi.fn(async () => json({ object: 'list' }));
    await expect(check(empty)).resolves.toMatchObject({ ok: false, code: 'no_realtime_model' });
  });

  it("answers a refused key — a restricted project key's 403 too (ruling 17) — not ready with the auth code and OpenAI's own words", async () => {
    for (const status of [401, 403]) {
      const fetch = vi.fn(async () => json({ error: { message: 'Incorrect API key provided: sk-proj-****6789.', type: 'invalid_request_error', code: 'invalid_api_key' } }, status));
      await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'auth', reason: `HTTP ${status}: Incorrect API key provided: sk-proj-****6789.` });
    }
    const bare = vi.fn(async () => new Response('', { status: 401 }));
    await expect(check(bare)).resolves.toEqual({ ok: false, code: 'auth', reason: 'HTTP 401: OpenAI did not accept this key.' });
  });

  it('answers a region OpenAI does not serve with its own code, whatever the status (`OpenAIClient.ts:170-179`)', async () => {
    for (const status of [403, 400]) {
      const fetch = vi.fn(async () => json({ error: { message: 'Country, region, or territory not supported', code: 'unsupported_country_region_territory' } }, status));
      await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'region_unsupported', reason: `HTTP ${status}: Country, region, or territory not supported` });
    }
  });

  it('answers a rate limit or a spent quota not ready with the rate_limit code', async () => {
    const fetch = vi.fn(async () => json({ error: { message: 'You exceeded your current quota.', code: 'insufficient_quota' } }, 429));
    await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'rate_limit', reason: 'HTTP 429: You exceeded your current quota.' });
  });

  it('throws on any other status, or a network failure: it could not find out', async () => {
    for (const status of [400, 404, 500, 503]) {
      const fetch = vi.fn(async () => json({ error: { message: 'nope' } }, status));
      await expect(check(fetch)).rejects.toThrow(`OpenAI answered the model list with HTTP ${status}.`);
    }
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(check(offline)).rejects.toThrow('Failed to fetch');
  });

  it('never answers with the key', async () => {
    const answers = await Promise.all([
      check(vi.fn(async () => listing(['gpt-realtime-2.1', 1]))),
      check(vi.fn(async () => new Response('', { status: 403 }))),
      check(vi.fn(async () => json({ error: { code: 'unsupported_country_region_territory' } }, 403))),
      check(vi.fn(async () => json({}, 429))),
    ]);
    expect(JSON.stringify(answers)).not.toContain(K.apiKey);
  });

  it('bounds its own request: no answer within 15 s throws, and aborts the request (choice 2)', async () => {
    const { clock, advance } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const answer = createRealtimeCheck({ fetch, clock })(K, REALTIME_DEFAULTS, ctx());
    const settled = vi.fn();
    answer.then(settled, settled);
    advance(CHECK_TIMEOUT_MS - 1);
    expect(aborted()).toBe(false);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    advance(1);
    await expect(answer).rejects.toThrow('OpenAI did not answer the model list within 15 s.');
    expect(aborted()).toBe(true);
  });

  it("the start's signal aborts the request, and cancels its timer", async () => {
    const { clock, cancels } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const c = new AbortController();
    const answer = createRealtimeCheck({ fetch, clock })(K, REALTIME_DEFAULTS, ctx(c.signal));
    c.abort(new Error('cancelled'));
    await expect(answer).rejects.toThrow('cancelled');
    expect(aborted()).toBe(true);
    expect(cancels[0]).toHaveBeenCalled();
  });

  it('an already aborted signal throws before any request', async () => {
    const fetch = vi.fn();
    await expect(createRealtimeCheck({ fetch, clock: createVirtualClock(0) })(K, REALTIME_DEFAULTS, ctx(AbortSignal.abort(new Error('gone'))))).rejects.toThrow('gone');
    expect(fetch).not.toHaveBeenCalled();
  });
});
