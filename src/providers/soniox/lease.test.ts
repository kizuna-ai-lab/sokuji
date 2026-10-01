import { describe, it, expect, vi } from 'vitest';
import { AdapterStartError } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import type { LegName } from '../../lib/conversation/types';
import type { LeaseContext, RunShape } from '../../lib/session/types';
import { createSonioxAdapter } from './adapter';
import { buildSoniox } from './config';
import { createKizunaLease, DEFAULT_CONFLICT_RETRY_MS, GRANT_END_MARGIN_MS, SESSION_END_BUDGET_MS, SESSION_KEY_TIMEOUT_MS } from './lease';
import { PARTICIPANT_SPEECH_FIELD } from './leaseRequest';
import { SONIOX_DEFAULTS, type SonioxSettings } from './settings';
import { AUTO_CTX, isStt, msg, orig, SHARED } from './testing';

const API = 'https://api.test';
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

const stream = (role: string) => ({ role, apiKey: `k-${role}`, clientReferenceId: `ref-${role}`, expiresAt: 'x' });
/** A grant as the backend answers it (`routes/soniox.ts:617-660`); flat fields kept, as it sends them. */
const grant = (roles: string[], over: Record<string, unknown> = {}) => ({
  sttApiKey: `k-${roles[0]}`, expiresAt: 'x', maxSessionDurationSeconds: 600, budgetMicroUsd: 416_667, rateUsdPerHour: 2.5, sku: 'soniox',
  leaseId: 'lease-1', clientReferenceId: `ref-${roles[0]}`, region: 'us', streams: roles.map(stream), ...over,
});

const shapeFor = (legs: LegName[], o: { textOnly?: boolean; participantSpeech?: boolean; token?: string | null } = {}): RunShape => ({
  provider: {} as RunShape['provider'], settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' }, legs,
  turnMode: 'auto', textOnly: o.textOnly ?? false, participantSpeech: o.participantSpeech ?? false, keepReplayAudio: true,
  shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
  auth: { signedIn: o.token !== null, userId: 'u1', getToken: vi.fn(async () => (o.token === undefined ? 'tok' : o.token)) },
});

/** `acquire` in flight over a stub `fetch`, on a virtual clock; the test answers it. `flag` is the participant-speech flag (ruling 2), off by default as shipped. */
function acquiring(legs: LegName[], o: { textOnly?: boolean; participantSpeech?: boolean; flag?: boolean; settings?: Partial<SonioxSettings>; token?: string | null } = {}) {
  const net = stubFetch();
  const clock = createVirtualClock(0);
  const controller = new AbortController();
  const end = vi.fn();
  const frame = vi.fn();
  const ctx: LeaseContext = { signal: controller.signal, clock, end, frame };
  const lease = createKizunaLease({ participantSpeech: o.flag ?? false, fetch: net.fetch as unknown as typeof fetch, apiUrl: () => API });
  const shape = shapeFor(legs, o);
  const pending = lease(shape, { ...SONIOX_DEFAULTS, ...o.settings }, ctx);
  pending.catch(() => {});
  return { ...net, clock, controller, end, frame, ctx, lease, shape, pending };
}

type AcquireOptions = Parameters<typeof acquiring>[1];

/** Whether `p` is still pending: races it against a flush, which settles first only when nothing else has settled `p` yet. */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const outcome = await Promise.race([
    p.then(() => 'settled' as const, () => 'settled' as const),
    flush().then(() => 'pending' as const),
  ]);
  return outcome === 'pending';
}

/** A lease granted `roles` (with `over` merged into the 200's body), answered once the request is out. */
async function granted(legs: LegName[], roles: string[], o: AcquireOptions = {}, over: Record<string, unknown> = {}) {
  const a = acquiring(legs, o);
  await flush();
  a.last().respond(200, grant(roles, over));
  const resources = await a.pending;
  return { ...a, resources };
}

/** The rejection `p` settles with. */
async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(() => { throw new Error('expected a rejection'); }, (error: unknown) => error);
}

const KEY = /k-(spk|par|mix)_(stt|tts)/;
/** The lease's port (`SonioxLeasePort`), on every leg with an STT role of its own. */
const PORT = expect.objectContaining({ streamAccepted: expect.any(Function), atGrantEnd: expect.any(Function), cutoff: expect.any(Function) });

