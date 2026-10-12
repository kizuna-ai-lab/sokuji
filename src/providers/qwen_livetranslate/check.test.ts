import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { createQwenCheck, DETECT_TIMEOUT_MS, detectEndpoint } from './check';
import { ENDPOINTS, isEndpointId } from './endpoints';
import { QWEN_DEFAULTS } from './settings';

const K = { apiKey: 'sk-ws-T.ABCDEFGH.ijklmnop.QRSTUVWX0123456789' };
const ctx: CheckContext = { pair: { source: 'zh', target: 'en' }, legs: ['speaker'] };
const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const refused = () => answer(401, { code: 'InvalidApiKey', message: 'Invalid API-key provided.' });
const check = (fetch: typeof globalThis.fetch, c: CheckContext = ctx) => createQwenCheck({ fetch, clock: createVirtualClock(0) })(K, QWEN_DEFAULTS, c);
const urls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map((call) => (call as unknown as [string])[0]);

describe("Qwen LiveTranslate's storefronts", () => {
  it('are QwenCloud and 千问云, each a socket and a token endpoint on one host', () => {
    expect(ENDPOINTS).toEqual({
      intl: { name: 'QwenCloud', socket: 'wss://maas.qwencloudapi.com/api-ws/v1/realtime', tokens: 'https://maas.qwencloudapi.com/api/v1/tokens' },
      cn: { name: '千问云', socket: 'wss://maas.qianwenaiapi.com/api-ws/v1/realtime', tokens: 'https://maas.qianwenaiapi.com/api/v1/tokens' },
    });
    expect(isEndpointId('intl')).toBe(true);
    expect(isEndpointId('cn')).toBe(true);
    expect(isEndpointId('gpt-live-1')).toBe(false);
  });
});

describe("Qwen LiveTranslate's check (spec §2)", () => {
  it('a key QwenCloud mints a token for is international: one POST, the key in the header alone, the token never read', async () => {
    const fetch = vi.fn(async () => answer(200, { token: 'st-unread', expires_at: 1 }));
    await expect(check(fetch)).resolves.toEqual({ ok: true, models: [{ id: 'intl' }] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://maas.qwencloudapi.com/api/v1/tokens?expire_in_seconds=60');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: `Bearer ${K.apiKey}` } });
  });

  it('a key QwenCloud refuses and 千问云 accepts is mainland', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(refused()).mockResolvedValueOnce(answer(200, { token: 'st-unread' }));
    await expect(check(fetch)).resolves.toEqual({ ok: true, models: [{ id: 'cn' }] });
    expect(urls(fetch)).toEqual(['https://maas.qwencloudapi.com/api/v1/tokens?expire_in_seconds=60', 'https://maas.qianwenaiapi.com/api/v1/tokens?expire_in_seconds=60']);
  });

  it('a key both refuse — 401 or 403 — is not ready, as auth', async () => {
    await expect(check(vi.fn(async () => refused()))).resolves.toEqual({ ok: false, code: 'auth', reason: 'Neither QwenCloud nor 千问云 accepted this key (HTTP 401).' });
    await expect(check(vi.fn().mockResolvedValueOnce(answer(403)).mockResolvedValueOnce(refused()))).resolves.toMatchObject({ ok: false, code: 'auth' });
  });

  it('a rate limit is not ready, as rate_limit, and the other storefront is not asked', async () => {
    const fetch = vi.fn(async () => answer(429));
    await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'rate_limit', reason: 'QwenCloud is limiting requests (HTTP 429).' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a status the key does not explain, or a failed request, cannot tell: it throws', async () => {
    await expect(check(vi.fn(async () => answer(500)))).rejects.toThrow('Qwen answered the key check with HTTP 500.');
    await expect(check(vi.fn(async () => { throw new TypeError('Failed to fetch'); }))).rejects.toThrow('Failed to fetch');
  });

  it(`no answer within ${DETECT_TIMEOUT_MS / 1000} s throws in words, the request aborted`, async () => {
    const clock = createVirtualClock(0);
    let aborted = false;
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    }));
    const pending = createQwenCheck({ fetch: fetch as unknown as typeof globalThis.fetch, clock })(K, QWEN_DEFAULTS, ctx);
    clock.advance(DETECT_TIMEOUT_MS);
    await expect(pending).rejects.toThrow(`Qwen did not answer the key check within ${DETECT_TIMEOUT_MS / 1000} s.`);
    expect(aborted).toBe(true);
  });

  it("a check its caller aborts throws the caller's reason", async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    await expect(check(vi.fn(async () => answer(200)), { ...ctx, signal: controller.signal })).rejects.toThrow('stopped');
  });

  it('detection alone answers the storefront or the refusal, for the adapter to use', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(refused()).mockResolvedValueOnce(answer(200));
    await expect(detectEndpoint(K.apiKey, { fetch, clock: createVirtualClock(0) })).resolves.toEqual({ endpoint: 'cn' });
    await expect(detectEndpoint(K.apiKey, { fetch: vi.fn(async () => refused()), clock: createVirtualClock(0) }))
      .resolves.toEqual({ refused: 'Neither QwenCloud nor 千问云 accepted this key (HTTP 401).', code: 'auth' });
  });
});
