import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../lib/run/types';
import type { RememberedVoiceLease } from '../providers/soniox/lease';
import { watchVoiceLeaseRecovery } from './voiceLeaseRecovery';

const API = 'https://api.test';
const LEASE: RememberedVoiceLease = { leaseId: 'lease-1', apiUrl: API };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function launch(o: { remembered?: RememberedVoiceLease | null; auth?: Partial<AuthContext>; answer?: () => Promise<Response>; apiUrl?: string } = {}) {
  let auth: AuthContext = { signedIn: true, loaded: true, userId: 'u1', getToken: vi.fn(async () => 'fresh'), ...o.auth };
  const watchers = new Set<() => void>();
  const memory = { read: vi.fn(async () => (o.remembered === undefined ? LEASE : o.remembered)), remember: vi.fn(), forget: vi.fn() };
  const fetch = vi.fn((_url: string, _init: RequestInit) => (o.answer ?? (async () => new Response('{}', { status: 200 })))());
  const warn = vi.fn();
  const off = watchVoiceLeaseRecovery({
    auth: () => auth,
    watchSignIn: (fn) => { watchers.add(fn); return () => { watchers.delete(fn); }; },
    apiUrl: () => o.apiUrl ?? API,
    memory,
    fetch: fetch as unknown as typeof globalThis.fetch,
    warn,
  });
  const signIn = async (next: Partial<AuthContext>) => { auth = { ...auth, ...next }; for (const w of [...watchers]) w(); await settle(); };
  return { memory, fetch, warn, off, signIn, watchers, token: () => auth.getToken };
}

describe('a voice-only lease remembered from a launch that never ended it', () => {
  it('is ended at launch with a fresh token, then forgotten', async () => {
    const h = launch();
    await settle();
    expect(h.memory.read).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0][0]).toBe(`${API}/soniox/session-end`);
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer fresh', 'Content-Type': 'application/json' }, body: '{"leaseId":"lease-1"}' });
    expect(h.token()).toHaveBeenCalledTimes(1);
    expect(h.memory.forget.mock.calls).toEqual([['lease-1']]);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it.each([400, 404, 409])('is forgotten when the service refuses it (HTTP %i): nothing is left to end', async (status) => {
    const h = launch({ answer: async () => new Response('{}', { status }) });
    await settle();
    expect(h.memory.forget.mock.calls).toEqual([['lease-1']]);
  });

  it.each([
    ['HTTP 503', async () => new Response('{}', { status: 503 })],
    ['a request that never arrived', async () => { throw new TypeError('Failed to fetch'); }],
  ] as Array<[string, () => Promise<Response>]>)('is kept for the next launch after %s, and not tried again in this one', async (_name, answer) => {
    const h = launch({ answer });
    await settle();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.memory.forget).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledTimes(1);
    await h.signIn({ userId: 'u2' });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('with nothing remembered, nothing is sent', async () => {
    const h = launch({ remembered: null });
    await settle();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.memory.forget).not.toHaveBeenCalled();
    expect(h.token()).not.toHaveBeenCalled();
  });

  it('waits for the sign-in: signed out or still loading sends nothing, and the sign-in arriving ends it', async () => {
    const h = launch({ auth: { signedIn: false, loaded: false } });
    await settle();
    expect(h.fetch).not.toHaveBeenCalled();
    await h.signIn({ loaded: true });
    expect(h.fetch).not.toHaveBeenCalled();
    await h.signIn({ signedIn: true });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.memory.forget.mock.calls).toEqual([['lease-1']]);
    // Once per launch.
    await h.signIn({ userId: 'u2' });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    // What was remembered was read once, at launch: a lease taken since is never the one ended here.
    expect(h.memory.read).toHaveBeenCalledTimes(1);
  });

  it('a sign-in that yields no token sends nothing and waits for the next change', async () => {
    const h = launch({ auth: { getToken: vi.fn(async () => null) } });
    await settle();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.memory.forget).not.toHaveBeenCalled();
    await h.signIn({ getToken: vi.fn(async () => 'fresh') });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('a lease asked of another service than this build talks to is left alone: no token is sent anywhere else', async () => {
    const h = launch({ apiUrl: 'https://other.test' });
    await settle();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.token()).not.toHaveBeenCalled();
    expect(h.memory.forget).not.toHaveBeenCalled();
  });

  it('stops watching when the page lets go', async () => {
    const h = launch({ auth: { signedIn: false } });
    h.off();
    expect(h.watchers.size).toBe(0);
  });
});
