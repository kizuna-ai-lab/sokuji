import { describe, it, expect, vi, afterEach } from 'vitest';
import { getJson } from './http';

// React Native's fetch has no timeout of its own: a stalled account request
// would keep the balance screen on its spinner for good. These screens are
// foreground-only, so a JS timer is the right cut-off here.
describe('getJson', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('returns the JSON body with the bearer token sent', async () => {
    const calls: RequestInit[] = [];
    const fetch = (async (_url: string, init: RequestInit) => { calls.push(init); return new Response('{"ok":1}', { status: 200 }); }) as unknown as typeof globalThis.fetch;
    expect(await getJson('/api/x', { token: 'tok', fetch, label: 'x' })).toEqual({ ok: 1 });
    expect((calls[0].headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('gives up on a request that never answers after 15 s', async () => {
    vi.useFakeTimers();
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => { init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); })) as unknown as typeof globalThis.fetch;
    const settled = getJson('/api/wallet/status', { token: 'tok', fetch, label: 'wallet-status' }).then(() => 'resolved', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await settled).toBe('wallet-status timeout');
  });
});
