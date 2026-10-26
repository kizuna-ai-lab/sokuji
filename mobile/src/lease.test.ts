import { describe, it, expect } from 'vitest';
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

  it('reports a lost session as sign_in_required', async () => {
    const { fetch } = respond([401]);
    await expect(leaseKey({ token: 'tok', region: 'us', fetch, ...clock() })).rejects.toThrow('sign_in_required');
  });
});