describe('Kizuna Soniox lease: the session-key request', () => {
  it("sends today's body byte for byte with the flag off, whatever the participant wants", async () => {
    const off = acquiring(['speaker', 'participant'], { participantSpeech: true, settings: { bothModeSharedSession: false } });
    await flush();
    expect(off.last().init.body).toBe('{"mode":"both","textOnly":false,"bothSplit":true,"region":"us"}');

    const on = acquiring(['speaker', 'participant'], { participantSpeech: true, flag: true, settings: { bothModeSharedSession: false } });
    await flush();
    expect(on.last().init.body).toBe(`{"mode":"both","textOnly":false,"bothSplit":true,"region":"us","${PARTICIPANT_SPEECH_FIELD}":true}`);
  });

  it('POSTs that body to session-key, the sign-in token in Authorization only', async () => {
    const a = acquiring(['speaker'], { settings: { region: 'eu' } });
    await flush();
    expect(a.calls).toHaveLength(1);
    const call = a.last();
    expect(call.url).toBe(`${API}/soniox/session-key`);
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(JSON.parse(call.init.body as string)).toEqual({ mode: 'speaker', textOnly: false, bothSplit: false, region: 'eu' });
    call.respond(200, grant(['spk_stt', 'spk_tts'], { region: 'eu' }));
    await expect(a.pending).resolves.toBeDefined();
  });

  it("puts each session-key request's body in the Logs before it goes out, never the token — the participant field only while the flag is on", async () => {
    const off = acquiring(['speaker', 'participant'], { participantSpeech: true, settings: { bothModeSharedSession: false } });
    await flush();
    expect(off.frame).toHaveBeenCalledWith({ direction: 'out', type: 'session.key_requested', payload: { mode: 'both', textOnly: false, bothSplit: true, region: 'us' } });
    const at = off.frame.mock.calls.findIndex(([f]) => f.type === 'session.key_requested');
    expect(off.frame.mock.calls[at][0].payload).not.toHaveProperty(PARTICIPANT_SPEECH_FIELD);
    // Framed before the POST: a request that never answers still shows in the Logs.
    expect(off.frame.mock.invocationCallOrder[at]).toBeLessThan(off.fetch.mock.invocationCallOrder[0]);
    expect(JSON.stringify(off.frame.mock.calls)).not.toContain('tok');

    const on = acquiring(['speaker', 'participant'], { participantSpeech: true, flag: true, settings: { bothModeSharedSession: false } });
    await flush();
    expect(on.frame).toHaveBeenCalledWith({
      direction: 'out', type: 'session.key_requested',
      payload: { mode: 'both', textOnly: false, bothSplit: true, region: 'us', [PARTICIPANT_SPEECH_FIELD]: true },
    });

    // A 409's retry is a request of its own.
    const retried = acquiring(['speaker']);
    await flush();
    retried.last().respond(409, { retryAfterMs: 1200 });
    await flush();
    retried.clock.advance(1200);
    await flush();
    expect(retried.fetch).toHaveBeenCalledTimes(2);
    expect(retried.frame.mock.calls.filter(([f]) => f.type === 'session.key_requested')).toHaveLength(2);
  });

  it('refuses a signed-out start before any request', async () => {
    const a = acquiring(['speaker'], { token: null });
    const error = await rejection(a.pending);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect((error as AdapterStartError).code).toBe('sign_in_required');
    expect(a.fetch).not.toHaveBeenCalled();
  });
});

