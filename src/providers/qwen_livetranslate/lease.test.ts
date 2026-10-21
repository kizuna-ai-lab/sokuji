import { describe, it, expect, vi } from 'vitest';
import { AdapterStartError } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import type { LegName } from '../../lib/conversation/types';
import type { LeaseContext, RunShape } from '../../lib/session/types';
import { CONFLICT_WAIT_LIMIT_MS, createQwenLease, ENDING_POLL_MS, RELEASED_RETRY_MS, SESSION_KEY_TIMEOUT_MS } from './lease';
import { QWEN_DEFAULTS, type QwenSettings } from './settings';

const API = 'https://api.test';
const GRANT_KEY = 'st-test-grant-0001';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A `fetch` that answers only when told; an abort rejects it, as a real one does. */
function stubFetch() {
  const calls: Array<{ url: string; init: RequestInit; respond(status: number, body?: unknown): void; fail(error?: unknown): void }> = [];
  const fetch = vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
    calls.push({
      url, init,
      respond: (status, body) => resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
      fail: (error = new TypeError('Failed to fetch')) => reject(error),
    });
  }));
  return { fetch, calls, last: () => calls[calls.length - 1], to: (path: string) => calls.filter((c) => c.url === `${API}${path}`) };
}

/** A grant as the backend answers it (spec §3). */
const grant = (over: Record<string, unknown> = {}) => ({
  leaseId: 'lease-1', endpoint: 'intl', apiKey: GRANT_KEY, expiresAt: '2026-10-17T00:01:00Z',
  maxSessionDurationSeconds: 600, budgetMicroUsd: 416_667, rateUsdPerHour: 2.5, ...over,
});

type Options = { textOnly?: boolean; participantSpeech?: boolean; token?: string | null; settings?: Partial<QwenSettings> };

const shapeFor = (legs: LegName[], o: Options = {}): RunShape => ({
  provider: {} as RunShape['provider'], settings: { ...QWEN_DEFAULTS, ...o.settings }, credentials: {}, pair: { source: 'ja', target: 'en' }, legs,
  turnMode: 'auto', textOnly: o.textOnly ?? false, participantSpeech: o.participantSpeech ?? false, keepReplayAudio: true,
  shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
  auth: { signedIn: o.token !== null, userId: 'u1', getToken: vi.fn(async () => (o.token === undefined ? 'tok' : o.token)) },
});

/** `acquire` in flight over a stub `fetch`, on a virtual clock; the test answers it. */
function acquiring(legs: LegName[], o: Options = {}) {
  const net = stubFetch();
  const clock = createVirtualClock(0);
  const controller = new AbortController();
  const end = vi.fn();
  const frame = vi.fn();
  const waiting = vi.fn();
  const ctx: LeaseContext = { signal: controller.signal, clock, end, frame, waiting };
  const lease = createQwenLease({ fetch: net.fetch as unknown as typeof fetch, apiUrl: () => API });
  const pending = lease(shapeFor(legs, o), { ...QWEN_DEFAULTS, ...o.settings }, ctx);
  pending.catch(() => {});
  return { ...net, clock, controller, end, frame, waiting, ctx, lease, pending };
}

type AcquireOptions = Parameters<typeof acquiring>[1];

async function granted(legs: LegName[], o: AcquireOptions = {}, over: Record<string, unknown> = {}) {
  const a = acquiring(legs, o);
  await flush();
  a.last().respond(200, grant(over));
  const resources = await a.pending;
  return { ...a, resources };
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(() => { throw new Error('expected a rejection'); }, (error: unknown) => error);
}

const code = (e: unknown) => (e as AdapterStartError).code;

