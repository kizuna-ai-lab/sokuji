import { describe, it, expect, vi } from 'vitest';
import { createVoiceLeaseMemory, endRememberedVoiceLease, VOICE_LEASE_KEY, type VoiceLeaseStorage } from './voiceLeaseMemory';

/** A storage of one value, as the settings service keeps one key. */
function storageOf(initial: unknown = null) {
  let value = initial;
  const storage: VoiceLeaseStorage = {
    read: vi.fn(async () => value),
    write: vi.fn(async (next) => { value = next; }),
  };
  return { storage, value: () => value };
}

const LEASE = { leaseId: 'lease-1', apiUrl: 'https://api.test' };

describe('the memory of a voice-only lease', () => {
  it('is kept under one key of the settings storage', () => {
    expect(VOICE_LEASE_KEY).toBe('soniox.voiceOnlyLease');
  });

  it('remembers the lease by its id and the service it was asked of, and nothing else', async () => {
    const { storage, value } = storageOf();
    const memory = createVoiceLeaseMemory(storage);
    memory.remember({ ...LEASE, token: 'tok', apiKey: 'k' } as never);
    expect(value()).toEqual(LEASE);
    expect(await memory.read()).toEqual(LEASE);
  });

  it('forgets it once it is ended', async () => {
    const { storage, value } = storageOf();
    const memory = createVoiceLeaseMemory(storage);
    memory.remember(LEASE);
    memory.forget('lease-1');
    expect(value()).toBeNull();
    expect(await memory.read()).toBeNull();
  });

  it('a lease found at launch is forgotten by its id', async () => {
    const { storage, value } = storageOf(LEASE);
    const memory = createVoiceLeaseMemory(storage);
    expect(await memory.read()).toEqual(LEASE);
    memory.forget('lease-1');
    expect(value()).toBeNull();
  });

  it('never forgets a newer lease for an older one: the one remembered since stays', async () => {
    const { storage, value } = storageOf(LEASE);
    const memory = createVoiceLeaseMemory(storage);
    const newer = { leaseId: 'lease-2', apiUrl: 'https://api.test' };
    memory.remember(newer);
    memory.forget('lease-1');
    expect(value()).toEqual(newer);
    memory.forget('lease-2');
    expect(value()).toBeNull();
  });

  it.each([
    ['nothing', null], ['a string', 'lease-1'], ['no id', { apiUrl: 'https://api.test' }], ['an empty id', { leaseId: '', apiUrl: 'https://api.test' }],
    ['no service', { leaseId: 'lease-1' }], ['a list', [LEASE]],
  ])('reads %s as no lease', async (_name, stored) => {
    expect(await createVoiceLeaseMemory(storageOf(stored).storage).read()).toBeNull();
  });

  it('a storage that cannot be read holds no lease, and one that cannot be written throws nothing', async () => {
    const memory = createVoiceLeaseMemory({ read: async () => { throw new Error('down'); }, write: async () => { throw new Error('full'); } });
    expect(await memory.read()).toBeNull();
    expect(() => memory.remember(LEASE)).not.toThrow();
    expect(() => memory.forget('lease-1')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('ending a remembered voice-only lease', () => {
  const ending = (answer: () => Promise<Response>, token: string | null = 'fresh') => {
    const fetch = vi.fn((_url: string, _init: RequestInit) => answer());
    const getToken = vi.fn(async () => token);
    return { fetch, getToken, run: () => endRememberedVoiceLease({ lease: LEASE, getToken, fetch: fetch as unknown as typeof globalThis.fetch }) };
  };

  it('sends session-end for it to the service it was asked of, with a fresh token', async () => {
    const e = ending(async () => new Response('{}', { status: 200 }));
    expect(await e.run()).toBe('ended');
    expect(e.getToken).toHaveBeenCalledTimes(1);
    expect(e.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = e.fetch.mock.calls[0];
    expect(url).toBe('https://api.test/soniox/session-end');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer fresh', 'Content-Type': 'application/json' }, body: '{"leaseId":"lease-1"}' });
  });

  it.each([400, 403, 404, 409])('HTTP %i is an answer: there is nothing left to end', async (status) => {
    expect(await ending(async () => new Response('{}', { status })).run()).toBe('ended');
  });

  it.each([401, 408, 429, 500, 502, 503])('HTTP %i keeps it for the next launch', async (status) => {
    expect(await ending(async () => new Response('{}', { status })).run()).toBe('kept');
  });

  it('a request that never reached the service keeps it', async () => {
    expect(await ending(async () => { throw new TypeError('Failed to fetch'); }).run()).toBe('kept');
  });

  it('a request that is not answered in time is given up, and the lease is kept', async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    expect(await endRememberedVoiceLease({ lease: LEASE, getToken: async () => 'fresh', fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 5 })).toBe('kept');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('with no token nothing is sent, and it is kept', async () => {
    const e = ending(async () => new Response('{}', { status: 200 }), null);
    expect(await e.run()).toBe('kept');
    expect(e.fetch).not.toHaveBeenCalled();
    const failing = { ...e, getToken: vi.fn(async () => { throw new Error('no session'); }) };
    expect(await endRememberedVoiceLease({ lease: LEASE, getToken: failing.getToken, fetch: e.fetch as unknown as typeof globalThis.fetch })).toBe('kept');
    expect(e.fetch).not.toHaveBeenCalled();
  });
});