describe("Kizuna Soniox lease: each leg's keys", () => {
  it("hands each leg its own keys, the TTS key of the same side, and the response's region", async () => {
    // Speaking: the response's region, never the request's.
    const speaking = await granted(['speaker'], ['spk_stt', 'spk_tts'], {}, { region: 'jp' });
    expect(speaking.resources.credentials('speaker')).toEqual({ region: 'jp', stt: 'k-spk_stt', tts: 'k-spk_tts', clientReferenceId: 'ref-spk_stt', lease: PORT });
    expect(() => speaking.resources.credentials('participant')).toThrow(/not requested/);

    const textOnly = await granted(['speaker'], ['spk_stt'], { textOnly: true });
    expect(textOnly.resources.credentials('speaker')).not.toHaveProperty('tts');

    const participant = await granted(['participant'], ['par_stt']);
    expect(participant.resources.credentials('participant')).toEqual({ region: 'us', stt: 'k-par_stt', clientReferenceId: 'ref-par_stt', lease: PORT });

    // Split Both: the speaker's TTS key stays on the speaker's side.
    const split = await granted(['speaker', 'participant'], ['spk_stt', 'spk_tts', 'par_stt'], { settings: { bothModeSharedSession: false } });
    expect(split.resources.credentials('speaker')).toEqual({ region: 'us', stt: 'k-spk_stt', tts: 'k-spk_tts', clientReferenceId: 'ref-spk_stt', lease: PORT });
    expect(split.resources.credentials('participant')).toEqual({ region: 'us', stt: 'k-par_stt', clientReferenceId: 'ref-par_stt', lease: PORT });

    // Shared Both: the participant rides the mixed socket, with no key to speak and no port.
    const shared = await granted(['speaker', 'participant'], ['mix_stt', 'mix_tts']);
    expect(shared.resources.credentials('speaker')).toEqual({ region: 'us', stt: 'k-mix_stt', tts: 'k-mix_tts', clientReferenceId: 'ref-mix_stt', lease: PORT });
    expect(shared.resources.credentials('participant')).toEqual({ region: 'us', stt: 'k-mix_stt', clientReferenceId: 'ref-mix_stt' });
  });

  it('ignores a stray par_tts while the participant-speech flag is off', async () => {
    const split = await granted(['speaker', 'participant'], ['spk_stt', 'spk_tts', 'par_stt', 'par_tts'], { participantSpeech: true, settings: { bothModeSharedSession: false } });
    expect(split.resources.credentials('participant')).not.toHaveProperty('tts');
    expect(split.resources.credentials('speaker')).toMatchObject({ tts: 'k-spk_tts' });

    const participant = await granted(['participant'], ['par_stt', 'par_tts'], { participantSpeech: true });
    expect(participant.resources.credentials('participant')).not.toHaveProperty('tts');

    const shared = await granted(['speaker', 'participant'], ['mix_stt', 'mix_tts', 'par_tts'], { participantSpeech: true });
    expect(shared.resources.credentials('participant')).not.toHaveProperty('tts');
    expect(shared.resources.credentials('speaker')).toMatchObject({ tts: 'k-mix_tts' });
  });

  it("makes par_tts the participant's TTS key in every mode while the flag is on", async () => {
    const on = { flag: true, participantSpeech: true };
    const split = await granted(['speaker', 'participant'], ['spk_stt', 'spk_tts', 'par_stt', 'par_tts'], { ...on, settings: { bothModeSharedSession: false } });
    expect(split.resources.credentials('participant')).toEqual({ region: 'us', stt: 'k-par_stt', tts: 'k-par_tts', clientReferenceId: 'ref-par_stt', lease: PORT });
    expect(split.resources.credentials('speaker')).toMatchObject({ tts: 'k-spk_tts' });

    const participant = await granted(['participant'], ['par_stt', 'par_tts'], on);
    expect(participant.resources.credentials('participant')).toEqual({ region: 'us', stt: 'k-par_stt', tts: 'k-par_tts', clientReferenceId: 'ref-par_stt', lease: PORT });

    // Shared Both: the `mix_*` bundle stays on the speaker; the participant's one socket is its TTS one, on its own key and reference.
    const shared = await granted(['speaker', 'participant'], ['mix_stt', 'mix_tts', 'par_tts'], on);
    expect(shared.resources.credentials('speaker')).toEqual({ region: 'us', stt: 'k-mix_stt', tts: 'k-mix_tts', clientReferenceId: 'ref-mix_stt', lease: PORT });
    expect(shared.resources.credentials('participant')).toEqual({ region: 'us', stt: 'k-mix_stt', tts: 'k-par_tts', clientReferenceId: 'ref-par_tts' });
  });

  it('leaves the participant with no TTS key when the flag is on but the answer carries no par_tts', async () => {
    const split = await granted(['speaker', 'participant'], ['spk_stt', 'spk_tts', 'par_stt'], { flag: true, participantSpeech: true, settings: { bothModeSharedSession: false } });
    expect(split.resources.credentials('participant')).not.toHaveProperty('tts');
  });

  it('never puts the sign-in token in a credential or a frame, nor a key in a frame', async () => {
    const a = await granted(['speaker', 'participant'], ['spk_stt', 'spk_tts', 'par_stt'], { settings: { bothModeSharedSession: false } });
    expect(JSON.stringify([a.resources.credentials('speaker'), a.resources.credentials('participant')])).not.toContain('tok');
    expect(JSON.stringify(a.frame.mock.calls)).not.toContain('tok');
    expect(JSON.stringify(a.frame.mock.calls)).not.toMatch(KEY);
    expect(a.frame).toHaveBeenCalledWith({
      direction: 'in',
      type: 'session.lease_acquired',
      payload: { leaseId: 'lease-1', region: 'us', roles: ['spk_stt', 'spk_tts', 'par_stt'], maxSessionDurationSeconds: 600 },
    });
  });
});