describe('Qwen lease: the session-key request', () => {
  it('asks for a speaker-only text-only run with nobody speaking', async () => {
    const a = acquiring(['speaker'], { textOnly: true });
    await flush();
    expect(JSON.parse(a.last().init.body as string)).toEqual({ legs: ['speaker'], speech: { speaker: false, participant: false }, region: 'sg' });
  });

  it('asks for Both with the participant spoken to me', async () => {
    const a = acquiring(['speaker', 'participant'], { participantSpeech: true });
    await flush();
    expect(JSON.parse(a.last().init.body as string)).toEqual({ legs: ['speaker', 'participant'], speech: { speaker: true, participant: true }, region: 'sg' });
  });

  it('asks for a participant-only run with the speaker not speaking, whatever textOnly says', async () => {
    for (const participantSpeech of [true, false]) {
      const a = acquiring(['participant'], { participantSpeech });
      await flush();
      expect(JSON.parse(a.last().init.body as string)).toEqual({ legs: ['participant'], speech: { speaker: false, participant: participantSpeech }, region: 'sg' });
    }
  });

  it('POSTs to qwen/session-key with the sign-in token in Authorization only, and frames the body, never the token', async () => {
    const a = acquiring(['speaker']);
    await flush();
    const call = a.last();
    expect(call.url).toBe(`${API}/qwen/session-key`);
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(a.frame).toHaveBeenCalledWith({ direction: 'out', type: 'session.key_requested', payload: { legs: ['speaker'], speech: { speaker: true, participant: false }, region: 'sg' } });
    expect(JSON.stringify(a.frame.mock.calls)).not.toContain('tok"');
    call.respond(200, grant());
    await a.pending;
  });

  it("sends the setting's region with the request, Beijing included", async () => {
    const a = acquiring(['speaker'], { settings: { region: 'cn' } });
    await flush();
    expect(JSON.parse(a.last().init.body as string)).toMatchObject({ region: 'cn' });
    expect(a.frame).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.key_requested', payload: expect.objectContaining({ region: 'cn' }) }));
  });

  it('refuses to start without a sign-in', async () => {
    const a = acquiring(['speaker'], { token: null });
    const error = await rejection(a.pending);
    expect(code(error)).toBe('sign_in_required');
    expect(a.fetch).not.toHaveBeenCalled();
  });
});

describe('Qwen lease: the grant', () => {
  it("hands each leg the grant, its endpoint and a port; the budget is the grant's duration", async () => {
    const a = await granted(['speaker', 'participant']);
    const { credentials, budget } = a.resources;
    expect(credentials('speaker')).toEqual({ apiKey: GRANT_KEY, endpoint: 'intl', lease: { sessionCreated: expect.any(Function) } });
    expect(credentials('participant').apiKey).toBe(GRANT_KEY);
    expect(budget).toEqual({ totalMs: 600_000, endsAt: 600_000 });
  });

  it("dials the endpoint the grant names, whatever the setting asked, and frames the grant's region", async () => {
    const a = await granted(['speaker'], { settings: { region: 'sg' } }, { endpoint: 'cn', region: 'cn' });
    expect(a.resources.credentials('speaker').endpoint).toBe('cn');
    expect(a.frame).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.lease_acquired', payload: expect.objectContaining({ endpoint: 'cn', region: 'cn' }) }));
  });

  it("accepts a grant that names no region, as the backend before Beijing answered", async () => {
    const a = await granted(['speaker']);
    expect(a.resources.credentials('speaker').endpoint).toBe('intl');
    expect(a.frame).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.lease_acquired', payload: expect.not.objectContaining({ region: expect.anything() }) }));
  });

  it('fails the start on a grant whose region is not one it knows', async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(200, grant({ region: 'us' }));
    expect(String(await rejection(a.pending))).toContain('region');
  });

  it('refuses a leg that was not asked for', async () => {
    const a = await granted(['speaker']);
    expect(() => a.resources.credentials('participant')).toThrow(/not requested/);
  });

  it('fails the start on a 200 without a usable grant, without the key in the message', async () => {
    for (const over of [{ apiKey: undefined }, { leaseId: '' }, { endpoint: 'moon' }, { maxSessionDurationSeconds: 0 }]) {
      const a = acquiring(['speaker']);
      await flush();
      a.last().respond(200, grant(over));
      const error = await rejection(a.pending);
      expect(String((error as Error).message)).not.toContain(GRANT_KEY);
    }
  });
});

