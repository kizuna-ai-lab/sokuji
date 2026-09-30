import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { CHECK_TIMEOUT_MS, createOpenAIModelCheck, OPENAI_MODELS_URL } from './openaiModels';
import type { CheckContext } from './types';

const KEY = 'sk-proj-modelsKey0123456789';
const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'en', target: 'ja' }, legs: ['speaker'], signal });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const listing = (...models: Array<[string, number]>) => json({ object: 'list', data: models.map(([id, created]) => ({ id, object: 'model', created, owned_by: 'system' })) });
const FAMILY = { keep: (id: string) => id.startsWith('gpt-live-'), none: { code: 'no_family_model', reason: 'This key lists no family model.' } };

describe("OpenAI's model-list check, lifted at its third user (Stage 2 OpenAI Live, choice 4)", () => {
  it('GETs the list with the key as a Bearer token, never in the URL, and keeps the family alone, newest first, each id once', async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime', 3], ['gpt-live-1', 1], ['gpt-live-2026-10-01', 2], ['gpt-live-1', 1]));
    await expect(createOpenAIModelCheck(FAMILY, { fetch, clock: createVirtualClock(0) })(KEY, ctx())).resolves.toEqual({ ok: true, models: [{ id: 'gpt-live-2026-10-01' }, { id: 'gpt-live-1' }] });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENAI_MODELS_URL);
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${KEY}` } });
  });

  it("answers a list with none of the family in the family's own code and words", async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime', 3]));
    await expect(createOpenAIModelCheck(FAMILY, { fetch, clock: createVirtualClock(0) })(KEY, ctx())).resolves.toEqual({ ok: false, code: 'no_family_model', reason: 'This key lists no family model.' });
  });

  it('reads a region, a refused key and a rate limit as codes; any other status throws', async () => {
    const answer = (status: number, body: unknown = { error: { message: 'said' } }) => createOpenAIModelCheck(FAMILY, { fetch: vi.fn(async () => json(body, status)), clock: createVirtualClock(0) })(KEY, ctx());
    await expect(answer(403, { error: { message: 'no', code: 'unsupported_country_region_territory' } })).resolves.toMatchObject({ ok: false, code: 'region_unsupported', reason: 'HTTP 403: no' });
    await expect(answer(401)).resolves.toMatchObject({ ok: false, code: 'auth', reason: 'HTTP 401: said' });
    await expect(answer(403)).resolves.toMatchObject({ ok: false, code: 'auth' });
    await expect(answer(429)).resolves.toMatchObject({ ok: false, code: 'rate_limit' });
    await expect(answer(503)).rejects.toThrow('OpenAI answered the model list with HTTP 503.');
  });

  it(`gives up after ${CHECK_TIMEOUT_MS / 1000} s in its own words`, async () => {
    const clock = createVirtualClock(0);
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const checking = createOpenAIModelCheck(FAMILY, { fetch, clock })(KEY, ctx());
    clock.advance(CHECK_TIMEOUT_MS);
    await expect(checking).rejects.toThrow(`OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`);
  });
});
