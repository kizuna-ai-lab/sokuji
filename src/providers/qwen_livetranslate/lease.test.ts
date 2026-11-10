import { beforeEach, describe, it, expect, vi } from 'vitest';
import { accountPayer, setUseOwnBalance } from '../../lib/session/payerChoice';
import { AdapterStartError } from '../../lib/contract/adapter';
import { createVirtualClock, type VirtualClock } from '../../lib/contract/clock';
import type { LegName } from '../../lib/conversation/types';
import type { LeaseContext, RunShape } from '../../lib/session/types';
import {
  CONFLICT_WAIT_LIMIT_MS, createQwenLease, ENDING_POLL_MS, RELEASED_RETRY_MS, SESSION_KEY_TIMEOUT_MS, SESSION_STARTED_RETRY_DELAYS_MS, SESSION_STARTED_RETRY_MAX_MS,
  SESSION_STARTED_UNACKNOWLEDGED,
} from './lease';
import { fakeFrameSource } from '../../lib/contract/testing/fakeFrames';
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
  leaseId: 'lease-1', endpoint: 'intl', apiKey: GRANT_KEY, expiresAt: 60_000,
  maxSessionDurationSeconds: 600, budgetMicroUsd: 416_667, rateUsdPerHour: 2.5, ...over,
});

type Options = { textOnly?: boolean; participantSpeech?: boolean; token?: string | null; settings?: Partial<QwenSettings>; frames?: RunShape['frames']; clock?: VirtualClock };

const shapeFor = (legs: LegName[], o: Options = {}): RunShape => ({
  provider: {} as RunShape['provider'], settings: { ...QWEN_DEFAULTS, ...o.settings }, credentials: {}, pair: { source: 'ja', target: 'en' }, legs,
  turnMode: 'auto', textOnly: o.textOnly ?? false, participantSpeech: o.participantSpeech ?? false, keepReplayAudio: true, frames: o.frames,
  shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
  auth: { signedIn: o.token !== null, userId: 'u1', getToken: vi.fn(async () => (o.token === undefined ? 'tok' : o.token)) },
});

