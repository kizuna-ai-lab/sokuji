import { describe, it, expect, vi } from 'vitest';
import { leaseKey } from './lease';

const grant = {
  leaseId: 'lease-1', clientReferenceId: 'ref-1', region: 'us', maxSessionDurationSeconds: 7200,
  streams: [{ role: 'par_stt', apiKey: 'snx_temp_1', clientReferenceId: 'ref-1-par' }],
};
const respond = (statuses: number[]) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? JSON.stringify(grant) : '{}', { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; };

describe('leaseKey', () => {
  it('posts the participant body with the bearer token and returns the grant', async () => {
    const { fetch, calls } = respond([200]);
    const g = await leaseKey({ token: 'tok', region: 'jp', fetch, ...clock() });
    expect(g.streams[0].apiKey).toBe('snx_temp_1');
    expect(calls[0].url).toBe('https://sokuji.kizuna.ai/api/soniox/session-key');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ mode: 'participant', textOnly: true, bothSplit: false, region: 'jp' });
  });

  it('retries a 409 every 3 s and succeeds when the old lease is released', async () => {
    const { fetch, calls } = respond([409, 409, 200]);
    const c = clock();
    await leaseKey({ token: 'tok', region: 'us', fetch, ...c });
    expect(calls.length).toBe(3);
    expect(c.now()).toBe(6000);
  });

  it('gives up on 409 after 60 s', async () => {
    const { fetch } = respond(new Array(30).fill(409));
    await expect(leaseKey({ token: 'tok', region: 'us', fetch, ...clock() })).rejects.toThrow('lease_conflict');
  });

  it('reports an empty balance as balance_exhausted', async () => {
    const { fetch } = respond([402]);
    await expect(leaseKey({ token: 'tok', region: 'us', fetch, ...clock() })).rejects.toThrow('balance_exhausted');
  });

  it('reports a lost session as sign_in_required', async () => {
    const { fetch } = respond([401]);
    await expect(leaseKey({ token: 'tok', region: 'us', fetch, ...clock() })).rejects.toThrow('sign_in_required');
  });

  // stop() aborts a lease in flight: the 409 wait ends at the next tick and
  // no request follows, so a stopped session cannot win a lease it will never use.
  it('stops the 409 wait when the signal aborts', async () => {
    const { fetch, calls } = respond([409, 409, 409]);
    const ctl = new AbortController();
    const sleep = async () => { ctl.abort(); };
    await expect(leaseKey({ token: 'tok', region: 'us', fetch, sleep, now: () => 0, signal: ctl.signal })).rejects.toThrow('aborted');
    expect(calls.length).toBe(1);
  });
});

describe('sessionEnd', () => {
  it('posts the lease id and reports success', async () => {
    const { sessionEnd } = await import('./lease');
    const { fetch, calls } = respond([200]);
    expect(await sessionEnd({ token: 'tok', leaseId: 'lease-1', fetch, ...clock() })).toBe(true);
    expect(calls[0].url).toBe('https://sokuji.kizuna.ai/api/soniox/session-end');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ leaseId: 'lease-1' });
  });

  it('retries a server error at most twice, then gives up without throwing', async () => {
    const { sessionEnd } = await import('./lease');
    const { fetch, calls } = respond([500, 500, 500, 500]);
    expect(await sessionEnd({ token: 'tok', leaseId: 'lease-1', fetch, ...clock() })).toBe(false);
    expect(calls.length).toBe(3);
  });
});

describe('sessionStarted', () => {
  // A lost session answers 401 here as well as on session-key; the session
  // must stop with "sign in again", not retry a request that cannot succeed.
  it('reports a 401 as sign_in_required', async () => {
    const { sessionStarted } = await import('./lease');
    const { fetch } = respond([401]);
    await expect(sessionStarted({ token: 'tok', leaseId: 'lease-1', role: 'par_stt', fetch })).rejects.toThrow('sign_in_required');
  });
});

describe('request timeouts', () => {
  // A fetch that never answers unless it is aborted: React Native's fetch has no
  // timeout of its own, so a hung session-key left the session in `connecting`
  // for good (and `reconnecting` on screen) during Gate A.
  const hang = () => {
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof globalThis.fetch;
    return fetch;
  };

  it('aborts a session-key request after 15 s and reports it as a network error', async () => {
    vi.useFakeTimers();
    try {
      const settled = leaseKey({ token: 'tok', region: 'us', fetch: hang(), ...clock() }).then(
        () => 'resolved',
        (e: Error) => e.message,
      );
      await vi.advanceTimersByTimeAsync(15000);
      expect(await settled).toBe('session-key timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a session-started request after 15 s', async () => {
    vi.useFakeTimers();
    try {
      const { sessionStarted } = await import('./lease');
      const settled = sessionStarted({ token: 'tok', leaseId: 'lease-1', role: 'par_stt', fetch: hang() }).then(
        () => 'resolved',
        (e: Error) => e.message,
      );
      await vi.advanceTimersByTimeAsync(15000);
      expect(await settled).toBe('session-started timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});
