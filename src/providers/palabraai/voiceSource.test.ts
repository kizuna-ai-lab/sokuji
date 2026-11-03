import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AuthContext, ProviderAccount } from '../../lib/provider/types';
import { clearPreviewCache, getCachedPreview, previewCacheKey } from '../../lib/tts/previewCache';
import { PALABRA_DEFAULTS, type PalabraSettings } from './settings';
import { PalabraVoicesClient } from './voicesClient';
import { palabraVoiceSource, sharedPalabraVoiceSource, usePalabraVoiceSource, waitUntilSettled } from './voiceSource';
import { PalabraVoicesError } from './voicesClient';

const AUTH = { signedIn: false, getToken: async () => null } as AuthContext;
const page = (items: unknown[]) => new Response(JSON.stringify({ ok: true, data: { items, page_size: 100, count: items.length, next: null } }), { status: 200 });

/** A two-channel buffer, as `decodeAudioData` gives an MP3: the preview hands back its mono average. */
const stereo = (left: number[], right: number[], sampleRate = 44_100) =>
  ({ numberOfChannels: 2, length: left.length, sampleRate, getChannelData: (c: number) => Float32Array.from(c === 0 ? left : right) }) as unknown as AudioBuffer;

beforeEach(() => clearPreviewCache());

describe('palabraVoiceSource', () => {
  it('lists the built-ins and the account voices together', async () => {
    const client = { listBuiltin: vi.fn(async () => [{ id: 'b' }]), listMine: vi.fn(async () => [{ id: 'm' }]) } as unknown as PalabraVoicesClient;
    await expect(palabraVoiceSource(client).list()).resolves.toEqual({ builtin: [{ id: 'b' }], mine: [{ id: 'm' }] });
  });

  it('preview fetches the sample once, decodes it to mono, and serves the second call from the cache', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([9, 9, 9]), { status: 200 }));
    const decode = vi.fn(async () => stereo([0.5, 1], [0.5, 0]));
    const source = palabraVoiceSource({} as PalabraVoicesClient, { fetch, decode });
    const first = await source.preview({ id: 'v1', sample: 'https://cdn.palabra.ai/blob/v1.mp3' });
    const second = await source.preview({ id: 'v1', sample: 'https://cdn.palabra.ai/blob/v1.mp3' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(Array.from(first.audio)).toEqual([0.5, 0.5]);
    expect(first.sampleRate).toBe(44_100);
    expect(second).toBe(first);
    expect(getCachedPreview(previewCacheKey('palabra', 'v1', '', 1))).toBe(first);
    expect(source.cacheNamespace).toBe('palabra');
  });
});

describe('palabraVoiceSource: what it remembers (owner, 2026-11-03: no request on every visit)', () => {
  it('cached() is null until a list succeeds, then holds that list and the last quota', async () => {
    const client = {
      listBuiltin: vi.fn(async () => [{ id: 'b' }]), listMine: vi.fn(async () => [{ id: 'm' }]),
      limits: vi.fn(async () => ({ used: 1, limit: 10, remaining: 9 })),
    } as unknown as PalabraVoicesClient;
    const source = palabraVoiceSource(client);
    expect(source.cached()).toBeNull();
    await source.list();
    expect(source.cached()).toEqual({ builtin: [{ id: 'b' }], mine: [{ id: 'm' }], limits: null });
    await source.limits();
    expect(source.cached()?.limits).toEqual({ used: 1, limit: 10, remaining: 9 });
  });

  it('a failed list leaves the previous answer in place', async () => {
    const listMine = vi.fn().mockResolvedValueOnce([{ id: 'm' }]).mockRejectedValueOnce(new Error('offline'));
    const source = palabraVoiceSource({ listBuiltin: vi.fn(async () => []), listMine, limits: vi.fn() } as unknown as PalabraVoicesClient);
    await source.list();
    await expect(source.list()).rejects.toThrow('offline');
    expect(source.cached()?.mine).toEqual([{ id: 'm' }]);
  });

  it('of two overlapping lists, the later call\'s answer is the one remembered', async () => {
    let resolveFirst: (v: unknown[]) => void = () => {};
    const listMine = vi.fn()
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce([{ id: 'new' }]);
    const source = palabraVoiceSource({ listBuiltin: vi.fn(async () => []), listMine, limits: vi.fn() } as unknown as PalabraVoicesClient);
    const first = source.list();
    await source.list();
    resolveFirst([{ id: 'old' }]);
    await first;
    expect(source.cached()?.mine).toEqual([{ id: 'new' }]);
  });

  it('a failed limits() forgets the remembered quota', async () => {
    const limits = vi.fn().mockResolvedValueOnce({ used: 1, limit: 10, remaining: 9 }).mockRejectedValueOnce(new Error('offline'));
    const source = palabraVoiceSource({ listBuiltin: vi.fn(async () => []), listMine: vi.fn(async () => []), limits } as unknown as PalabraVoicesClient);
    await source.list();
    await source.limits();
    await expect(source.limits()).rejects.toThrow('offline');
    expect(source.cached()?.limits).toBeNull();
  });

  it('a create or a delete makes the next visit ask again', async () => {
    const client = {
      listBuiltin: vi.fn(async () => []), listMine: vi.fn(async () => [{ id: 'm' }]), limits: vi.fn(),
      create: vi.fn(async () => ({ id: 'n' })), delete: vi.fn(async () => {}),
    } as unknown as PalabraVoicesClient;
    const source = palabraVoiceSource(client);
    await source.list();
    await source.delete('m');
    expect(source.cached()).toBeNull();
    await source.list();
    await source.create({ name: 'xyz', wav: new Blob([]), langCode: 'en', denoise: false });
    expect(source.cached()).toBeNull();
  });

  it('sharedPalabraVoiceSource gives one source per credentials for the whole app session', () => {
    const a1 = sharedPalabraVoiceSource({ kind: 'apiKey', apiKey: 'plbr_a' });
    const a2 = sharedPalabraVoiceSource({ kind: 'apiKey', apiKey: 'plbr_a' });
    const b = sharedPalabraVoiceSource({ kind: 'apiKey', apiKey: 'plbr_b' });
    const app = sharedPalabraVoiceSource({ kind: 'app', clientId: 'id', clientSecret: 'sec_x' });
    expect(a2).toBe(a1);
    expect(b).not.toBe(a1);
    expect(app).not.toBe(a1);
  });
});

