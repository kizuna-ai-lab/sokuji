import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ManagedVoicesClient } from './ManagedVoicesClient';
import { SonioxVoicesError } from './SonioxVoicesClient';

const TOKEN = 'sess_abc';
const make = () => new ManagedVoicesClient(async () => TOKEN);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ManagedVoicesClient.mine', () => {
  it('returns null when the account holds no voice', async () => {
    fetchMock.mockResolvedValue(json(200, { voice: null }));
    expect(await make().mine()).toBeNull();
  });

  it('returns the voice with Soniox\'s raw status', async () => {
    // GET /mine reads status THROUGH to Soniox, so it carries the full
    // four-value enum — 'not_computed' included. Narrowing it to
    // ready/processing here would silently mislabel a voice that has not
    // begun building.
    fetchMock.mockResolvedValue(json(200, {
      voice: { voiceId: 'v1', status: 'not_computed', createdAt: 1000 },
    }));
    expect(await make().mine()).toEqual({ voiceId: 'v1', status: 'not_computed', createdAt: 1000 });
  });

  it('sends the session token as a bearer', async () => {
    fetchMock.mockResolvedValue(json(200, { voice: null }));
    await make().mine();
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses to call at all without a token', async () => {
    // Firing an unauthenticated request would spend a round trip to learn
    // what we already know, and the 401 would surface as an infrastructure
    // error rather than "sign in".
    const client = new ManagedVoicesClient(async () => null);
    await expect(client.mine()).rejects.toMatchObject({ errorType: 'authentication_required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ManagedVoicesClient.ensure', () => {
  it('posts multipart with pin=1 and no clip on the warm path', async () => {
    // The clip is up to 10 MB. Uploading it when the slot is already warm
    // would waste the user's uplink on every single session start.
    fetchMock.mockResolvedValue(json(200, { voiceId: 'v1', status: 'ready' }));
    const res = await make().ensure({ pin: true });
    expect(res).toEqual({ voiceId: 'v1', status: 'ready' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/soniox\/voices\/ensure$/);
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('pin')).toBe('1');
    expect(form.get('clip')).toBeNull();
    // A Content-Type header would clobber the multipart boundary fetch
    // generates for us, and the backend's formData() parse would fail.
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('attaches the clip when one is supplied, and pin=0 when not pinning', async () => {
    fetchMock.mockResolvedValue(json(200, { voiceId: 'v2', status: 'processing' }));
    const clip = new Blob([new Uint8Array([1, 2])], { type: 'audio/wav' });
    await make().ensure({ pin: false, clip });
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('pin')).toBe('0');
    expect(form.get('clip')).toBeInstanceOf(Blob);
  });

  it('surfaces pool_exhausted with the server\'s own retry hint', async () => {
    // The backend pokes its reconciler before refusing, so its hint is a
    // real estimate of when a pin might have been freed — better than any
    // constant we could pick here.
    fetchMock.mockResolvedValue(json(409, { error: 'pool_exhausted', retryAfterMs: 3000 }));
    await expect(make().ensure({ pin: true })).rejects.toMatchObject({
      errorType: 'pool_exhausted',
      status: 409,
      retryAfterMs: 3000,
    });
  });

  it.each([
    [409, 'clip_required'],
    [409, 'superseded'],
    [402, 'insufficient_balance'],
    [403, 'wallet_frozen'],
    [403, 'verified_account_required'],
    [502, 'create_failed'],
    [503, 'wallet_unavailable'],
  ])('passes the backend slug through for %i %s', async (status, slug) => {
    fetchMock.mockResolvedValue(json(status, { error: slug }));
    await expect(make().ensure({ pin: true })).rejects.toMatchObject({ errorType: slug, status });
  });

  it('normalizes a transport failure instead of leaking a TypeError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await make().ensure({ pin: true }).catch((e) => e);
    expect(err).toBeInstanceOf(SonioxVoicesError);
    expect(err.errorType).toBe('network');
  });

  it('refuses to call at all when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      make().ensure({ pin: true, signal: controller.signal })
    ).rejects.toMatchObject({ errorType: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ManagedVoicesClient caller-signal threading (via .mine)', () => {
  // Exercised through `mine` because `mine`/`ensure` both funnel into the
  // same private `request()` — one code path to cover, plus one threading
  // check above (`ensure`'s pre-flight refusal) proving the object-form
  // signature passes `signal` through too.

  it('refuses to call at all when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(make().mine(undefined, controller.signal)).rejects.toMatchObject({
      errorType: 'aborted',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a mid-flight caller cancel to aborted, NOT timeout', async () => {
    // fetch() aborting mid-flight rejects with the controller's own reason —
    // simulate that by listening for the abort request() actually issues
    // (on its OWN internal controller, forwarded from the caller's signal)
    // and rejecting with that reason, same as a real fetch would.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const internalSignal = init.signal as AbortSignal;
          internalSignal.addEventListener('abort', () => reject(internalSignal.reason));
        })
    );
    const controller = new AbortController();
    const promise = make().mine(undefined, controller.signal);
    // Let request() run past `getToken()` and reach fetch() — by which point
    // its forwardAbort listener is already attached to the caller's signal —
    // before firing the cancel.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort();
    await expect(promise).rejects.toMatchObject({ errorType: 'aborted' });
  });

  it('still maps to timeout when the caller signal never fires', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const internalSignal = init.signal as AbortSignal;
            internalSignal.addEventListener('abort', () => reject(internalSignal.reason));
          })
      );
      // No caller signal at all — only the client's own deadline can fire.
      // The assertion is wired up BEFORE advancing the fake timer: attaching
      // `.rejects` only after would race the timer-driven rejection against
      // Node's unhandled-rejection detector (the two don't share a
      // microtask queue tick under fake timers) and flake with a spurious
      // "handled asynchronously" warning that fails the run.
      const promise = make().mine();
      const assertion = expect(promise).rejects.toMatchObject({ errorType: 'timeout' });
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the caller-signal listener once the request settles, so a later abort is inert', async () => {
    fetchMock.mockResolvedValue(json(200, { voice: null }));
    const controller = new AbortController();
    await expect(make().mine(undefined, controller.signal)).resolves.toBeNull();
    // Firing the signal after the request already settled must be a no-op —
    // no throw here, and (since vitest fails a run on an unhandled
    // rejection) nothing left listening to produce one either.
    expect(() => controller.abort()).not.toThrow();
  });
});

describe('ManagedVoicesClient.remove', () => {
  it('resolves on 200', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await expect(make().remove()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('rejects with voice_pinned while a session holds the slot', async () => {
    fetchMock.mockResolvedValue(json(409, { error: 'voice_pinned' }));
    await expect(make().remove()).rejects.toMatchObject({ errorType: 'voice_pinned', status: 409 });
  });
});