describe('Qwen lease: a refused or conflicting key', () => {
  it('retries a 409 once, after exactly its retryAfterMs', async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(409, { error: 'active_lease', retryAfterMs: 2_500 });
    await flush();
    expect(a.fetch).toHaveBeenCalledTimes(1);
    a.clock.advance(2_499);
    await flush();
    expect(a.fetch).toHaveBeenCalledTimes(1);
    a.clock.advance(1);
    await flush();
    expect(a.fetch).toHaveBeenCalledTimes(2);
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.retry', payload: { status: 409, retryAfterMs: 2_500 } });
    a.last().respond(200, grant());
    await expect(a.pending).resolves.toBeDefined();
  });

  it('fails with session_conflict when the retry is a 409 too', async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(409, { retryAfterMs: 100 });
    await flush();
    a.clock.advance(100);
    await flush();
    a.last().respond(409, { retryAfterMs: 100 });
    expect(code(await rejection(a.pending))).toBe('session_conflict');
    expect(a.fetch).toHaveBeenCalledTimes(2);
  });

  it('a 409 without a blocker never shows the wait', async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(409, { retryAfterMs: 100 });
    await flush();
    a.clock.advance(100);
    await flush();
    a.last().respond(409, { retryAfterMs: 100 });
    expect(code(await rejection(a.pending))).toBe('session_conflict');
    expect(a.waiting).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'sign_in_required'],
    [402, 'insufficient_balance'],
    [403, 'wallet_frozen'],
    [502, 'qwen_service_unavailable'],
    [503, 'qwen_service_busy'],
  ])('maps HTTP %i to %s', async (status, expected) => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(status, { error: 'x' });
    expect(code(await rejection(a.pending))).toBe(expected);
  });

  it("frames a 402's figures in the Logs, never in the error", async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(402, { error: 'insufficient_balance', requiredMicroUsd: 500_000, balanceMicroUsd: 120_000 });
    const error = await rejection(a.pending);
    expect(a.frame).toHaveBeenCalledWith({
      direction: 'in', type: 'session.refused',
      payload: { status: 402, error: 'insufficient_balance', requiredMicroUsd: 500_000, balanceMicroUsd: 120_000 },
    });
    expect((error as Error).message).not.toMatch(/500000|120000/);
  });

  it('a region the backend cannot serve is the service being unavailable (503), by code', async () => {
    const a = acquiring(['speaker'], { settings: { region: 'cn' } });
    await flush();
    a.last().respond(503, { error: 'Qwen region not available' });
    expect(code(await rejection(a.pending))).toBe('qwen_service_busy');
  });

  it("a 400 for a region the backend does not know fails with the server's words", async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(400, { error: "Invalid region. Use 'sg' or 'cn'" });
    expect(String(await rejection(a.pending))).toContain('Invalid region');
  });

  it('fails with qwen_service_unavailable when nothing answers within 15 s', async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.clock.advance(SESSION_KEY_TIMEOUT_MS - 1);
    const early = await Promise.race([a.pending.then(() => 'settled', () => 'settled'), flush().then(() => 'pending')]);
    expect(early).toBe('pending');
    a.clock.advance(1);
    expect(code(await rejection(a.pending))).toBe('qwen_service_unavailable');
  });
});