describe('Kizuna Soniox lease: a refused or broken answer', () => {
  it('fails the start loudly on a contract break', async () => {
    const splitBoth: AcquireOptions = { settings: { bothModeSharedSession: false } };
    const cases: Array<[LegName[], AcquireOptions, Record<string, unknown>, RegExp]> = [
      [['speaker'], {}, grant(['spk_stt'], { leaseId: undefined }), /leaseId/],
      [['speaker'], {}, grant(['spk_stt'], { clientReferenceId: undefined }), /clientReferenceId/],
      [['speaker'], {}, grant(['spk_stt'], { region: undefined }), /region/],
      [['speaker'], {}, grant(['spk_stt'], { region: 'xx' }), /region/],
      [['speaker'], {}, grant(['spk_stt'], { streams: undefined }), /streams/],
      [['speaker'], {}, grant(['spk_stt'], { streams: [] }), /streams/],
      [['speaker'], {}, grant(['spk_stt'], { streams: [{ role: 'spk_stt', clientReferenceId: 'ref-spk_stt', expiresAt: 'x' }] }), /malformed stream/],
      [['speaker'], {}, grant(['spk_stt'], { streams: [{ role: 'spk_stt', apiKey: 'k-spk_stt', expiresAt: 'x' }] }), /malformed stream/],
      // A role the lease does not know (the backend's preview role), beside the one this start needs.
      [['speaker'], {}, grant(['spk_stt'], { streams: [stream('spk_stt'), { role: 'preview_tts', apiKey: 'k', clientReferenceId: 'r', expiresAt: 'x' }] }), /malformed stream/],
      // No granted duration: a timer of NaN or 0 would end the run at once.
      [['speaker'], {}, grant(['spk_stt'], { maxSessionDurationSeconds: undefined }), /granted duration/],
      [['speaker'], {}, grant(['spk_stt'], { maxSessionDurationSeconds: 0 }), /granted duration/],
      [['speaker', 'participant'], splitBoth, grant(['spk_stt']), /par_stt/],
    ];
    for (const [legs, o, body, message] of cases) {
      const a = acquiring(legs, o);
      await flush();
      a.last().respond(200, body);
      const error = await rejection(a.pending);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AdapterStartError);
      expect((error as Error).message).toMatch(message);
      expect((error as Error).message).not.toContain('tok');
      expect((error as Error).message).not.toMatch(KEY);
    }

    // A non-finite duration: JSON spells none, but `1e999` parses to Infinity, so this body reaches the lease as one.
    const text = JSON.stringify(grant(['spk_stt'])).replace('"maxSessionDurationSeconds":600', '"maxSessionDurationSeconds":1e999');
    expect(JSON.parse(text).maxSessionDurationSeconds).toBe(Infinity);
    const endless = createKizunaLease({ fetch: async () => new Response(text, { status: 200 }), apiUrl: () => API });
    const ctx: LeaseContext = { signal: new AbortController().signal, clock: createVirtualClock(0), end: vi.fn(), frame: vi.fn() };
    const error = await rejection(endless(shapeFor(['speaker']), SONIOX_DEFAULTS, ctx));
    expect(error).not.toBeInstanceOf(AdapterStartError);
    expect((error as Error).message).toMatch(/granted duration/);
  });

  it('words every refusal by its code', async () => {
    const answer = async (status: number, body?: unknown) => {
      const a = acquiring(['speaker']);
      await flush();
      a.last().respond(status, body);
      return rejection(a.pending);
    };
    const code = (error: unknown) => {
      expect(error).toBeInstanceOf(AdapterStartError);
      return (error as AdapterStartError).code;
    };

    expect(code(await answer(401))).toBe('sign_in_required');
    expect(code(await answer(402, { error: 'Insufficient balance', requiredMicroUsd: 41_667, balanceMicroUsd: 1_234 }))).toBe('insufficient_balance');
    expect(code(await answer(403))).toBe('wallet_frozen');
    expect(code(await answer(502))).toBe('soniox_service_unavailable');
    // All three of the backend's 503 bodies, as the old client worded them.
    for (const error of ['Soniox region not available', 'Wallet unavailable', 'Soniox capacity is temporarily full']) {
      expect(code(await answer(503, { error }))).toBe('soniox_service_busy');
    }

    const boom = await answer(500, { error: 'boom' });
    expect(boom).not.toBeInstanceOf(AdapterStartError);
    expect((boom as Error).message).toBe('boom');
    const bare = await answer(500);
    expect(bare).not.toBeInstanceOf(AdapterStartError);
    expect((bare as Error).message).toMatch(/HTTP 500/);

    const a = acquiring(['speaker']);
    await flush();
    a.last().fail(new TypeError('Failed to fetch'));
    const unreachable = await rejection(a.pending);
    expect(code(unreachable)).toBe('network');
    expect((unreachable as Error).message).toMatch(/Failed to reach the Soniox session service: Failed to fetch/);
  });

  it("keeps a 402's wallet figures out of the thrown message and puts them in the Logs' frame", async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(402, { error: 'Insufficient balance', requiredMicroUsd: 41_667, balanceMicroUsd: 1_234 });
    const error = await rejection(a.pending);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect((error as AdapterStartError).code).toBe('insufficient_balance');
    // A failed start's message reaches analytics as `error_message`: no figure of the user's wallet may be in it.
    expect((error as Error).message).not.toMatch(/41[,.\s]?667|1[,.\s]?234/);
    expect(a.frame).toHaveBeenCalledWith({
      direction: 'in',
      type: 'session.refused',
      payload: { status: 402, error: 'Insufficient balance', requiredMicroUsd: 41_667, balanceMicroUsd: 1_234 },
    });

    // Every refusal is framed with its status and the server's words.
    const busy = acquiring(['speaker']);
    await flush();
    busy.last().respond(503, { error: 'Wallet unavailable' });
    await rejection(busy.pending);
    expect(busy.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.refused', payload: { status: 503, error: 'Wallet unavailable' } });
  });
});

