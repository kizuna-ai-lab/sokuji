import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { AuthContext, ProviderAccount } from '../../lib/provider/types';
import { clearPreviewCache, getCachedPreview, previewCacheKey } from '../../lib/tts/previewCache';
import { PALABRA_DEFAULTS, type PalabraSettings } from './settings';
import { PalabraVoicesClient } from './voicesClient';
import { palabraVoiceSource, usePalabraVoiceSource } from './voiceSource';

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