/** `acquire` in flight over a stub `fetch`, on a virtual clock; the test answers it. */
function acquiring(legs: LegName[], o: Options = {}) {
  const net = stubFetch();
  const clock = o.clock ?? createVirtualClock(0);
  const controller = new AbortController();
  const end = vi.fn();
  const frame = vi.fn();
  const waiting = vi.fn();
  const ctx: LeaseContext = { signal: controller.signal, clock, end, frame, waiting };
  const lease = createQwenLease({ fetch: net.fetch as unknown as typeof fetch, apiUrl: () => API });
  const shape = shapeFor(legs, o);
  const pending = lease(shape, { ...QWEN_DEFAULTS, ...o.settings }, ctx);
  pending.catch(() => {});
  return { ...net, shape, clock, controller, end, frame, waiting, ctx, lease, pending };
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

describe('Qwen lease: who pays', () => {
  const memberAccount = { status: 'known' as const, balanceMicroUsd: 9, frozen: false, organization: { name: 'Acme', availableMicroUsd: 9, frozen: false }, personal: { balanceMicroUsd: 5, frozen: false } };
  const withAccount = async (account: RunShape['account']) => {
    const net = stubFetch();
    const ctx: LeaseContext = { signal: new AbortController().signal, clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn(), waiting: vi.fn() };
    const lease = createQwenLease({ fetch: net.fetch as unknown as typeof fetch, apiUrl: () => API });
    lease({ ...shapeFor(['speaker']), account, ...(accountPayer(account) ? { payer: accountPayer(account) } : {}) }, QWEN_DEFAULTS, ctx).catch(() => {});
    await flush();
    return { body: JSON.parse(net.last().init.body as string), ctx };
  };
  beforeEach(() => localStorage.clear());

  it('sends no payer for a non-member, whatever the switch says', async () => {
    setUseOwnBalance(true);
    expect((await withAccount({ status: 'known', balanceMicroUsd: 9, frozen: false })).body).not.toHaveProperty('payer');
    expect((await withAccount(null)).body).not.toHaveProperty('payer');
  });

  it('sends organization for a member with the switch off, personal with it on, in the body and in the Logs', async () => {
    const off = await withAccount(memberAccount);
    expect(off.body.payer).toBe('organization');
    expect(off.ctx.frame).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.key_requested', payload: expect.objectContaining({ payer: 'organization' }) }));
    setUseOwnBalance(true);
    expect((await withAccount(memberAccount)).body.payer).toBe('personal');
  });
});

describe('Qwen lease: the session-key request', () => {
  it('asks for a speaker-only text-only run with nobody speaking', async () => {
    const a = acquiring(['speaker'], { textOnly: true });
    await flush();
    expect(JSON.parse(a.last().init.body as string)).toEqual({ legs: ['speaker'], speech: { speaker: false, participant: false }, region: 'sg', screenContext: false });
  });

  it('asks for Both with the participant spoken to me', async () => {
    const a = acquiring(['speaker', 'participant'], { participantSpeech: true });
    await flush();
    expect(JSON.parse(a.last().init.body as string)).toEqual({ legs: ['speaker', 'participant'], speech: { speaker: true, participant: true }, region: 'sg', screenContext: false });
  });

  it('asks for a participant-only run with the speaker not speaking, whatever textOnly says', async () => {
    for (const participantSpeech of [true, false]) {
      const a = acquiring(['participant'], { participantSpeech });
      await flush();
      expect(JSON.parse(a.last().init.body as string)).toEqual({ legs: ['participant'], speech: { speaker: false, participant: participantSpeech }, region: 'sg', screenContext: false });
    }
  });

  it('tells the backend whether this run has a screen: true with a source on the shape, false without', async () => {
    for (const [frames, expected] of [[fakeFrameSource(), true], [undefined, false]] as const) {
      const a = acquiring(['speaker'], { frames });
      await flush();
      expect(JSON.parse(a.last().init.body as string).screenContext).toBe(expected);
    }
  });

  it('POSTs to qwen/session-key with the sign-in token in Authorization only, and frames the body, never the token', async () => {
    const a = acquiring(['speaker']);
    await flush();
    const call = a.last();
    expect(call.url).toBe(`${API}/qwen/session-key`);
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(a.frame).toHaveBeenCalledWith({ direction: 'out', type: 'session.key_requested', payload: { legs: ['speaker'], speech: { speaker: true, participant: false }, region: 'sg', screenContext: false } });
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
    expect(credentials('speaker')).toEqual({ apiKey: GRANT_KEY, endpoint: 'intl', lease: { sessionCreated: expect.any(Function), sessionEnded: expect.any(Function), reissue: expect.any(Function) } });
    expect(credentials('participant').apiKey).toBe(GRANT_KEY);
    expect(budget).toEqual({ totalMs: 600_000, endsAt: 600_000 });
  });

  it("dials the endpoint the grant names and frames the grant's region", async () => {
    const a = await granted(['speaker'], { settings: { region: 'cn' } }, { endpoint: 'cn', region: 'cn' });
    expect(a.resources.credentials('speaker').endpoint).toBe('cn');
    expect(a.frame).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.lease_acquired', payload: expect.objectContaining({ endpoint: 'cn', region: 'cn' }) }));
  });

  it("accepts a grant that names no region, as the backend before Beijing answered", async () => {
    const a = await granted(['speaker']);
    expect(a.resources.credentials('speaker').endpoint).toBe('intl');
    expect(a.frame).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.lease_acquired', payload: expect.not.objectContaining({ region: expect.anything() }) }));
  });

  it('refuses a grant for another region than the one picked: a pick never runs elsewhere in silence', async () => {
    // A Beijing pick answered in no region (the backend before Beijing) or in Singapore; a Singapore pick answered in Beijing.
    const cases: Array<[QwenSettings['region'], Record<string, unknown>, string | null]> = [
      ['cn', grant(), null],
      ['cn', grant({ endpoint: 'intl', region: 'sg' }), 'sg'],
      ['sg', grant({ endpoint: 'cn', region: 'cn' }), 'cn'],
    ];
    for (const [region, answered, served] of cases) {
      const a = acquiring(['speaker'], { settings: { region } });
      await flush();
      a.last().respond(200, answered);
      const error = await rejection(a.pending);
      expect(code(error), region).toBe('qwen_region_unavailable');
      expect(String(error)).not.toContain(GRANT_KEY);
      expect(a.frame).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.refused', payload: expect.objectContaining({ region, served }) }));
    }
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
    [503, 'qwen_service_unavailable'],
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

  // The backend's three 503s, told apart by its `error`: only its per-minute cap is "busy".
  it.each([
    [{ error: 'qwen_busy', retryAfterMs: 1200 }, 'qwen_service_busy'],
    [{ error: 'Qwen region not available' }, 'qwen_region_unavailable'],
    [{ error: 'Wallet unavailable' }, 'qwen_service_unavailable'],
  ])('reads a 503 answering %j as %s', async (body, expected) => {
    const a = acquiring(['speaker'], { settings: { region: 'cn' } });
    await flush();
    a.last().respond(503, body);
    expect(code(await rejection(a.pending))).toBe(expected);
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

  it('a 5xx is tried again a second later, and the 2xx after it is the report: nothing more goes out, and the run is not ended', async () => {
    const a = await granted(['speaker']);
    const started = () => a.to('/qwen/session-started');
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', UUID_1);
    await flush();
    started()[0].respond(503);
    await flush();
    a.clock.advance(SESSION_STARTED_RETRY_DELAYS_MS[0] - 1);
    await flush();
    expect(started()).toHaveLength(1);
    a.clock.advance(1);
    await flush();
    expect(started()).toHaveLength(2);
    // The same report again: the backend takes a repeat of a stored report as an idempotent retry.
    expect(started()[1].init.body).toBe(started()[0].init.body);
    started()[1].respond(200, { ok: true });
    await flush();
    a.clock.advance(120_000);
    await flush();
    expect(started()).toHaveLength(2);
    expect(a.frame).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.notify_failed' }));
    expect(a.end).not.toHaveBeenCalled();
  });

  it('a transport failure or a 5xx is tried again 1, 2, 5 and 10 s later, then every 30 s, while the connection is open', async () => {
    expect(SESSION_STARTED_RETRY_DELAYS_MS).toEqual([1_000, 2_000, 5_000, 10_000]);
    expect(SESSION_STARTED_RETRY_MAX_MS).toBe(30_000);
    const a = await granted(['speaker']);
    const started = () => a.to('/qwen/session-started');
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', UUID_1);
    await flush();
    const at: number[] = [a.clock.now()];
    for (const [i, delay] of [1_000, 2_000, 5_000, 10_000, 30_000, 30_000, 30_000].entries()) {
      const last = started()[started().length - 1];
      if (i % 2 === 0) last.fail();
      else last.respond(502);
      await flush();
      a.clock.advance(delay - 1);
      await flush();
      expect(started()).toHaveLength(at.length);
      a.clock.advance(1);
      await flush();
      expect(started()).toHaveLength(at.length + 1);
      at.push(a.clock.now());
    }
    expect(at).toEqual([0, 1_000, 3_000, 8_000, 18_000, 48_000, 78_000, 108_000]);
    // Nothing in the Logs while it is tried: the connection is still open.
    expect(a.frame).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.notify_failed' }));
    expect(a.end).not.toHaveBeenCalled();
    started()[started().length - 1].respond(200);
    await flush();
    a.clock.advance(120_000);
    await flush();
    expect(started()).toHaveLength(8);
  });

  it("the retries stop when the session's connection ends, saying the report was never acknowledged and why", async () => {
    const a = await granted(['speaker']);
    const port = a.resources.credentials('speaker').lease!;
    const before = a.clock.pending();
    port.sessionCreated('sess_a', UUID_1);
    await flush();
    a.to('/qwen/session-started')[0].respond(503);
    await flush();
    expect(a.clock.pending()).toBe(before + 1);
    port.sessionEnded('sess_a');
    expect(a.clock.pending()).toBe(before);
    await flush();
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-started', leg: 'speaker', message: SESSION_STARTED_UNACKNOWLEDGED, cause: 'HTTP 503' } });
    a.clock.advance(120_000);
    await flush();
    expect(a.to('/qwen/session-started')).toHaveLength(1);

    // A connection that ends with a try in flight: that try is the last, unless it is acknowledged.
    const b = await granted(['speaker']);
    const portB = b.resources.credentials('speaker').lease!;
    portB.sessionCreated('sess_a', UUID_1);
    await flush();
    portB.sessionEnded('sess_a');
    b.to('/qwen/session-started')[0].fail();
    await flush();
    b.clock.advance(120_000);
    await flush();
    expect(b.to('/qwen/session-started')).toHaveLength(1);
    expect(b.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-started', leg: 'speaker', message: SESSION_STARTED_UNACKNOWLEDGED, cause: 'Failed to fetch' } });

    // A connection that ends once its report was acknowledged: nothing to say.
    const c = await granted(['speaker']);
    const portC = c.resources.credentials('speaker').lease!;
    portC.sessionCreated('sess_a', UUID_1);
    await flush();
    c.to('/qwen/session-started')[0].respond(200);
    await flush();
    portC.sessionEnded('sess_a');
    await flush();
    expect(c.frame).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.notify_failed' }));
  });

  it("only that session's retries stop: the other leg's, and the same leg's next session's, go on", async () => {
    const a = await granted(['speaker', 'participant']);
    const speaker = a.resources.credentials('speaker').lease!;
    a.resources.credentials('participant').lease!.sessionCreated('sess_a', UUID_2);
    speaker.sessionCreated('sess_a', UUID_1);
    speaker.sessionCreated('sess_b', undefined);
    await flush();
    for (const post of a.to('/qwen/session-started')) post.respond(503);
    await flush();
    speaker.sessionEnded('sess_a');
    // An id never reported, or another leg's, ends nothing.
    speaker.sessionEnded('sess_zzz');
    a.clock.advance(SESSION_STARTED_RETRY_DELAYS_MS[0]);
    await flush();
    const bodies = a.to('/qwen/session-started').slice(3).map((p) => JSON.parse(p.init.body as string));
    expect(bodies).toEqual([
      { leaseId: 'lease-1', leg: 'participant', taskUuid: 'sess_a', requestId: UUID_2 },
      { leaseId: 'lease-1', leg: 'speaker', taskUuid: 'sess_b' },
    ]);
  });

  it.each([409, 404, 401])('treats a %i as a refusal: framed with the status and error, not retried, run not ended', async (status) => {
    const a = await granted(['speaker']);
    const before = a.clock.pending();
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    await flush();
    a.to('/qwen/session-started')[0].respond(status, { error: 'lease_not_live' });
    await flush();
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.started_refused', payload: { status, error: 'lease_not_live', leg: 'speaker' } });
    expect(a.clock.pending()).toBe(before);
    a.clock.advance(120_000);
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
    a.clock.advance(SESSION_STARTED_RETRY_DELAYS_MS[0]);
    await flush();
    const posts = a.to('/qwen/session-started');
    expect(posts[0].init.keepalive).toBe(true);
    expect(posts[1].init).not.toHaveProperty('keepalive');
  });

  it("names the last try's cause when the report is let go", async () => {
    const a = await granted(['speaker']);
    const port = a.resources.credentials('speaker').lease!;
    port.sessionCreated('sess_a', 'rid');
    await flush();
    a.last().fail();
    await flush();
    a.clock.advance(SESSION_STARTED_RETRY_DELAYS_MS[0]);
    await flush();
    a.last().respond(503);
    await flush();
    port.sessionEnded('sess_a');
    await flush();
    const failed = a.frame.mock.calls.filter(([f]) => f.type === 'session.notify_failed').map(([f]) => f.payload);
    expect(failed).toEqual([{ step: 'session-started', leg: 'speaker', message: SESSION_STARTED_UNACKNOWLEDGED, cause: 'HTTP 503' }]);
  });

  it("a release, the run's abort and the grant's end each cancel a pending retry: none outlives the lease, and each says the report went unacknowledged", async () => {
    /** A lease whose report waits to be tried again; `before` is the timers it held before the report (its budget's). */
    const pendingRetry = async (over: Record<string, unknown> = {}) => {
      const a = await granted(['speaker'], {}, over);
      const before = a.clock.pending();
      a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
      await flush();
      a.to('/qwen/session-started')[0].respond(503);
      await flush();
      expect(a.clock.pending()).toBe(before + 1);
      return { ...a, before };
    };
    const triedOnce = async (a: Awaited<ReturnType<typeof pendingRetry>>) => {
      a.clock.advance(120_000);
      await flush();
      expect(a.to('/qwen/session-started')).toHaveLength(1);
      expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-started', leg: 'speaker', message: SESSION_STARTED_UNACKNOWLEDGED, cause: 'HTTP 503' } });
    };

    const released = await pendingRetry();
    const releasing = released.resources.release();
    await flush();
    released.to('/qwen/session-end')[0].respond(200);
    await releasing;
    expect(released.clock.pending()).toBe(0);
    await triedOnce(released);

    // The run's abort (its dispose) comes before the release: the retry goes with it, the budget waits for the release.
    const aborted = await pendingRetry();
    aborted.controller.abort();
    expect(aborted.clock.pending()).toBe(aborted.before);
    await triedOnce(aborted);

    // The grant ends the run 60 s in, its report still waiting.
    const granted60 = await pendingRetry({ maxSessionDurationSeconds: 60 });
    granted60.clock.advance(59_999);
    await flush();
    const tries = granted60.to('/qwen/session-started');
    for (const post of tries.slice(1)) post.respond(503);
    await flush();
    const asked = granted60.to('/qwen/session-started').length;
    granted60.clock.advance(1);
    expect(granted60.end).toHaveBeenCalledTimes(1);
    expect(granted60.clock.pending()).toBe(0);
    granted60.clock.advance(120_000);
    await flush();
    expect(granted60.to('/qwen/session-started')).toHaveLength(asked);
  });

  it("a retry whose wait ends in the same clock step as the grant posts nothing: the run ended before the try", async () => {
    const a = await granted(['speaker'], {}, { maxSessionDurationSeconds: 2 });
    a.resources.credentials('speaker').lease!.sessionCreated('sess_a', 'rid');
    await flush();
    a.to('/qwen/session-started')[0].respond(503);
    await flush();
    // The retry is due at 1 s and the grant ends at 2 s: one step fires both before the retry's try can run.
    a.clock.advance(2_000);
    await flush();
    expect(a.end).toHaveBeenCalledTimes(1);
    expect(a.to('/qwen/session-started')).toHaveLength(1);
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-started', leg: 'speaker', message: SESSION_STARTED_UNACKNOWLEDGED, cause: 'HTTP 503' } });
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

describe('Qwen lease: reissue', () => {
  const FRESH = 'st-fresh-0002';
  const FRESH_2 = 'st-fresh-0003';
  const REISSUE = '/qwen/session-key/reissue';
  const reissuer = async (legs: LegName[] = ['speaker', 'participant'], o: AcquireOptions = {}, over: Record<string, unknown> = {}) => {
    const a = await granted(legs, o, over);
    const ports = Object.fromEntries(legs.map((leg) => [leg, a.resources.credentials(leg).lease!]));
    return { ...a, ports };
  };
  /** A drop that began now, on the run's clock: what a reconnecting leg asks with. */
  const dropNow = (a: { clock: { now(): number } }) => ({ notBefore: a.clock.now() });
  /** A token fetched for a drop at `at`, answered then: the cache's, fetched at `at`. */
  const fetched = async (a: Awaited<ReturnType<typeof reissuer>>, at: number, apiKey = FRESH, expiresAt = at + 60_000) => {
    a.clock.advance(at - a.clock.now());
    const p = a.ports.speaker.reissue({ notBefore: at });
    await flush();
    a.to(REISSUE)[a.to(REISSUE).length - 1].respond(200, { apiKey, expiresAt });
    await expect(p).resolves.toEqual({ ok: true, apiKey, expiresAt, fresh: true });
  };

  it("the grant's token is the Start's alone: a reconnect's first ask makes a request, even in the grant's first second", async () => {
    const a = await reissuer();
    const p = a.ports.speaker.reissue({ notBefore: 0 });
    await flush();
    expect(a.to(REISSUE)).toHaveLength(1);
    a.to(REISSUE)[0].respond(200, { apiKey: FRESH, expiresAt: 60_000 });
    await expect(p).resolves.toEqual({ ok: true, apiKey: FRESH, expiresAt: 60_000, fresh: true });
  });

  it("a reissue asked with a notBefore later than the cached token's fetch makes a request, though the cached token is still valid", async () => {
    const a = await reissuer();
    await fetched(a, 1_000, FRESH, 120_000);
    // A new drop 10 s on: the cached token has 109 s left, and was minted before it.
    a.clock.advance(10_000);
    const p = a.ports.speaker.reissue(dropNow(a));
    await flush();
    expect(a.to(REISSUE)).toHaveLength(2);
    a.to(REISSUE)[1].respond(200, { apiKey: FRESH_2, expiresAt: 131_000 });
    await expect(p).resolves.toEqual({ ok: true, apiKey: FRESH_2, expiresAt: 131_000, fresh: true });
  });

  it("a second ask during the same drop, at or after its token's fetch, reuses it with no request: the drop's next attempt, or the other leg dropped in the same blip", async () => {
    const a = await reissuer();
    // A drop at 1 000 whose request is answered at 1 400.
    a.clock.advance(1_000);
    const first = a.ports.speaker.reissue({ notBefore: 1_000 });
    await flush();
    a.clock.advance(400);
    a.to(REISSUE)[0].respond(200, { apiKey: FRESH, expiresAt: 61_400 });
    await first;
    a.clock.advance(250);
    const cachedAnswer = { ok: true, apiKey: FRESH, expiresAt: 61_400, fresh: false };
    // The drop's next attempt; the other leg, dropped before the answer; and one dropped the very moment it came.
    await expect(a.ports.speaker.reissue({ notBefore: 1_000 })).resolves.toEqual(cachedAnswer);
    await expect(a.ports.participant.reissue({ notBefore: 1_200 })).resolves.toEqual(cachedAnswer);
    await expect(a.ports.participant.reissue({ notBefore: 1_400 })).resolves.toEqual(cachedAnswer);
    expect(a.to(REISSUE)).toHaveLength(1);
    // A drop a moment after the fetch is a new one.
    const later = a.ports.participant.reissue({ notBefore: 1_401 });
    await flush();
    expect(a.to(REISSUE)).toHaveLength(2);
    a.to(REISSUE)[1].respond(200, { apiKey: FRESH_2, expiresAt: 61_650 });
    await expect(later).resolves.toMatchObject({ ok: true, apiKey: FRESH_2, fresh: true });
  });

  it("a token fetched since the drop is still not served within 5 s of its expiry", async () => {
    const a = await reissuer(['speaker']);
    await fetched(a, 0, FRESH, 20_000);
    a.clock.advance(14_999);
    await expect(a.ports.speaker.reissue({ notBefore: 0 })).resolves.toMatchObject({ apiKey: FRESH, fresh: false });
    a.clock.advance(1);
    const p = a.ports.speaker.reissue({ notBefore: 0 });
    await flush();
    expect(a.to(REISSUE)).toHaveLength(2);
    a.to(REISSUE)[1].respond(200, { apiKey: FRESH_2, expiresAt: 75_000 });
    await expect(p).resolves.toMatchObject({ apiKey: FRESH_2, fresh: true });
  });

  it('a fetch time ahead of now — a wall clock stepped back — proves nothing: a request is made', async () => {
    const inner = createVirtualClock(0);
    let back = 0;
    const clock: VirtualClock = { now: () => inner.now() - back, setTimeout: (fn, ms) => inner.setTimeout(fn, ms), advance: (ms) => inner.advance(ms), pending: () => inner.pending() };
    const a = await reissuer(['speaker'], { clock });
    await fetched(a, 5_000, FRESH, 65_000);
    back = 4_000;
    // A drop at 1 000 by the stepped-back clock, which reads the token as fetched after it.
    const p = a.ports.speaker.reissue({ notBefore: 1_000 });
    await flush();
    expect(a.to(REISSUE)).toHaveLength(2);
    a.to(REISSUE)[1].respond(200, { apiKey: FRESH_2, expiresAt: 61_000 });
    await expect(p).resolves.toMatchObject({ apiKey: FRESH_2, fresh: true });
  });

  it('a token once fetched ahead of now is dropped, not served when the stepped-back clock catches up after a failed ask', async () => {
    const inner = createVirtualClock(0);
    let back = 0;
    const clock: VirtualClock = { now: () => inner.now() - back, setTimeout: (fn, ms) => inner.setTimeout(fn, ms), advance: (ms) => inner.advance(ms), pending: () => inner.pending() };
    const a = await reissuer(['speaker'], { clock });
    await fetched(a, 5_000, FRESH, 65_000);
    back = 4_000;
    // A drop the stepped-back clock reads as 1 000, its first ask failing: the network is still down.
    const dropAt = clock.now();
    const first = a.ports.speaker.reissue({ notBefore: dropAt });
    await flush();
    a.to(REISSUE)[1].respond(503, { error: 'unavailable' });
    await expect(first).resolves.toMatchObject({ ok: false, retry: true });
    // A later attempt of the same drop, once the clock reads past the token's fetch: still a request, never the older token.
    a.clock.advance(6_000);
    const later = a.ports.speaker.reissue({ notBefore: dropAt });
    await flush();
    expect(a.to(REISSUE)).toHaveLength(3);
    a.to(REISSUE)[2].respond(200, { apiKey: FRESH_2, expiresAt: 67_000 });
    await expect(later).resolves.toMatchObject({ apiKey: FRESH_2, fresh: true });
  });

  it("a reissued token that names no expiry is taken to last 55 s", async () => {
    const a = await reissuer(['speaker']);
    a.clock.advance(2_000);
    const p = a.ports.speaker.reissue(dropNow(a));
    await flush();
    a.to(REISSUE)[0].respond(200, { apiKey: FRESH });
    await expect(p).resolves.toEqual({ ok: true, apiKey: FRESH, expiresAt: 57_000, fresh: true });
  });

  it('both legs asking together make one request, whatever their drops', async () => {
    const a = await reissuer();
    a.clock.advance(3_000);
    const speaker = a.ports.speaker.reissue({ notBefore: 3_000 });
    const participant = a.ports.participant.reissue({ notBefore: 2_990 });
    await flush();
    expect(a.to(REISSUE)).toHaveLength(1);
    const call = a.to(REISSUE)[0];
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(JSON.parse(call.init.body as string)).toEqual({ leaseId: 'lease-1' });
    call.respond(200, { leaseId: 'lease-1', region: 'sg', endpoint: 'intl', apiKey: FRESH, expiresAt: 120_000 });
    // Both answered by the one request: each leg's call fetched new credentials.
    const ok = { ok: true, apiKey: FRESH, expiresAt: 120_000, fresh: true };
    await expect(speaker).resolves.toEqual(ok);
    await expect(participant).resolves.toEqual(ok);
    // The new token is the lease's now: a later ask for the same drop reuses it, from the cache.
    await expect(a.ports.participant.reissue({ notBefore: 2_990 })).resolves.toEqual({ ...ok, fresh: false });
    expect(a.to(REISSUE)).toHaveLength(1);
    expect(JSON.stringify(a.frame.mock.calls)).not.toContain(FRESH);
  });

  it('asks again once the shared request has settled without a token', async () => {
    const a = await reissuer(['speaker']);
    const first = a.ports.speaker.reissue(dropNow(a));
    await flush();
    a.to(REISSUE)[0].respond(503, { error: 'qwen_busy', retryAfterMs: 1000 });
    await first;
    const second = a.ports.speaker.reissue(dropNow(a));
    await flush();
    expect(a.to(REISSUE)).toHaveLength(2);
    a.to(REISSUE)[1].respond(200, { apiKey: FRESH, expiresAt: 120_000 });
    await expect(second).resolves.toMatchObject({ ok: true, apiKey: FRESH, fresh: true });
  });

  it('a token Qwen refused is dropped from the cache and fetched again, while it is still valid', async () => {
    const a = await reissuer(['speaker']);
    await fetched(a, 0, FRESH, 120_000);
    const p = a.ports.speaker.reissue({ notBefore: 0, refused: FRESH });
    await flush();
    expect(a.to(REISSUE)).toHaveLength(2);
    a.to(REISSUE)[1].respond(200, { apiKey: FRESH_2, expiresAt: 120_000 });
    await expect(p).resolves.toEqual({ ok: true, apiKey: FRESH_2, expiresAt: 120_000, fresh: true });
    await expect(a.ports.speaker.reissue({ notBefore: 0 })).resolves.toEqual({ ok: true, apiKey: FRESH_2, expiresAt: 120_000, fresh: false });
    expect(a.to(REISSUE)).toHaveLength(2);
  });

  it('both legs refused the same token make one request; a refusal of a token the cache no longer holds is answered from the cache', async () => {
    const a = await reissuer();
    await fetched(a, 0, FRESH, 120_000);
    const speaker = a.ports.speaker.reissue({ notBefore: 0, refused: FRESH });
    const participant = a.ports.participant.reissue({ notBefore: 0, refused: FRESH });
    await flush();
    expect(a.to(REISSUE)).toHaveLength(2);
    a.to(REISSUE)[1].respond(200, { apiKey: FRESH_2, expiresAt: 120_000 });
    await expect(speaker).resolves.toMatchObject({ ok: true, apiKey: FRESH_2, fresh: true });
    await expect(participant).resolves.toMatchObject({ ok: true, apiKey: FRESH_2, fresh: true });
    // A leg that dialled the old token and was refused after the other leg's fetch landed: the new token, no request.
    await expect(a.ports.participant.reissue({ notBefore: 0, refused: FRESH })).resolves.toEqual({ ok: true, apiKey: FRESH_2, expiresAt: 120_000, fresh: false });
    expect(a.to(REISSUE)).toHaveLength(2);
  });

  it('a refused token whose fetch fails is not served again', async () => {
    const a = await reissuer(['speaker']);
    await fetched(a, 0, FRESH, 120_000);
    const first = a.ports.speaker.reissue({ notBefore: 0, refused: FRESH });
    await flush();
    a.to(REISSUE)[1].respond(503, { error: 'qwen_busy' });
    await expect(first).resolves.toMatchObject({ ok: false, retry: true });
    const second = a.ports.speaker.reissue({ notBefore: 0 });
    await flush();
    expect(a.to(REISSUE)).toHaveLength(3);
    a.to(REISSUE)[2].respond(200, { apiKey: FRESH_2, expiresAt: 120_000 });
    await expect(second).resolves.toMatchObject({ ok: true, apiKey: FRESH_2, fresh: true });
  });

  it('sends the fresh bearer from getToken, falling back to the cached one when it fails', async () => {
    const a = await reissuer(['speaker']);
    const getToken = a.shape.auth.getToken as ReturnType<typeof vi.fn>;
    getToken.mockResolvedValueOnce('tok-fresh');
    const first = a.ports.speaker.reissue(dropNow(a));
    await flush();
    expect((a.to(REISSUE)[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-fresh');
    a.to(REISSUE)[0].respond(503, { error: 'qwen_busy' });
    await first;
    getToken.mockRejectedValueOnce(new Error('offline'));
    const second = a.ports.speaker.reissue(dropNow(a));
    await flush();
    expect((a.to(REISSUE)[1].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    a.to(REISSUE)[1].respond(503, { error: 'qwen_busy' });
    await second;
  });

  it('a hung getToken is bounded by the timeout', async () => {
    const a = await reissuer(['speaker']);
    (a.shape.auth.getToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));
    const p = a.ports.speaker.reissue(dropNow(a));
    await flush();
    a.clock.advance(SESSION_KEY_TIMEOUT_MS);
    await expect(p).resolves.toMatchObject({ ok: false, retry: true });
    expect(a.to(REISSUE)).toHaveLength(0);
  });

  const mapping: Array<[number, unknown, unknown]> = [
    [401, { code: 'sign_in_required' }, { ok: false, retry: false, code: 'sign_in_required' }],
    [403, { code: 'wallet_frozen' }, { ok: false, retry: false, code: 'wallet_frozen' }],
    [409, { code: 'lease_ended' }, { ok: false, retry: false, code: 'lease_ended' }],
    [409, { code: 'reissue_limit' }, { ok: false, retry: false, code: 'reissue_limit' }],
    [429, { error: 'rate', retryAfterMs: 1000 }, { ok: false, retry: true }],
    [503, { error: 'qwen_busy', retryAfterMs: 1000 }, { ok: false, retry: true }],
    [500, { error: 'boom' }, { ok: false, retry: true }],
    [502, null, { ok: false, retry: true }],
    [404, { error: 'Not found' }, { ok: false, retry: false, code: 'unsupported' }],
    [400, { error: 'bad' }, { ok: false, retry: false, code: 'unsupported' }],
  ];
  for (const [status, body, expected] of mapping) {
    it(`maps ${status} ${JSON.stringify(body)} to ${JSON.stringify(expected)}`, async () => {
      const a = await reissuer(['speaker']);
      const p = a.ports.speaker.reissue(dropNow(a));
      await flush();
      a.to(REISSUE)[0].respond(status, body ?? undefined);
      await expect(p).resolves.toMatchObject(expected as object);
    });
  }

  it('maps a 403 for a frozen organization to org_wallet_frozen with the organization and role, a plain 403 to wallet_frozen', async () => {
    const org = await reissuer(['speaker']);
    org.shape.account = { status: 'known' as const, balanceMicroUsd: 0, frozen: false, organization: { name: 'Acme', availableMicroUsd: 0, frozen: false, role: 'owner' as const } };
    const p = org.ports.speaker.reissue(dropNow(org));
    await flush();
    org.to(REISSUE)[0].respond(403, { error: 'Wallet is frozen', code: 'wallet_frozen', subject: 'organization' });
    await expect(p).resolves.toMatchObject({ ok: false, retry: false, code: 'org_wallet_frozen', params: { organization: 'Acme', role: 'owner' } });
    const plain = await reissuer(['speaker']);
    const q = plain.ports.speaker.reissue(dropNow(plain));
    await flush();
    plain.to(REISSUE)[0].respond(403, { code: 'wallet_frozen' });
    const answer = await q;
    expect(answer).toMatchObject({ code: 'wallet_frozen' });
    expect(answer).not.toHaveProperty('params');
  });

  it('a 200 without a key is a retry', async () => {
    const a = await reissuer(['speaker']);
    const p = a.ports.speaker.reissue(dropNow(a));
    await flush();
    a.to(REISSUE)[0].respond(200, { leaseId: 'lease-1' });
    await expect(p).resolves.toMatchObject({ ok: false, retry: true });
  });

  it('a transport failure is a retry', async () => {
    const a = await reissuer(['speaker']);
    const p = a.ports.speaker.reissue(dropNow(a));
    await flush();
    a.to(REISSUE)[0].fail();
    await expect(p).resolves.toMatchObject({ ok: false, retry: true });
  });

  it('a request that never answers is a retry at the timeout, and leaves no timer behind', async () => {
    const a = await reissuer(['speaker']);
    const p = a.ports.speaker.reissue(dropNow(a));
    await flush();
    a.clock.advance(SESSION_KEY_TIMEOUT_MS);
    await expect(p).resolves.toMatchObject({ ok: false, retry: true });
    a.resources.release();
    await flush();
  });

  it('an already-aborted context sends no request and answers retry', async () => {
    const a = await reissuer(['speaker']);
    a.controller.abort();
    await expect(a.ports.speaker.reissue(dropNow(a))).resolves.toMatchObject({ ok: false, retry: true });
    expect(a.to(REISSUE)).toHaveLength(0);
  });

  it('an abort while the request is out answers retry', async () => {
    const a = await reissuer(['speaker']);
    const p = a.ports.speaker.reissue(dropNow(a));
    await flush();
    a.controller.abort();
    await expect(p).resolves.toMatchObject({ ok: false, retry: true });
  });

  it('answers lease_ended without a request after release', async () => {
    const a = await reissuer(['speaker']);
    void a.resources.release();
    await flush();
    const before = a.to(REISSUE).length;
    await expect(a.ports.speaker.reissue(dropNow(a))).resolves.toMatchObject({ ok: false, retry: false, code: 'lease_ended' });
    expect(a.to(REISSUE).length).toBe(before);
  });
});

describe('Qwen lease: refusals for organization payers', () => {
  const account = { status: 'known' as const, balanceMicroUsd: 0, frozen: false, organization: { name: 'Acme', availableMicroUsd: 0, frozen: false, role: 'member' as const }, personal: { balanceMicroUsd: 5, frozen: false } };
  /** The refusal a start meets; `payer` is what the request carried, not the switch. */
  const refused = async (status: number, body: unknown, over: Partial<RunShape> = {}) => {
    const net = stubFetch();
    const ctx: LeaseContext = { signal: new AbortController().signal, clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn(), waiting: vi.fn() };
    const lease = createQwenLease({ fetch: net.fetch as unknown as typeof fetch, apiUrl: () => API });
    const pending = lease({ ...shapeFor(['speaker']), account, ...over }, QWEN_DEFAULTS, ctx);
    pending.catch(() => {});
    await flush();
    net.last().respond(status, body);
    return rejection(pending) as Promise<AdapterStartError>;
  };
  beforeEach(() => localStorage.clear());

  it('words a 402 whose reason is org_balance_held', async () => {
    const e = await refused(402, { error: 'Insufficient balance', reason: 'org_balance_held', availableMicroUsd: 3 }, { payer: 'organization' });
    expect(e).toMatchObject({ code: 'org_balance_held' });
  });

  it('words a 402 insufficient_balance as the organization\'s when the request was organization-paid, with the name and role', async () => {
    const e = await refused(402, { error: 'Insufficient balance', reason: 'insufficient_balance', availableMicroUsd: 3 }, { payer: 'organization' });
    expect(e).toMatchObject({ code: 'org_insufficient_balance', params: { organization: 'Acme', role: 'member' } });
  });

  it('decides by the payer sent, not the live switch', async () => {
    setUseOwnBalance(false);
    const e = await refused(402, { error: 'Insufficient balance', reason: 'insufficient_balance' }, { payer: 'personal' });
    expect(e).toMatchObject({ code: 'insufficient_balance' });
    setUseOwnBalance(true);
    expect(await refused(402, { error: 'Insufficient balance' }, { payer: 'organization' })).toMatchObject({ code: 'org_insufficient_balance' });
  });

  it('leaves a personal or non-member 402 as it was', async () => {
    expect(await refused(402, { error: 'Insufficient balance' }, { account: undefined })).toMatchObject({ code: 'insufficient_balance' });
  });

  it('keeps the server\'s own text in an organization refusal, and no amount', async () => {
    const e = await refused(402, { error: 'Insufficient balance', reason: 'insufficient_balance', availableMicroUsd: 3123456 }, { payer: 'organization' });
    expect(e.message).toContain('Insufficient balance');
    expect(e.message).not.toContain('3123456');
    const m = await refused(403, { message: 'Organization wallet paused', subject: 'organization' }, { payer: 'organization' });
    expect(m.message).toContain('Organization wallet paused');
  });

  it('words a 403 not_org_member', async () => {
    const e = await refused(403, { code: 'not_org_member' }, { payer: 'organization' });
    expect(e).toMatchObject({ code: 'not_org_member', params: { organization: 'Acme' } });
  });

  it('words a 403 frozen with subject organization, and a personal one as before', async () => {
    expect(await refused(403, { error: 'Wallet frozen', subject: 'organization' }, { payer: 'organization' })).toMatchObject({ code: 'org_wallet_frozen', params: { organization: 'Acme', role: 'member' } });
    expect(await refused(403, { error: 'Wallet frozen' }, { payer: 'personal' })).toMatchObject({ code: 'wallet_frozen' });
    expect(await refused(403, undefined, { account: undefined })).toMatchObject({ code: 'wallet_frozen' });
  });

  it('carries the owner role, and survives a stale quota with no organization', async () => {
    const owner = { ...account, organization: { ...account.organization, role: 'owner' as const } };
    expect(await refused(403, { subject: 'organization' }, { payer: 'organization', account: owner })).toMatchObject({ code: 'org_wallet_frozen', params: { role: 'owner' } });
    const stale = await refused(403, { code: 'not_org_member' }, { payer: 'organization', account: { status: 'known', balanceMicroUsd: 0, frozen: false } });
    expect(stale).toMatchObject({ code: 'not_org_member' });
    expect(stale.params).toBeUndefined();
  });
});