describe("Kizuna Soniox lease: the session key's bound and its 409 retry", () => {
  it("bounds each attempt at 15 s on the run's clock, and does not retry a timeout", async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.clock.advance(SESSION_KEY_TIMEOUT_MS - 1);
    await flush();
    expect(await isPending(a.pending)).toBe(true);
    a.clock.advance(1);
    await flush();
    const error = await rejection(a.pending);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect((error as AdapterStartError).code).toBe('soniox_service_unavailable');
    expect(a.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 409 once, after the backend's hint, on the clock, with a full bound of its own", async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(409, { error: 'x', retryAfterMs: 1200 });
    await flush();
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.retry', payload: { status: 409, retryAfterMs: 1200 } });
    a.clock.advance(1199);
    await flush();
    expect(a.fetch).toHaveBeenCalledTimes(1);
    a.clock.advance(1);
    await flush();
    expect(a.fetch).toHaveBeenCalledTimes(2);
    // The retry's own bound, not what was left of the first.
    a.clock.advance(SESSION_KEY_TIMEOUT_MS - 1);
    await flush();
    expect(await isPending(a.pending)).toBe(true);
    a.last().respond(200, grant(['spk_stt', 'spk_tts']));
    await expect(a.pending).resolves.toBeDefined();
  });

  it('waits 3 s for a 409 that names no wait, and says session_conflict after the second', async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(409);
    await flush();
    a.clock.advance(DEFAULT_CONFLICT_RETRY_MS);
    await flush();
    expect(a.fetch).toHaveBeenCalledTimes(2);
    a.last().respond(409);
    const error = await rejection(a.pending);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect((error as AdapterStartError).code).toBe('session_conflict');
    a.clock.advance(10_000);
    await flush();
    expect(a.fetch).toHaveBeenCalledTimes(2);
  });

  it('a cancel reaches the request and the wait', async () => {
    const inRequest = acquiring(['speaker']);
    await flush();
    const stop = new Error('stop');
    inRequest.controller.abort(stop);
    const first = await rejection(inRequest.pending);
    expect(first).toBe(stop);
    expect(first).not.toBeInstanceOf(AdapterStartError);

    const inWait = acquiring(['speaker']);
    await flush();
    inWait.last().respond(409, { error: 'x', retryAfterMs: 1200 });
    await flush();
    const halt = new Error('stop');
    inWait.controller.abort(halt);
    expect(await rejection(inWait.pending)).toBe(halt);
    inWait.clock.advance(10_000);
    await flush();
    expect(inWait.fetch).toHaveBeenCalledTimes(1);
  });

  it('a cancel that lands as the 409 wait ends stops the retry before it is sent', async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.last().respond(409, { error: 'x', retryAfterMs: 1200 });
    await flush();
    // The wait's timer fires inside `advance`; the cancel comes before the retry's continuation runs.
    a.clock.advance(1200);
    const stop = new Error('stop');
    a.controller.abort(stop);
    await flush();
    expect(await isPending(a.pending)).toBe(false);
    expect(await rejection(a.pending)).toBe(stop);
    expect(a.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Kizuna Soniox lease: the grant's time and its end", () => {
  it('its budget is the granted time, from acquire', async () => {
    const a = acquiring(['speaker']);
    await flush();
    a.clock.advance(5_000);
    a.last().respond(200, grant(['spk_stt', 'spk_tts'], { maxSessionDurationSeconds: 600 }));
    const resources = await a.pending;
    expect(resources.budget).toEqual({ totalMs: 600_000, endsAt: 605_000 });
  });

  it("ends the run once at the grant's end, in the words decided at acquire", async () => {
    // Below the 3 600-s cap of a session that speaks: the balance ran out.
    const short = await granted(['speaker'], ['spk_stt', 'spk_tts'], {}, { maxSessionDurationSeconds: 600 });
    short.clock.advance(600_000);
    expect(short.end).toHaveBeenCalledTimes(1);
    expect(short.end).toHaveBeenCalledWith({ code: 'budget_exhausted', message: 'Session budget exhausted' }, { expected: false });
    expect(short.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.lease_ended', payload: { code: 'budget_exhausted', maxSessionDurationSeconds: 600 } });
    short.clock.advance(600_000);
    expect(short.end).toHaveBeenCalledTimes(1);

    // At the cap: the normal end of a segment.
    const capped = await granted(['speaker'], ['spk_stt', 'spk_tts'], {}, { maxSessionDurationSeconds: 3_600 });
    capped.clock.advance(3_600_000);
    expect(capped.end).toHaveBeenCalledTimes(1);
    expect(capped.end).toHaveBeenCalledWith({ code: 'segment_ended', message: 'Session segment ended at the per-session cap' }, { expected: true });

    // Text only: the cap is 18 000 s.
    const textHour = await granted(['speaker'], ['spk_stt'], { textOnly: true }, { maxSessionDurationSeconds: 3_600 });
    textHour.clock.advance(3_600_000);
    expect(textHour.end).toHaveBeenCalledWith({ code: 'budget_exhausted', message: 'Session budget exhausted' }, { expected: false });
    const textCapped = await granted(['speaker'], ['spk_stt'], { textOnly: true }, { maxSessionDurationSeconds: 18_000 });
    textCapped.clock.advance(18_000_000);
    expect(textCapped.end).toHaveBeenCalledWith({ code: 'segment_ended', message: 'Session segment ended at the per-session cap' }, { expected: true });

    // The words follow the set the backend minted, not the one the flag leaves: with the flag off a
    // `par_tts` is no leg's key, yet minting it held the grant to the hour's cap.
    const parCapped = await granted(['participant'], ['par_stt', 'par_tts'], {}, { maxSessionDurationSeconds: 3_600 });
    expect(parCapped.resources.credentials('participant')).not.toHaveProperty('tts');
    parCapped.clock.advance(3_600_000);
    expect(parCapped.end).toHaveBeenCalledTimes(1);
    expect(parCapped.end).toHaveBeenCalledWith({ code: 'segment_ended', message: 'Session segment ended at the per-session cap' }, { expected: true });
    const parShort = await granted(['participant'], ['par_stt', 'par_tts'], {}, { maxSessionDurationSeconds: 600 });
    parShort.clock.advance(600_000);
    expect(parShort.end).toHaveBeenCalledWith({ code: 'budget_exhausted', message: 'Session budget exhausted' }, { expected: false });

    // Released: the timer ends nothing.
    const released = await granted(['speaker'], ['spk_stt', 'spk_tts'], {}, { maxSessionDurationSeconds: 600 });
    const releasing = released.resources.release();
    released.to('/soniox/session-end')[0].respond(200);
    await releasing;
    released.clock.advance(600_000);
    expect(released.end).not.toHaveBeenCalled();
    expect(released.frame).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.lease_ended' }));
  });
});

describe('Kizuna Soniox lease: session-end', () => {
  it('release tells the backend at once, with the token cached at acquire and keepalive', async () => {
    const a = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    expect(a.shape.auth.getToken).toHaveBeenCalledTimes(1);
    const releasing = a.resources.release();
    // Before any await: `pagehide`'s synchronous release must send it.
    expect(a.to('/soniox/session-end')).toHaveLength(1);
    const call = a.to('/soniox/session-end')[0];
    expect(call.init.method).toBe('POST');
    expect(call.init.keepalive).toBe(true);
    expect(call.init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(JSON.parse(call.init.body as string)).toEqual({ leaseId: 'lease-1' });
    expect(a.shape.auth.getToken).toHaveBeenCalledTimes(1);
    expect(a.frame).toHaveBeenCalledWith({ direction: 'out', type: 'session.end', payload: { leaseId: 'lease-1' } });
    call.respond(200);
    await expect(releasing).resolves.toBeUndefined();
    await a.resources.release();
    expect(a.to('/soniox/session-end')).toHaveLength(1);
  });

  it('retries session-end on a transport failure or a 5xx, three attempts at most, within 4 s', async () => {
    const a = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    const ends = () => a.to('/soniox/session-end');
    const releasing = a.resources.release();
    ends()[0].fail();
    await flush();
    a.clock.advance(499);
    expect(ends()).toHaveLength(1);
    a.clock.advance(1);
    await flush();
    expect(ends()).toHaveLength(2);
    ends()[1].respond(503);
    await flush();
    a.clock.advance(1_000);
    await flush();
    expect(ends()).toHaveLength(3);
    ends()[2].fail();
    await flush();
    await expect(releasing).resolves.toBeUndefined();
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-end', message: 'The backend did not acknowledge session-end.' } });
    a.clock.advance(10_000);
    await flush();
    expect(ends()).toHaveLength(3);
  });

  it('drops keepalive once an attempt fails in transport, and keeps it through a 5xx', async () => {
    // A runtime that refuses a keepalive request needing a CORS preflight fails it in transport:
    // the retries go out as plain requests, which a normal Stop still delivers.
    const refused = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    const ends = () => refused.to('/soniox/session-end');
    const releasing = refused.resources.release();
    expect(ends()[0].init.keepalive).toBe(true);
    ends()[0].fail();
    await flush();
    refused.clock.advance(500);
    await flush();
    expect(ends()).toHaveLength(2);
    expect(ends()[1].init).not.toHaveProperty('keepalive');
    // Still plain after a 5xx: the runtime that refused it has not changed.
    ends()[1].respond(503);
    await flush();
    refused.clock.advance(1_000);
    await flush();
    expect(ends()).toHaveLength(3);
    expect(ends()[2].init).not.toHaveProperty('keepalive');
    ends()[2].respond(200);
    await expect(releasing).resolves.toBeUndefined();

    // A 5xx is the backend's answer, not the runtime's refusal: the retry keeps keepalive.
    const busy = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    const busyEnds = () => busy.to('/soniox/session-end');
    const releasingBusy = busy.resources.release();
    busyEnds()[0].respond(503);
    await flush();
    busy.clock.advance(500);
    await flush();
    expect(busyEnds()).toHaveLength(2);
    expect(busyEnds()[1].init.keepalive).toBe(true);
    busyEnds()[1].respond(200);
    await expect(releasingBusy).resolves.toBeUndefined();
  });

  it('never begins an attempt after the budget: a hung one is aborted at the deadline', async () => {
    const a = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    const releasing = a.resources.release();
    const attempt = a.fetch.mock.results[a.fetch.mock.results.length - 1].value as Promise<Response>;
    attempt.catch(() => {});
    a.clock.advance(SESSION_END_BUDGET_MS);
    await flush();
    expect(a.to('/soniox/session-end')[0].init.signal?.aborted).toBe(true);
    await expect(attempt).rejects.toThrow();
    await expect(releasing).resolves.toBeUndefined();
    expect(a.to('/soniox/session-end')).toHaveLength(1);
  });

  it('a 4xx answer to session-end is final', async () => {
    const a = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    const releasing = a.resources.release();
    a.to('/soniox/session-end')[0].respond(401);
    await expect(releasing).resolves.toBeUndefined();
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-end', message: 'HTTP 401' } });
    a.clock.advance(10_000);
    await flush();
    expect(a.to('/soniox/session-end')).toHaveLength(1);
  });

  it('the next acquire cancels a release still retrying', async () => {
    const a = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    const releasing = a.resources.release();
    a.to('/soniox/session-end')[0].fail();
    await flush();

    // Lease B, on the same provider's lease and `fetch`, before the 500-ms retry.
    const ctxB: LeaseContext = { signal: new AbortController().signal, clock: a.clock, end: vi.fn(), frame: vi.fn() };
    const pendingB = a.lease(shapeFor(['speaker']), SONIOX_DEFAULTS, ctxB);
    await flush();
    a.to('/soniox/session-key')[1].respond(200, grant(['spk_stt', 'spk_tts'], { leaseId: 'lease-2' }));
    await pendingB;

    a.clock.advance(10_000);
    await flush();
    expect(a.to('/soniox/session-end')).toHaveLength(1);
    await expect(releasing).resolves.toBeUndefined();
  });
});

describe("the lease's port (SonioxLeasePort)", () => {
  const splitBoth: AcquireOptions = { settings: { bothModeSharedSession: false } };
  const startedBody = (call: { init: RequestInit }) => JSON.parse(call.init.body as string);

  it('reports the first accepted frame once per role, with the cached token', async () => {
    const a = await granted(['speaker', 'participant'], ['spk_stt', 'spk_tts', 'par_stt'], splitBoth);
    a.resources.credentials('speaker').lease!.streamAccepted();
    a.resources.credentials('speaker').lease!.streamAccepted();
    expect(a.to('/soniox/session-started')).toHaveLength(1);
    const call = a.to('/soniox/session-started')[0];
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(startedBody(call)).toEqual({ leaseId: 'lease-1', role: 'spk_stt' });
    expect(call.init).not.toHaveProperty('keepalive');
    expect(a.frame).toHaveBeenCalledWith({ direction: 'out', type: 'session.started', payload: { role: 'spk_stt' } });

    a.resources.credentials('participant').lease!.streamAccepted();
    expect(a.to('/soniox/session-started')).toHaveLength(2);
    expect(startedBody(a.to('/soniox/session-started')[1])).toEqual({ leaseId: 'lease-1', role: 'par_stt' });
    expect(a.shape.auth.getToken).toHaveBeenCalledTimes(1);
  });

  it('puts a refusal in the Logs with its reason, and says nothing for a stale 200', async () => {
    // The port posts once per role: two roles here, a second lease for the third answer.
    const split = await granted(['speaker', 'participant'], ['spk_stt', 'spk_tts', 'par_stt'], splitBoth);
    split.resources.credentials('speaker').lease!.streamAccepted();
    split.to('/soniox/session-started')[0].respond(400, { error: 'x', reason: 'role_required' });
    await flush();
    expect(split.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.started_refused', payload: { status: 400, reason: 'role_required', role: 'spk_stt' } });

    split.resources.credentials('participant').lease!.streamAccepted();
    // No body: `json()` fails, and the status alone says the lease was not extended.
    split.to('/soniox/session-started')[1].respond(500);
    await flush();
    expect(split.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.started_refused', payload: { status: 500, reason: null, role: 'par_stt' } });

    // `no_live_lease` is a 200 by design: routine, and nothing the client can act on.
    const stale = await granted(['speaker'], ['spk_stt']);
    stale.resources.credentials('speaker').lease!.streamAccepted();
    stale.to('/soniox/session-started')[0].respond(200, { ok: true, reason: 'no_live_lease' });
    await flush();
    expect(stale.frame).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.started_refused' }));
  });

  it('puts a transport failure in the Logs', async () => {
    const a = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    a.resources.credentials('speaker').lease!.streamAccepted();
    a.to('/soniox/session-started')[0].fail();
    await flush();
    expect(a.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.notify_failed', payload: { step: 'session-started', message: 'Failed to fetch' } });
  });

  it('posts nothing once released: a late first frame cannot start a lease the account ended', async () => {
    const a = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    const port = a.resources.credentials('speaker').lease!;
    const releasing = a.resources.release();
    a.to('/soniox/session-end')[0].respond(200);
    await releasing;
    port.streamAccepted();
    expect(a.to('/soniox/session-started')).toHaveLength(0);
    expect(a.frame).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.started' }));
  });

  it("posts nothing once the grant has ended the run, before release: a first frame after the cutoff cannot start the lease again", async () => {
    const a = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    const port = a.resources.credentials('speaker').lease!;
    port.cutoff();
    expect(a.end).toHaveBeenCalledTimes(1);
    port.streamAccepted();
    expect(a.to('/soniox/session-started')).toHaveLength(0);
    expect(a.frame).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session.started' }));
  });

  it("tells a 403 near the grant's end from an early one", async () => {
    const a = await granted(['speaker'], ['spk_stt', 'spk_tts'], {}, { maxSessionDurationSeconds: 600 });
    const port = a.resources.credentials('speaker').lease!;
    expect(port.atGrantEnd(0)).toBe(false);
    expect(port.atGrantEnd(600_000 - GRANT_END_MARGIN_MS - 1)).toBe(false);
    expect(port.atGrantEnd(600_000 - GRANT_END_MARGIN_MS)).toBe(true);
    expect(port.atGrantEnd(700_000)).toBe(true);
  });

  it("ends the run at the cutoff, at once and once, in the grant's words", async () => {
    const speaking = await granted(['speaker'], ['spk_stt', 'spk_tts'], {}, { maxSessionDurationSeconds: 600 });
    const port = speaking.resources.credentials('speaker').lease!;
    port.cutoff();
    // Synchronously: the adapter's `closed` follows at once and must find the run already ending.
    expect(speaking.end).toHaveBeenCalledTimes(1);
    expect(speaking.end).toHaveBeenCalledWith({ code: 'budget_exhausted', message: 'Session budget exhausted' }, { expected: false });
    expect(speaking.frame).toHaveBeenCalledWith({ direction: 'in', type: 'session.lease_ended', payload: { code: 'budget_exhausted', maxSessionDurationSeconds: 600 } });
    port.cutoff();
    speaking.clock.advance(600_000);
    expect(speaking.end).toHaveBeenCalledTimes(1);

    // At the cap: the normal end of a segment.
    const capped = await granted(['speaker'], ['spk_stt', 'spk_tts'], {}, { maxSessionDurationSeconds: 3_600 });
    capped.resources.credentials('speaker').lease!.cutoff();
    expect(capped.end).toHaveBeenCalledTimes(1);
    expect(capped.end).toHaveBeenCalledWith({ code: 'segment_ended', message: 'Session segment ended at the per-session cap' }, { expected: true });

    // Released: the cutoff ends nothing.
    const released = await granted(['speaker'], ['spk_stt', 'spk_tts'], {}, { maxSessionDurationSeconds: 600 });
    const releasing = released.resources.release();
    released.to('/soniox/session-end')[0].respond(200);
    await releasing;
    released.resources.credentials('speaker').lease!.cutoff();
    expect(released.end).not.toHaveBeenCalled();
  });

  it("shared Both: the speaker's socket reports for the mixed stream; the participant has no port", async () => {
    const a = await granted(['speaker', 'participant'], ['mix_stt', 'mix_tts']);
    const port = a.resources.credentials('speaker').lease;
    expect(port).toBeDefined();
    port!.streamAccepted();
    expect(a.to('/soniox/session-started')).toHaveLength(1);
    expect(startedBody(a.to('/soniox/session-started')[0])).toEqual({ leaseId: 'lease-1', role: 'mix_stt' });
    expect(a.resources.credentials('participant')).not.toHaveProperty('lease');
  });

  it("the adapter's first frame reaches session-started", async () => {
    const lease = await granted(['speaker'], ['spk_stt', 'spk_tts']);
    const sockets = fakeSockets();
    const starting = createSonioxAdapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: buildSoniox(AUTO_CTX, SONIOX_DEFAULTS, SHARED), credentials: lease.resources.credentials('speaker'), clock: lease.clock, signal: new AbortController().signal },
      recordEvents().events,
    );
    for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open();
    await starting;
    const stt = sockets.all.filter(isStt)[0];
    expect(lease.to('/soniox/session-started')).toHaveLength(0);
    stt.receive(msg(orig('Hi', false)));
    expect(lease.to('/soniox/session-started')).toHaveLength(1);
    expect(startedBody(lease.to('/soniox/session-started')[0])).toEqual({ leaseId: 'lease-1', role: 'spk_stt' });
    // The socket carries the minted key and its reference; the sign-in token never reaches Soniox.
    expect(stt.sentJson<Record<string, unknown>>()[0]).toMatchObject({ api_key: 'k-spk_stt', client_reference_id: 'ref-spk_stt' });
    expect(JSON.stringify(sockets.all.map((s) => s.sentJson()))).not.toContain('"tok"');
  });
});