describe('Qwen lease: a 409 that names what blocks the account', () => {
  const CONFLICT = 'Another session is already active';
  /** Answers the latest request 409 with `blocker`, then lets the lease act on it. */
  async function refuse(a: ReturnType<typeof acquiring>, blocker: Record<string, unknown>, retryAfterMs = 10_000) {
    a.last().respond(409, { error: CONFLICT, retryAfterMs, blocker });
    await flush();
  }
  /** Moves the clock `ms` and lets what it fired run. */
  async function advance(a: ReturnType<typeof acquiring>, ms: number) {
    a.clock.advance(ms);
    await flush();
  }

  it('waits out a session already ending, asking again every few seconds, and says so while it waits', async () => {
    const a = acquiring(['speaker']);
    await flush();
    await refuse(a, { state: 'ending' });
    expect(a.waiting).toHaveBeenCalledWith(true);
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.retry', payload: { status: 409, retryAfterMs: ENDING_POLL_MS, blocker: 'ending' } });
    await advance(a, ENDING_POLL_MS - 1);
    expect(a.fetch).toHaveBeenCalledTimes(1);
    await advance(a, 1);
    expect(a.fetch).toHaveBeenCalledTimes(2);
    await refuse(a, { state: 'ending' });
    await advance(a, ENDING_POLL_MS);
    expect(a.fetch).toHaveBeenCalledTimes(3);
    a.last().respond(200, grant());
    await expect(a.pending).resolves.toBeDefined();
    expect(a.waiting.mock.calls).toEqual([[true], [false]]);
  });

  it("waits a never-started lease out to its expiry, even one holding a Qwen lease's whole 75 s start window", async () => {
    const a = acquiring(['speaker']);
    await flush();
    await refuse(a, { state: 'unstarted', clearsInMs: 75_000 });
    expect(a.waiting).toHaveBeenCalledWith(true);
    await advance(a, 75_999);
    expect(a.fetch).toHaveBeenCalledTimes(1);
    await advance(a, 1);
    expect(a.fetch).toHaveBeenCalledTimes(2);
    a.last().respond(200, grant());
    await expect(a.pending).resolves.toBeDefined();
  });

  it('asks again a moment after a lease freed as it was read', async () => {
    const a = acquiring(['speaker']);
    await flush();
    await refuse(a, { state: 'released' });
    await advance(a, RELEASED_RETRY_MS);
    expect(a.fetch).toHaveBeenCalledTimes(2);
    a.last().respond(200, grant());
    await expect(a.pending).resolves.toBeDefined();
  });

  it('says another window or device is using the account when a running session still blocks after one retry', async () => {
    const a = acquiring(['speaker']);
    await flush();
    await refuse(a, { state: 'active' });
    // Not a wait for the previous session: nothing says this one is ending.
    expect(a.waiting).not.toHaveBeenCalled();
    await advance(a, 10_000);
    expect(a.fetch).toHaveBeenCalledTimes(2);
    await refuse(a, { state: 'active' });
    const error = await rejection(a.pending);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(code(error)).toBe('session_in_use');
    await advance(a, 120_000);
    expect(a.fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up on a previous session that has not cleared within the limit, and asks no more', async () => {
    const a = acquiring(['speaker']);
    await flush();
    for (let elapsed = 0; elapsed + ENDING_POLL_MS <= CONFLICT_WAIT_LIMIT_MS; elapsed += ENDING_POLL_MS) {
      await refuse(a, { state: 'ending' });
      await advance(a, ENDING_POLL_MS);
    }
    const asked = a.fetch.mock.calls.length;
    await refuse(a, { state: 'ending' });
    expect(code(await rejection(a.pending))).toBe('previous_session_ending');
    await advance(a, 120_000);
    expect(a.fetch).toHaveBeenCalledTimes(asked);
    expect(a.waiting.mock.calls).toEqual([[true], [false]]);
  });

  it('does not wait for a never-started lease that clears past the limit', async () => {
    const a = acquiring(['speaker']);
    await flush();
    await refuse(a, { state: 'unstarted', clearsInMs: 150_000 });
    expect(code(await rejection(a.pending))).toBe('previous_session_ending');
    expect(a.fetch).toHaveBeenCalledTimes(1);
    expect(a.waiting).not.toHaveBeenCalled();
  });

  it('a cancel ends the wait at once', async () => {
    const a = acquiring(['speaker']);
    await flush();
    await refuse(a, { state: 'ending' });
    const stop = new Error('stop');
    a.controller.abort(stop);
    expect(await rejection(a.pending)).toBe(stop);
    await advance(a, 120_000);
    expect(a.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Qwen lease: the grant ends the run', () => {
  it('a grant held to the 3 600 s cap ends as an expected segment', async () => {
    const a = await granted(['speaker'], {}, { maxSessionDurationSeconds: 3_600 });
    a.clock.advance(3_599_999);
    expect(a.end).not.toHaveBeenCalled();
    a.clock.advance(1);
    expect(a.end).toHaveBeenCalledWith({ code: 'segment_ended', message: expect.any(String) }, { expected: true });
  });

  it('a shorter grant ends as the budget running out, unexpected', async () => {
    const a = await granted(['speaker'], {}, { maxSessionDurationSeconds: 985 });
    a.clock.advance(984_999);
    expect(a.end).not.toHaveBeenCalled();
    a.clock.advance(1);
    expect(a.end).toHaveBeenCalledTimes(1);
    expect(a.end).toHaveBeenCalledWith({ code: 'budget_exhausted', message: expect.any(String) }, { expected: false });
  });

  it('release before the end cancels the timer', async () => {
    const a = await granted(['speaker']);
    const released = a.resources.release();
    await flush();
    a.to('/qwen/session-end')[0].respond(200);
    await released;
    expect(a.clock.pending()).toBe(0);
    a.clock.advance(600_000);
    expect(a.end).not.toHaveBeenCalled();
  });
});

const UUID_1 = '6c862ba2-2beb-9263-b94a-e6789bdd25bf';
const UUID_2 = 'a1b2c3d4-0000-4000-8000-0123456789ab';
const UUID_FIXTURE = 'f00dfeed-7f3a-4c1d-9e2b-00aa11bb22cc';

describe('Qwen lease: the session report', () => {
  it('posts session-started once per (leg, id) with keepalive and both ids', async () => {
    const a = await granted(['speaker', 'participant']);
    const port = a.resources.credentials('speaker').lease!;
    port.sessionCreated('sess_a', UUID_1);
    port.sessionCreated('sess_a', UUID_1);
    await flush();
    const posts = a.to('/qwen/session-started');
    expect(posts).toHaveLength(1);
    expect(posts[0].init.keepalive).toBe(true);
    expect(posts[0].init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(JSON.parse(posts[0].init.body as string)).toEqual({ leaseId: 'lease-1', leg: 'speaker', taskUuid: 'sess_a', requestId: UUID_1 });
    // The other leg's same id is its own report; a new id on the first leg too.
    a.resources.credentials('participant').lease!.sessionCreated('sess_a', UUID_2);
    port.sessionCreated('sess_b', undefined);
    await flush();
    expect(a.to('/qwen/session-started')).toHaveLength(3);
  });

  it('leaves requestId out of the body when there is none', async () => {
    const a = await granted(['speaker']);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', undefined);
    await flush();
    const body = JSON.parse(a.to('/qwen/session-started')[0].init.body as string);
    expect(body).toEqual({ leaseId: 'lease-1', leg: 'speaker', taskUuid: 'sess_a' });
    expect(body).not.toHaveProperty('requestId');
  });

  it('sends requestId only as a lowercase UUID, never rewritten: anything else is left out', async () => {
    const a = await granted(['speaker']);
    const port = a.resources.credentials('speaker').lease!;
    port.sessionCreated('sess_a', UUID_1.toUpperCase());
    port.sessionCreated('sess_b', 'not-a-uuid');
    port.sessionCreated('sess_c', UUID_1);
    await flush();
    const bodies = a.to('/qwen/session-started').map((p) => JSON.parse(p.init.body as string));
    expect(bodies[0]).toEqual({ leaseId: 'lease-1', leg: 'speaker', taskUuid: 'sess_a' });
    expect(bodies[1]).toEqual({ leaseId: 'lease-1', leg: 'speaker', taskUuid: 'sess_b' });
    expect(bodies[2]).toEqual({ leaseId: 'lease-1', leg: 'speaker', taskUuid: 'sess_c', requestId: UUID_1 });
    const frames = a.frame.mock.calls.map((c) => c[0]).filter((f) => f.type === 'session.started');
    expect(frames.map((f) => f.payload.withRequestId)).toEqual([false, false, true]);
  });

  it('retries a 503 at +500, +1 000 and +2 000 ms, then frames notify_failed and never ends the run', async () => {
    const a = await granted(['speaker']);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    await flush();
    a.to('/qwen/session-started')[0].respond(503);
    await flush();
    for (const [n, step] of [[2, 500], [3, 1_000], [4, 2_000]] as const) {
      a.clock.advance(step - 1);
      await flush();
      expect(a.to('/qwen/session-started')).toHaveLength(n - 1);
      a.clock.advance(1);
      await flush();
      expect(a.to('/qwen/session-started')).toHaveLength(n);
      a.last().respond(503);
      await flush();
    }
    expect(a.frame).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.notify_failed', payload: expect.objectContaining({ step: 'session-started' }) }));
    expect(a.end).not.toHaveBeenCalled();
    a.clock.advance(10_000);
    await flush();
    expect(a.to('/qwen/session-started')).toHaveLength(4);
  });

  it('retries a transport failure too', async () => {
    const a = await granted(['speaker']);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    await flush();
    a.to('/qwen/session-started')[0].fail();
    await flush();
    a.clock.advance(500);
    await flush();
    expect(a.to('/qwen/session-started')).toHaveLength(2);
  });

  it.each([409, 404, 401])('treats a %i as a refusal: framed with the status and error, not retried, run not ended', async (status) => {
    const a = await granted(['speaker']);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    await flush();
    a.to('/qwen/session-started')[0].respond(status, { error: 'lease_not_live' });
    await flush();
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.started_refused', payload: { status, error: 'lease_not_live', leg: 'speaker' } });
    a.clock.advance(10_000);
    await flush();
    expect(a.to('/qwen/session-started')).toHaveLength(1);
    expect(a.end).not.toHaveBeenCalled();
  });

  it('posts nothing after release, and a report in flight at release is not retried', async () => {
    const a = await granted(['speaker']);
    const port = a.resources.credentials('speaker').lease!;
    port.sessionCreated('sess_a', 'rid');
    await flush();
    const released = a.resources.release();
    await flush();
    a.to('/qwen/session-started')[0].respond(503);
    a.to('/qwen/session-end')[0].respond(200);
    await released;
    a.clock.advance(10_000);
    await flush();
    port.sessionCreated('sess_late', 'rid');
    await flush();
    expect(a.to('/qwen/session-started')).toHaveLength(1);
  });

  it('posts nothing once the grant has ended the run', async () => {
    const a = await granted(['speaker'], {}, { maxSessionDurationSeconds: 985 });
    a.clock.advance(985_000);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    await flush();
    expect(a.to('/qwen/session-started')).toHaveLength(0);
  });
});

describe('Qwen lease: session-end', () => {
  it('release posts session-end with the leaseId once', async () => {
    const a = await granted(['speaker']);
    const first = a.resources.release();
    const second = a.resources.release();
    await flush();
    const ends = a.to('/qwen/session-end');
    expect(ends).toHaveLength(1);
    expect(JSON.parse(ends[0].init.body as string)).toEqual({ leaseId: 'lease-1' });
    expect(ends[0].init.keepalive).toBe(true);
    ends[0].respond(200);
    await Promise.all([first, second]);
    expect(a.to('/qwen/session-end')).toHaveLength(1);
  });

  it('a new acquire cancels the previous instance’s end signal still retrying', async () => {
    const a = await granted(['speaker']);
    const released = a.resources.release();
    await flush();
    a.to('/qwen/session-end')[0].respond(503);
    await flush();
    const next = a.lease(shapeFor(['speaker']), QWEN_DEFAULTS, a.ctx);
    next.catch(() => {});
    a.clock.advance(5_000);
    await released;
    expect(a.to('/qwen/session-end')).toHaveLength(1);
  });
});

describe('Qwen lease: the report retries', () => {
  it('drops keepalive for the retry after a transport failure', async () => {
    const a = await granted(['speaker']);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    await flush();
    a.to('/qwen/session-started')[0].fail();
    await flush();
    a.clock.advance(500);
    await flush();
    const posts = a.to('/qwen/session-started');
    expect(posts[0].init.keepalive).toBe(true);
    expect(posts[1].init).not.toHaveProperty('keepalive');
  });

  it('names the last cause in notify_failed', async () => {
    const a = await granted(['speaker']);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    for (const step of [0, 500, 1_000, 2_000]) {
      a.clock.advance(step);
      await flush();
      a.last().respond(503);
      await flush();
    }
    const failed = a.frame.mock.calls.find(([f]) => f.type === 'session.notify_failed')![0];
    expect(failed.payload.message).toContain('HTTP 503');
  });

  it('release leaves no report timer behind', async () => {
    const a = await granted(['speaker']);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    await flush();
    a.to('/qwen/session-started')[0].respond(503);
    await flush();
    const released = a.resources.release();
    await flush();
    a.to('/qwen/session-end')[0].respond(200);
    await released;
    expect(a.clock.pending()).toBe(0);
  });
});

describe('Qwen lease: the grant stays out of the Logs', () => {
  it('no frame carries the request id', async () => {
    const a = await granted(['speaker']);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', UUID_FIXTURE);
    await flush();
    a.to('/qwen/session-started')[0].respond(409, { error: 'lease_not_live' });
    await flush();
    a.resources.credentials('speaker').lease!.sessionCreated('sess_b', UUID_FIXTURE);
    await flush();
    a.to('/qwen/session-started')[1].respond(503);
    await flush();
    expect(a.frame.mock.calls.some(([f]) => f.type === 'session.started')).toBe(true);
    expect(JSON.stringify(a.frame.mock.calls)).not.toContain(UUID_FIXTURE);
  });

  it('no frame carries the apiKey, whatever the run did', async () => {
    const a = await granted(['speaker']);
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    await flush();
    a.to('/qwen/session-started')[0].respond(409, { error: 'lease_not_live' });
    await flush();
    const released = a.resources.release();
    await flush();
    a.to('/qwen/session-end')[0].respond(200);
    await released;
    expect(a.frame.mock.calls.length).toBeGreaterThan(4);
    expect(JSON.stringify(a.frame.mock.calls)).not.toContain(GRANT_KEY);
    expect(JSON.stringify(a.frame.mock.calls)).not.toContain(GRANT_KEY.slice(0, 8));
  });
});