describe('waitUntilSettled', () => {
  const ready = { id: 'v', name: 'V', language: 'zh', facets: {}, status: 'ready', sample: null } as const;
  const processing = { ...ready, status: 'processing' } as const;
  const signal = () => new AbortController().signal;

  it('keeps polling through a transient error, and stops on a voice that is gone', async () => {
    const get = vi.fn()
      .mockRejectedValueOnce(new PalabraVoicesError('network', 'Could not reach Palabra.', 0))
      .mockRejectedValueOnce(new PalabraVoicesError('rate_limit', 'HTTP 429', 429))
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(ready);
    await expect(waitUntilSettled({ get }, 'v', { sleep: async () => {}, signal: signal() })).resolves.toEqual(ready);
    expect(get).toHaveBeenCalledTimes(4);
    const gone = vi.fn().mockRejectedValue(new PalabraVoicesError('not_found', 'HTTP 404', 404));
    await expect(waitUntilSettled({ get: gone }, 'v', { sleep: async () => {}, signal: signal() })).rejects.toMatchObject({ errorType: 'not_found' });
    const refused = vi.fn().mockRejectedValue(new PalabraVoicesError('auth', 'HTTP 401', 401));
    await expect(waitUntilSettled({ get: refused }, 'v', { sleep: async () => {}, signal: signal() })).rejects.toMatchObject({ errorType: 'auth' });
  });

  it('counts the time status requests take toward the 15-minute budget', async () => {
    let t = 0;
    const get = vi.fn(async () => { t += 100_000; return processing; });
    await expect(waitUntilSettled({ get }, 'v', { sleep: async (ms) => { t += ms; }, signal: signal(), now: () => t }))
      .rejects.toMatchObject({ errorType: 'timeout' });
    expect(get.mock.calls.length).toBeLessThan(10);
  });
});

describe('palabraVoiceSource preview: the sample url', () => {
  it('refuses a sample url that is not https, fetching nothing', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1])));
    const source = palabraVoiceSource({} as PalabraVoicesClient, { fetch, decode: vi.fn() });
    await expect(source.preview({ id: 'v', sample: 'http://cdn.palabra.ai/blob/v.mp3' })).rejects.toBeInstanceOf(Error);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('usePalabraVoiceSource', () => {
  const account = (credentials: Record<string, string>): ProviderAccount => ({ credentials, auth: AUTH });
  const settings = (patch: Partial<PalabraSettings> = {}): PalabraSettings => ({ ...PALABRA_DEFAULTS, ...patch });

  it('reads an app pair as app headers, though the saved values also hold a key', async () => {
    const fetch = vi.fn(async () => page([]));
    vi.stubGlobal('fetch', fetch);
    try {
      const { result } = renderHook(() => usePalabraVoiceSource(account({ apiKey: 'plbr_x', clientId: 'id', clientSecret: 'sec_x' }), settings({ authMode: 'app' })));
      expect(result.current).not.toBeNull();
      await result.current!.list();
      const headers = (fetch.mock.calls as unknown as Array<[string, RequestInit]>).map(([, init]) => init.headers as Record<string, string>);
      expect(headers.length).toBeGreaterThan(0);
      for (const h of headers) {
        expect(h.ClientId).toBe('id');
        expect(h).not.toHaveProperty('Authorization');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when the mode's credentials are missing", () => {
    expect(renderHook(() => usePalabraVoiceSource(account({ apiKey: 'plbr_x' }), settings({ authMode: 'app' }))).result.current).toBeNull();
    expect(renderHook(() => usePalabraVoiceSource(account({ clientId: 'id', clientSecret: 'sec_x' }), settings({ authMode: 'platform' }))).result.current).toBeNull();
    expect(renderHook(() => usePalabraVoiceSource(undefined, settings())).result.current).toBeNull();
  });

  it('hands a remounted component the same source, so its remembered list survives', () => {
    const first = renderHook(() => usePalabraVoiceSource(account({ apiKey: 'plbr_same' }), settings()));
    const source = first.result.current;
    first.unmount();
    const second = renderHook(() => usePalabraVoiceSource(account({ apiKey: 'plbr_same' }), settings()));
    expect(second.result.current).toBe(source);
  });

  it('returns the same object until the credentials change', () => {
    const { result, rerender } = renderHook(({ creds, s }) => usePalabraVoiceSource(account(creds), s), {
      initialProps: { creds: { apiKey: 'plbr_a' } as Record<string, string>, s: settings() },
    });
    const first = result.current;
    rerender({ creds: { apiKey: 'plbr_a' }, s: settings({ autoTempo: true }) });
    expect(result.current).toBe(first);
    rerender({ creds: { apiKey: 'plbr_b' }, s: settings() });
    expect(result.current).not.toBe(first);
  });
});

