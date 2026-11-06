/**
 * Qwen LiveTranslate's reconnect (spec 2026-11-05 reconnect §4): a leg whose
 * socket drops while live comes back through its own reconnector, on the
 * same key or on the token the lease answers; which ends reconnect and
 * which end the leg; what the gap does to segments, audio, push-to-talk and
 * the screen's frame; split legs, each on its own; the give-ups and the
 * lease's refusals; the network's return; a stop during the attempts. Over
 * the header seam's fake on a virtual clock.
 */
import { describe, it, expect, vi } from 'vitest';
import type { FrameSource, SessionContext } from '../../lib/contract/adapter';
import { checkConformance } from '../../lib/contract/conformance';
import { eventsFrom, type AdapterEvent } from '../../lib/contract/events';
import { flush } from '../../lib/contract/testing/drive';
import { fakeFrameSource, JPEG_A, JPEG_B } from '../../lib/contract/testing/fakeFrames';
import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import { fakeHeaderSockets } from '../../lib/contract/testing/headerSocket';
import { runScenario } from '../../lib/contract/testing/scenarios';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { LegName } from '../../lib/conversation/types';
import { FLAP_WINDOW_MS, MAX_RECONNECTS, RECONNECT_BUDGET_MS, type DropInfo } from '../../lib/session/reconnect';
import { CONNECTION_LOST, createQwenAdapter, ERROR_WORDS_MS, NEVER_OPENED, qwenDropAction, TURN_DONE_MS } from './adapter';
import type { QwenCredentials, QwenReissue } from './settings';
import { AUTO_CTX, configFor, KEY, MANUAL_CTX, PARTICIPANT_CTX, qwenHarness, qwenSession, SERVER, SHARED, turn } from './testing';

const TOKEN_0 = 'st-token-0';
const TOKEN_1 = 'st-token-1';
const REQ_1 = '11111111-2222-3333-4444-555555555555';
const REQ_2 = '66666666-7777-8888-9999-000000000000';
/** No endpoint from a check: a managed leg dials the grant's, an own key detects its own. */
const NO_STOREFRONT = { ...SHARED, models: [] };

/** A managed lease whose reissues answer in the order given; one asked past them waits for `answer`. */
function fakeLease(...answers: QwenReissue[]) {
  const waiting: Array<(a: QwenReissue) => void> = [];
  const port = {
    sessionCreated: vi.fn((_id: string, _requestId?: string) => {}),
    reissue: vi.fn(() => {
      const next = answers.shift();
      return next ? Promise.resolve(next) : new Promise<QwenReissue>((resolve) => waiting.push(resolve));
    }),
  };
  return { port, answer: (a: QwenReissue) => waiting.shift()!(a), waiting };
}

type Lease = ReturnType<typeof fakeLease>;
const managed = (lease: Lease): QwenCredentials => ({ apiKey: TOKEN_0, endpoint: 'intl', lease: lease.port });

/** A leg live, own key unless a lease is given. */
const live = (o: { lease?: Lease; context?: SessionContext; frames?: FrameSource; requestIds?: string[] } = {}) =>
  qwenSession({
    shared: NO_STOREFRONT,
    ...(o.lease ? { credentials: managed(o.lease) } : {}),
    ...(o.context ? { context: o.context } : {}),
    ...(o.frames ? { frames: o.frames } : {}),
    ...(o.requestIds ? { requestIds: o.requestIds } : {}),
  });

type Live = Awaited<ReturnType<typeof live>>;

/** The newest socket, an attempt's, opens once its registration has answered, and the handshake answers: the leg is live again. */
async function comeBack(h: Pick<Live, 'socket'>, id = 'sess_2'): Promise<void> {
  await flush();
  h.socket().open();
  await flush();
  h.socket().receive(SERVER.created(id));
  h.socket().receive(SERVER.updated());
  await flush();
}

/** The newest socket, an attempt's, fails before it opens. */
async function failAttempt(h: Pick<Live, 'socket'>): Promise<void> {
  await flush();
  h.socket().drop();
  await flush();
}

const chunk = (fill = 1_000) => new Int16Array(2_048).fill(fill);
const types = (s: FakeSocket) => s.sentJson<{ type: string }>().map((m) => m.type);
const bearers = (h: Pick<Live, 'seam'>) => h.seam.registrations.map((r) => r.set.Authorization);
const refs = (h: Pick<Live, 'of'>, kind: 'segmentOpened' | 'segmentClosed') => h.of(kind).map((e) => e.payload.ref);
const dropOf = (drop: Omit<DropInfo, 'retryable' | 'managed'>, isManaged = false): DropInfo => ({ ...drop, retryable: true, managed: isManaged });

describe('qwenDropAction: what a live socket\'s close means (spec §4.1; open point §9.2)', () => {
  it('a recent error decides first: the server\'s own fault or a passing request rate reconnects whatever the close; the key, a quota, a refused request or a model the key may not use end whatever the close', () => {
    for (const code of ['server', 'throttled']) {
      for (const close of [1000, 1007, 1008, 1011]) expect(qwenDropAction({ close, recent: { code } })).toBe('reconnect');
    }
    for (const code of ['auth', 'rate_limit', 'client', 'model_access_denied']) {
      for (const close of [1000, 1006, 1011]) expect(qwenDropAction({ close, reason: 'Idle timeout!', recent: { code } })).toBe('end');
    }
  });

  it('a 1007 that says the session timed out idle or heard no speech in 30 s reconnects; every other 1007 ends', () => {
    for (const reason of ['Idle timeout!', 'no semantic result after merged audio exceeded 30s']) expect(qwenDropAction({ close: 1007, reason }), reason).toBe('reconnect');
    for (const reason of ['Invalid translation parameter.', "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported.", '', undefined]) {
      expect(qwenDropAction({ close: 1007, reason }), String(reason)).toBe('end');
    }
    // Only a 1007 says it so.
    expect(qwenDropAction({ close: 1008, reason: 'Idle timeout!' })).toBe('end');
  });

  it('with no recent error, the close by its code: the transport family reconnects, a refused request or an unknown code ends', () => {
    for (const close of [1000, 1001, 1005, 1006, 1011, 1012, 1013, 1014]) expect(qwenDropAction({ close })).toBe('reconnect');
    for (const close of [1003, 1007, 1008, 1009, 1010, 4000, undefined]) expect(qwenDropAction({ close })).toBe('end');
  });
});

describe('the Qwen adapter reconnects: own key', () => {
  it('own key: a 1011 after live reconnects and the leg stays live', async () => {
    const h = await live();
    expect(h.detected).toEqual([KEY.apiKey]);
    const first = h.socket();
    first.serverClose(1011, 'Internal error');
    await flush();
    // Break before make: the dropped socket is heard no more, and the attempt dials the endpoint found at the start with the same key.
    expect(first.onmessage).toBeNull();
    expect(h.seam.sockets.all).toHaveLength(2);
    expect(h.socket().url).toBe(first.url);
    expect(bearers(h)).toEqual([`Bearer ${KEY.apiKey}`, `Bearer ${KEY.apiKey}`]);
    expect(h.detected).toEqual([KEY.apiKey]);
    await comeBack(h);
    expect(h.of('reconnecting')).toEqual([{ kind: 'reconnecting', payload: { attempt: 1, drop: dropOf({ cause: 'close', closeCode: 1011 }) } }]);
    expect(h.of('reconnected')).toEqual([{ kind: 'reconnected', payload: { attempts: 1, credentialsReissued: false, reissueMs: 0, budgetShared: false } }]);
    expect(h.of('failed')).toEqual([]);
    expect(h.session.info.shared).toBeUndefined();
    // The one update, as the start sent it.
    expect(h.socket().sentJson()).toEqual([first.sentJson()[0]]);
    // The close's own Logs line is not the give-up's.
    expect(h.frames('session.closed')).toEqual([{ code: 1011, reason: 'Internal error' }]);
    expect(h.frames('session.connection_lost')).toEqual([]);
    expect(h.frames('session.reconnecting')).toEqual([{ cause: 'close', code: 1011 }]);
    expect(h.frames('session.reconnected')).toEqual([{ downMs: 0, attempts: 1 }]);
    // Live on the new socket: audio goes up, a turn comes back as segments.
    h.session.appendAudio(chunk());
    expect(h.appended()).toHaveLength(1);
    for (const f of turn(1, { source: '你好', translation: 'Hello.' })) h.socket().receive(f);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['你好', 'Hello.']);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('a server error reconnects, whatever the close after it; the dropped connection\'s error words nothing on the next', async () => {
    const h = await live();
    h.socket().receive(SERVER.error('InternalError', 'Internal server error.'));
    // A close that alone would end: the error before it decides.
    h.socket().serverClose(1007, 'Internal server error.');
    await flush();
    expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf({ cause: 'error', closeCode: 1007, errorCode: 'server' }) }]);
    await comeBack(h);
    expect(h.of('reconnected')).toHaveLength(1);
    // Within ERROR_WORDS_MS of that error, a close the table ends ends in its own words.
    h.socket().serverClose(1008, 'Policy violation');
    await flush();
    expect(h.of('reconnecting')).toHaveLength(1);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'server', message: '[Qwen] Policy violation', drop: { cause: 'close', closeCode: 1008, retryable: false, managed: false } }]);
    expect(h.timers()).toBe(0);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it(`an error older than ERROR_WORDS_MS decides nothing: the close does`, async () => {
    const h = await live();
    h.socket().receive(SERVER.error('InvalidApiKey', 'Invalid API-key provided.'));
    h.clock.advance(ERROR_WORDS_MS + 1);
    h.socket().serverClose(1011);
    await flush();
    expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf({ cause: 'close', closeCode: 1011 }) }]);
    expect(h.of('failed')).toEqual([]);
  });

  it('a 1007 for an idle session or 30 s without speech reconnects; any other 1007 ends', async () => {
    for (const reason of ['Idle timeout!', 'no semantic result after merged audio exceeded 30s']) {
      const h = await live();
      h.socket().serverClose(1007, reason);
      await flush();
      expect(h.of('reconnecting').map((e) => e.payload), reason).toEqual([{ attempt: 1, drop: dropOf({ cause: 'close', closeCode: 1007 }) }]);
      expect(h.frames('session.closed')).toEqual([{ code: 1007, reason }]);
      await comeBack(h);
      expect(h.of('reconnected')).toHaveLength(1);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
    const h = await live();
    h.socket().serverClose(1007, 'Invalid translation parameter.');
    await flush();
    expect(h.of('reconnecting')).toEqual([]);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'client', message: '[Qwen] Invalid translation parameter.', drop: { cause: 'close', closeCode: 1007, retryable: false, managed: false } }]);
    // An end keeps the lost connection's Logs line.
    expect(h.frames('session.connection_lost')).toEqual([{ code: 1007, reason: 'Invalid translation parameter.' }]);
    expect(h.frames('session.closed')).toEqual([]);
  });

  it('a passing request rate reconnects, live and answering an attempt; a quota spent ends', async () => {
    const throttled = SERVER.error('Throttling', 'Requests rate limit exceeded, please try again later.');
    const h = await live();
    h.socket().receive(throttled);
    h.socket().serverClose(1011);
    await flush();
    expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf({ cause: 'error', closeCode: 1011, errorCode: 'throttled' }) }]);
    // The attempt's handshake is throttled too: a failed attempt, and the next one comes back.
    h.socket().open();
    await flush();
    h.socket().receive(SERVER.created('sess_2'));
    h.socket().receive(throttled);
    await flush();
    expect(h.frames('session.reconnect_failed')).toEqual([{ attempt: 1, message: '[Qwen Throttling] Requests rate limit exceeded, please try again later.' }]);
    expect(h.of('failed')).toEqual([]);
    h.clock.advance(250);
    await comeBack(h, 'sess_3');
    expect(h.of('reconnected').map((e) => e.payload!.attempts)).toEqual([2]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);

    // A quota spent answering an attempt ends the attempts with rate_limit.
    const q = await live();
    q.socket().serverClose(1011);
    await flush();
    q.socket().open();
    await flush();
    q.socket().receive(SERVER.created('sess_2'));
    q.socket().receive(SERVER.error('Throttling.AllocationQuota', 'Allocated quota exceeded, please increase your quota limit.'));
    await flush();
    expect(q.of('failed').map((e) => [e.payload.code, e.payload.giveUp])).toEqual([['rate_limit', { attempts: 1, reason: 'terminal_error', errorCode: 'rate_limit' }]]);
  });

  it('[Qwen InvalidApiKey], a quota error and AccessDenied.Unpurchased end at once with their codes', async () => {
    const cases: Array<[string, string, string]> = [
      [SERVER.error('InvalidApiKey', 'Invalid API-key provided.'), 'auth', '[Qwen InvalidApiKey] Invalid API-key provided.'],
      [SERVER.error('Throttling.AllocationQuota', 'Allocated quota exceeded, please increase your quota limit.'), 'rate_limit', '[Qwen Throttling.AllocationQuota] Allocated quota exceeded, please increase your quota limit.'],
      [SERVER.denied(), 'model_access_denied', '[Qwen AccessDenied.Unpurchased] Access to model denied. Please make sure you are eligible for using the model.'],
      [SERVER.error('invalid_value', 'Invalid translation parameter.'), 'client', '[Qwen invalid_value] Invalid translation parameter.'],
    ];
    for (const isManaged of [false, true]) {
      for (const [error, code, message] of cases) {
        const lease = fakeLease({ ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: true });
        const h = await live(isManaged ? { lease } : {});
        h.socket().receive(error);
        // A close that alone would reconnect: the error before it decides.
        h.socket().serverClose(1011, 'Internal error');
        await flush();
        expect(h.of('failed')).toEqual([{ kind: 'failed', payload: { code, message, drop: { cause: 'error', closeCode: 1011, errorCode: code, retryable: false, managed: isManaged } } }]);
        expect(h.of('reconnecting')).toEqual([]);
        expect(h.seam.sockets.all).toHaveLength(1);
        expect(lease.port.reissue).not.toHaveBeenCalled();
        expect(h.timers()).toBe(0);
        expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
      }
    }
  });

  it('own key: a terminal error answering an attempt, auth included, ends the attempts at once with its own code', async () => {
    const h = await live();
    h.socket().serverClose(1011);
    await flush();
    h.socket().open();
    await flush();
    h.socket().receive(SERVER.created('sess_2'));
    h.socket().receive(SERVER.error('InvalidApiKey', 'Invalid API-key provided.'));
    await flush();
    expect(h.of('failed')).toEqual([{
      kind: 'failed',
      payload: {
        code: 'auth',
        message: '[Qwen InvalidApiKey] Invalid API-key provided.',
        drop: dropOf({ cause: 'close', closeCode: 1011 }),
        giveUp: { attempts: 1, reason: 'terminal_error', errorCode: 'auth' },
      },
    }]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it(`attempts on the shared schedule, every one on the same key, and at ${RECONNECT_BUDGET_MS / 1000} s it gives up in the last attempt's words`, async () => {
    const h = await live();
    h.socket().serverClose(1006);
    await flush();
    const offsets = [0, 250, 750, 1750, 3750, 7750, 11750, 15750, 19750, 23750, 27750];
    let at = 0;
    for (const [i, offset] of offsets.entries()) {
      if (offset > at) {
        h.clock.advance(offset - at - 1);
        await flush();
        expect(h.seam.sockets.all).toHaveLength(i + 1);
        h.clock.advance(1);
        await flush();
        at = offset;
      }
      expect(h.seam.sockets.all).toHaveLength(i + 2);
      await failAttempt(h);
    }
    expect(new Set(bearers(h))).toEqual(new Set([`Bearer ${KEY.apiKey}`]));
    expect(h.of('failed')).toEqual([]);
    h.clock.advance(RECONNECT_BUDGET_MS - at);
    await flush();
    expect(h.seam.sockets.all).toHaveLength(offsets.length + 1);
    expect(h.of('failed')).toEqual([{
      kind: 'failed',
      payload: { code: 'connection_lost', message: NEVER_OPENED, drop: dropOf({ cause: 'close', closeCode: 1006 }), giveUp: { attempts: offsets.length, reason: 'timeout', errorCode: 'network' } },
    }]);
    expect(h.frames('session.reconnect_failed')).toHaveLength(offsets.length);
    expect(h.frames('session.closed')).toEqual([{ code: 1006, reason: '' }]);
    expect(h.frames('session.connection_lost')).toEqual([{ attempts: offsets.length }]);
    expect(h.timers()).toBe(0);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('the 101st drop ends with connection_lost in plain words, carrying its drop and a session_cap give-up, without an attempt', async () => {
    expect(MAX_RECONNECTS).toBe(100);
    const h = await live();
    // Each drop past the flapping window of the reconnect before it: no flap, so neither the ladder nor the per-minute limit applies.
    for (let i = 0; i < MAX_RECONNECTS; i++) {
      h.clock.advance(FLAP_WINDOW_MS + 1);
      h.socket().serverClose(1006);
      await comeBack(h);
    }
    expect(h.of('reconnected')).toHaveLength(MAX_RECONNECTS);
    const count = h.seam.sockets.all.length;
    h.clock.advance(FLAP_WINDOW_MS + 1);
    h.socket().serverClose(1006);
    await flush();
    expect(h.seam.sockets.all).toHaveLength(count);
    expect(h.of('failed')).toEqual([{
      kind: 'failed',
      payload: { code: 'connection_lost', message: CONNECTION_LOST, drop: dropOf({ cause: 'close', closeCode: 1006 }), giveUp: { attempts: 0, reason: 'session_cap' } },
    }]);
    expect(h.timers()).toBe(0);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('an attempt whose handshake drops halfway leaves the next to start over: its own update, then live', async () => {
    const h = await live();
    h.socket().serverClose(1011);
    await flush();
    const halfway = h.socket();
    halfway.open();
    await flush();
    halfway.receive(SERVER.created('sess_2'));
    expect(types(halfway)).toEqual(['session.update']);
    halfway.drop();
    await flush();
    expect(h.frames('session.reconnect_failed')).toEqual([{ attempt: 1, message: expect.stringMatching(/^Qwen closed the connection before the session started/) }]);
    expect(h.frames('session.closed')).toEqual([{ code: 1011, reason: '' }, { code: 1006, reason: '' }]);
    expect(h.frames('session.connection_lost')).toEqual([]);
    h.clock.advance(250);
    await comeBack(h, 'sess_3');
    expect(types(h.socket())).toEqual(['session.update']);
    expect(h.of('reconnected').map((e) => e.payload!.attempts)).toEqual([2]);
    h.session.appendAudio(chunk());
    expect(h.appended()).toHaveLength(1);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it("an attempt's handshake closed with 1008 or 1003 ends the attempts at once, as the same close ends a live connection", async () => {
    for (const close of [1008, 1003]) {
      const h = await live();
      h.socket().serverClose(1011);
      await flush();
      h.socket().open();
      await flush();
      h.socket().receive(SERVER.created('sess_2'));
      // Before session.updated.
      h.socket().serverClose(close);
      await flush();
      expect(h.of('failed'), String(close)).toEqual([{
        kind: 'failed',
        payload: {
          code: 'server',
          message: `Qwen closed the connection before the session started (${close}).`,
          drop: dropOf({ cause: 'close', closeCode: 1011 }),
          giveUp: { attempts: 1, reason: 'terminal_error', errorCode: 'server' },
        },
      }]);
      h.clock.advance(RECONNECT_BUDGET_MS);
      await flush();
      expect(h.seam.sockets.all).toHaveLength(2);
      expect(h.timers()).toBe(0);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
  });

  it("an attempt's handshake closed with 1006 or 1011 is a failed attempt: the next one dials again and comes back", async () => {
    for (const close of [1006, 1011]) {
      const h = await live();
      h.socket().serverClose(1011);
      await flush();
      h.socket().open();
      await flush();
      h.socket().receive(SERVER.created('sess_2'));
      h.socket().serverClose(close);
      await flush();
      expect(h.of('failed'), String(close)).toEqual([]);
      expect(h.frames('session.reconnect_failed')).toEqual([{ attempt: 1, message: `Qwen closed the connection before the session started (${close}).` }]);
      h.clock.advance(250);
      await comeBack(h, 'sess_3');
      expect(h.of('reconnected').map((e) => e.payload!.attempts)).toEqual([2]);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
  });

  it('a connection that drops right behind its session.updated fails that attempt: the next one follows, then reconnected once', async () => {
    const h = await live();
    h.socket().serverClose(1011);
    await flush();
    h.socket().open();
    await flush();
    h.socket().receive(SERVER.created('sess_2'));
    h.socket().receive(SERVER.updated());
    h.socket().serverClose(1011);
    await flush();
    expect(h.of('reconnected')).toEqual([]);
    expect(h.frames('session.reconnect_failed')).toEqual([{ attempt: 1, message: 'The new connection dropped as it opened.' }]);
    // The same drop's attempt 2, 250 ms on.
    expect(h.seam.sockets.all).toHaveLength(2);
    h.clock.advance(250);
    await comeBack(h, 'sess_3');
    expect(h.seam.sockets.all).toHaveLength(3);
    expect(h.of('reconnecting').map((e) => e.payload!.attempt)).toEqual([1, 2]);
    expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 2, credentialsReissued: false, reissueMs: 0, budgetShared: false }]);
    expect(h.of('failed')).toEqual([]);
    h.session.appendAudio(chunk());
    expect(h.appended()).toHaveLength(1);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('networkRestored during a wait attempts at once', async () => {
    const h = await live();
    h.socket().serverClose(1006);
    await flush();
    await failAttempt(h);
    // Waiting 250 ms for attempt 2: the network's return starts it now.
    expect(h.seam.sockets.all).toHaveLength(2);
    const now = h.clock.now();
    h.session.networkRestored!();
    await flush();
    expect(h.seam.sockets.all).toHaveLength(3);
    expect(h.clock.now()).toBe(now);
    await comeBack(h);
    expect(h.of('reconnected').map((e) => e.payload!.attempts)).toEqual([2]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it("a stop during the attempts leaves nothing behind: no attempt, no timer, no event, every socket closed", async () => {
    // Waiting out a backoff.
    {
      const h = await live();
      h.socket().serverClose(1006);
      await failAttempt(h);
      expect(h.timers()).toBeGreaterThan(0);
      const n = h.log.length;
      await h.session.stop();
      expect(h.timers()).toBe(0);
      h.clock.advance(60_000);
      await flush();
      expect(h.seam.sockets.all).toHaveLength(2);
      expect(h.log.length).toBe(n);
    }
    // An attempt's socket still opening, and one mid-handshake.
    for (const handshaking of [false, true]) {
      const h = await live();
      h.socket().serverClose(1006);
      await flush();
      const attempt = h.socket();
      if (handshaking) {
        attempt.open();
        await flush();
        attempt.receive(SERVER.created('sess_2'));
      }
      const n = h.log.length;
      await h.session.stop();
      await flush();
      expect(attempt.readyState).toBe(FakeSocket.CLOSED);
      expect(h.timers()).toBe(0);
      h.clock.advance(60_000);
      await flush();
      expect(h.log.length).toBe(n);
    }
  });
});

describe('the Qwen adapter reconnects: managed', () => {
  it("managed: an expired token is reissued and the new socket's Authorization carries it", async () => {
    // The grant's token has lapsed by the drop (it lasts 60 s): the lease answers a fresh one.
    const lease = fakeLease({ ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: true });
    const h = await live({ lease, requestIds: [REQ_1, REQ_2] });
    expect(lease.port.sessionCreated.mock.calls).toEqual([['sess_1', REQ_1]]);
    const first = h.socket();
    const lateMessage = first.onmessage!;
    first.serverClose(1011);
    await flush();
    expect(lease.port.reissue).toHaveBeenCalledTimes(1);
    expect(bearers(h)).toEqual([`Bearer ${TOKEN_0}`, `Bearer ${TOKEN_1}`]);
    await comeBack(h, 'sess_2');
    expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf({ cause: 'close', closeCode: 1011 }, true) }]);
    expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 1, credentialsReissued: true, reissueMs: 0, budgetShared: false }]);
    // The new connection reports its own session, with its own handshake's request id.
    expect(lease.port.sessionCreated.mock.calls).toEqual([['sess_1', REQ_1], ['sess_2', REQ_2]]);
    // A late event from the old socket, still closing, reaches nothing: no segment, no turn, no report for the new connection.
    lateMessage.call(first, new MessageEvent('message', { data: SERVER.created('sess_late') }));
    lateMessage.call(first, new MessageEvent('message', { data: SERVER.sourceDelta('item_h9', 'late') }));
    lateMessage.call(first, new MessageEvent('message', { data: SERVER.responseDone() }));
    expect(h.of('segmentOpened')).toEqual([]);
    expect(lease.port.sessionCreated).toHaveBeenCalledTimes(2);
    expect(h.socket().sentJson()).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
    expect(JSON.stringify(h.log)).not.toMatch(/st-token|Bearer/);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('managed: a still-valid token is reused', async () => {
    // The lease answers the token it holds while it lasts (`lease.ts`, until 5 s before its expiry, for both legs): every attempt dials it, and nothing counts as reissued.
    const held: QwenReissue = { ok: true, apiKey: TOKEN_0, expiresAt: 60_000, fresh: false };
    const lease = fakeLease(held, held);
    const h = await live({ lease });
    h.socket().serverClose(1011);
    await failAttempt(h);
    h.clock.advance(250);
    await flush();
    expect(lease.port.reissue).toHaveBeenCalledTimes(2);
    expect(bearers(h)).toEqual([`Bearer ${TOKEN_0}`, `Bearer ${TOKEN_0}`, `Bearer ${TOKEN_0}`]);
    await comeBack(h);
    expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 2, credentialsReissued: false, reissueMs: 0, budgetShared: false }]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it("managed: a new token the cache served — the other leg's fetch — is dialled, and nothing counts as reissued for this leg", async () => {
    const lease = fakeLease({ ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: false });
    const h = await live({ lease });
    h.socket().serverClose(1011);
    await comeBack(h);
    expect(bearers(h)).toEqual([`Bearer ${TOKEN_0}`, `Bearer ${TOKEN_1}`]);
    expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 1, credentialsReissued: false, reissueMs: 0, budgetShared: false }]);
  });

  it('a retryable reissue failure is a failed attempt; the next one asks again', async () => {
    const lease = fakeLease({ ok: false, retry: true, message: 'HTTP 503' }, { ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: true });
    const h = await live({ lease });
    h.socket().serverClose(1011);
    await flush();
    expect(h.seam.sockets.all).toHaveLength(1);
    expect(h.frames('session.reconnect_failed')).toEqual([{ attempt: 1, message: 'HTTP 503' }]);
    h.clock.advance(250);
    await flush();
    expect(lease.port.reissue).toHaveBeenCalledTimes(2);
    expect(bearers(h)).toEqual([`Bearer ${TOKEN_0}`, `Bearer ${TOKEN_1}`]);
    await comeBack(h);
    expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 2, credentialsReissued: true, reissueMs: 0, budgetShared: false }]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it("managed: Qwen refusing a cached token at an attempt's handshake is a failed attempt; the next asks past the cache and comes back", async () => {
    // Refused by an error frame, or by the words of the close before the session started.
    const refusals: Array<(s: FakeSocket) => void> = [
      (s) => s.receive(SERVER.error('InvalidApiToken', 'Invalid API token.')),
      (s) => s.serverClose(1008, 'API Token is expired.'),
    ];
    for (const refuse of refusals) {
      const lease = fakeLease({ ok: true, apiKey: TOKEN_0, expiresAt: 60_000, fresh: false }, { ok: true, apiKey: TOKEN_1, expiresAt: 120_000, fresh: true });
      const h = await live({ lease });
      h.socket().serverClose(1011);
      await flush();
      expect(lease.port.reissue).toHaveBeenNthCalledWith(1);
      h.socket().open();
      await flush();
      h.socket().receive(SERVER.created('sess_2'));
      refuse(h.socket());
      await flush();
      expect(h.of('failed')).toEqual([]);
      expect(h.frames('session.reconnect_failed')).toHaveLength(1);
      h.clock.advance(250);
      await flush();
      expect(lease.port.reissue).toHaveBeenNthCalledWith(2, { refused: TOKEN_0 });
      expect(bearers(h)).toEqual([`Bearer ${TOKEN_0}`, `Bearer ${TOKEN_0}`, `Bearer ${TOKEN_1}`]);
      await comeBack(h, 'sess_3');
      expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 2, credentialsReissued: true, reissueMs: 0, budgetShared: false }]);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
  });

  it('managed: a token fetched for an earlier drop, served by the cache and refused in this one, is asked past', async () => {
    const lease = fakeLease(
      { ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: true },
      { ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: false },
      { ok: true, apiKey: 'st-token-2', expiresAt: 120_000, fresh: true },
    );
    const h = await live({ lease });
    h.socket().serverClose(1011);
    await comeBack(h);
    h.clock.advance(20_000);
    h.socket().serverClose(1011);
    await flush();
    h.socket().open();
    await flush();
    h.socket().receive(SERVER.created('sess_3'));
    h.socket().receive(SERVER.error('InvalidApiToken', 'Invalid API token.'));
    await flush();
    expect(h.of('failed')).toEqual([]);
    h.clock.advance(250);
    await flush();
    expect(lease.port.reissue).toHaveBeenNthCalledWith(3, { refused: TOKEN_1 });
    await comeBack(h, 'sess_4');
    expect(h.of('reconnected').map((e) => e.payload!.attempts)).toEqual([1, 2]);
  });

  it('managed: Qwen refusing a token fetched for this drop gives up with auth, whichever attempt dialled it', async () => {
    const auth = (s: FakeSocket) => s.receive(SERVER.error('InvalidApiToken', 'Invalid API token.'));
    const expected = (attempts: number) => [{
      kind: 'failed',
      payload: { code: 'auth', message: '[Qwen InvalidApiToken] Invalid API token.', drop: dropOf({ cause: 'close', closeCode: 1011 }, true), giveUp: { attempts, reason: 'terminal_error', errorCode: 'auth' } },
    }];
    // Fetched by this attempt.
    {
      const lease = fakeLease({ ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: true });
      const h = await live({ lease });
      h.socket().serverClose(1011);
      await flush();
      h.socket().open();
      await flush();
      h.socket().receive(SERVER.created('sess_2'));
      auth(h.socket());
      await flush();
      expect(h.of('failed')).toEqual(expected(1));
      expect(lease.port.reissue).toHaveBeenCalledTimes(1);
      expect(h.timers()).toBe(0);
    }
    // Fetched by the attempt before, whose socket never opened; the cache serves it to this one.
    {
      const lease = fakeLease({ ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: true }, { ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: false });
      const h = await live({ lease });
      h.socket().serverClose(1011);
      await failAttempt(h);
      h.clock.advance(250);
      await flush();
      h.socket().open();
      await flush();
      h.socket().receive(SERVER.created('sess_2'));
      auth(h.socket());
      await flush();
      expect(h.of('failed')).toEqual(expected(2));
      expect(lease.port.reissue).toHaveBeenNthCalledWith(2);
      expect(h.timers()).toBe(0);
    }
  });

  it('a refusal stops the attempts: sign_in_required and wallet_frozen as themselves, any other as connection_lost with its code; lease_ended gives up as such', async () => {
    const cases: Array<[QwenReissue & { ok: false; retry: false }, string, 'refused' | 'lease_ended']> = [
      [{ ok: false, retry: false, code: 'sign_in_required', message: 'Sign in again.' }, 'sign_in_required', 'refused'],
      [{ ok: false, retry: false, code: 'wallet_frozen', message: 'The wallet is frozen.' }, 'wallet_frozen', 'refused'],
      [{ ok: false, retry: false, code: 'reissue_limit', message: 'No more tokens.' }, 'connection_lost', 'refused'],
      [{ ok: false, retry: false, code: 'unsupported', message: 'HTTP 404' }, 'connection_lost', 'refused'],
      // The Qwen lease has no grant-end test of its own: its timer ends the run at the grant's end, so a lease_ended here is connection_lost.
      [{ ok: false, retry: false, code: 'lease_ended', message: 'The lease has ended.' }, 'connection_lost', 'lease_ended'],
    ];
    for (const [refusal, code, reason] of cases) {
      const lease = fakeLease(refusal);
      const h = await live({ lease });
      h.socket().serverClose(1011);
      await flush();
      expect(h.of('failed')).toEqual([{
        kind: 'failed',
        payload: { code, message: refusal.message, drop: dropOf({ cause: 'close', closeCode: 1011 }, true), giveUp: { attempts: 1, reason, errorCode: code, refusalCode: refusal.code } },
      }]);
      expect(h.seam.sockets.all).toHaveLength(1);
      expect(h.timers()).toBe(0);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
  });

  it('a stop while the reissue is out: its late answer opens nothing and says nothing', async () => {
    const lease = fakeLease();
    const h = await live({ lease });
    h.socket().serverClose(1011);
    await flush();
    expect(lease.waiting).toHaveLength(1);
    const n = h.log.length;
    await h.session.stop();
    expect(h.timers()).toBe(0);
    lease.answer({ ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: true });
    await flush();
    h.clock.advance(60_000);
    await flush();
    expect(h.seam.sockets.all).toHaveLength(1);
    expect(h.log.length).toBe(n);
  });
});

describe('the Qwen adapter reconnects: the gap', () => {
  it('the in-flight segment closes at the drop; appendAudio during the gap sends nothing', async () => {
    const h = await live();
    h.socket().receive(SERVER.speechStarted('item_h1'));
    h.socket().receive(SERVER.heardItem('item_h1'));
    h.socket().receive(SERVER.outputItem('item_t1'));
    h.socket().receive(SERVER.answerItem('item_t1', 'item_h1'));
    h.socket().receive(SERVER.sourceDelta('item_h1', '你'));
    h.socket().receive(SERVER.transcriptDelta('item_t1', 'Hel'));
    expect(refs(h, 'segmentOpened')).toEqual([1, 2]);
    h.socket().serverClose(1011);
    await flush();
    // Closed as they stand, at the drop: before its first `reconnecting`.
    const at = h.log.findIndex((e) => e.kind === 'reconnecting');
    expect(h.log.slice(0, at).flatMap((e) => (e.kind === 'segmentClosed' ? [e.payload.ref] : []))).toEqual([1, 2]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['你', 'Hel']);
    const attempt = h.socket();
    expect(attempt.readyState).toBe(FakeSocket.CONNECTING);
    h.session.appendAudio(chunk());
    await comeBack(h);
    expect(h.socket()).toBe(attempt);
    expect(h.appended()).toEqual([]);
    h.session.appendAudio(chunk());
    expect(h.appended()).toHaveLength(1);
    // The new connection's segments go on with the next refs, even where its item ids repeat the dropped one's.
    for (const f of turn(1, { source: '你好', translation: 'Hello.' })) h.socket().receive(f);
    expect(refs(h, 'segmentOpened')).toEqual([1, 2, 3, 4]);
    expect(refs(h, 'segmentClosed')).toEqual([1, 2, 3, 4]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('a held press when it comes back opens a turn on the new socket', async () => {
    const h = await live({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk(1));
    h.session.endTurn();
    // Pressed again before that turn's response is done: held behind it.
    h.session.beginTurn();
    h.session.appendAudio(chunk(2));
    const dropped = h.socket();
    expect(types(dropped)).toEqual(['session.update', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
    dropped.serverClose(1011);
    await flush();
    // The dropped turn is gone with its socket: nothing waits on its response.done, and what it held never goes up.
    h.session.appendAudio(chunk(3));
    h.clock.advance(TURN_DONE_MS);
    expect(h.frames('session.turn_timeout')).toEqual([]);
    expect(h.frames('session.audio_released')).toEqual([]);
    await comeBack(h);
    // The press, still held, goes up as it comes on the new socket, and its release commits there.
    h.session.appendAudio(chunk(4));
    h.session.endTurn();
    expect(types(h.socket())).toEqual(['session.update', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
    expect(h.appended().map((pcm) => pcm[0])).toEqual([4]);
    expect(types(dropped)).toEqual(['session.update', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
    expect(checkConformance(h.log, MANUAL_CTX)).toEqual([]);
  });

  it('a release during the gap commits nothing: the turn open at the drop closed with it', async () => {
    const h = await live({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk(1));
    h.socket().serverClose(1011);
    await flush();
    h.session.endTurn();
    await comeBack(h);
    h.session.beginTurn();
    h.session.endTurn();
    expect(types(h.socket())).toEqual(['session.update']);
    expect(checkConformance(h.log, MANUAL_CTX)).toEqual([]);
  });

  it("with a screen source, the new connection declares video and sends the frame in hand right after its first audio", async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const h = await live({ frames: src });
    h.session.appendAudio(chunk());
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_image_buffer.append']);
    h.socket().serverClose(1011);
    await comeBack(h);
    // A session that declares video and gets no frame before its first turn is ended by the server (spec 2026-10-22 §2).
    expect(h.socket().sentJson<{ session: { input_modalities?: string[] } }>()[0].session.input_modalities).toEqual(['audio', 'video']);
    expect(types(h.socket())).toEqual(['session.update']);
    h.session.appendAudio(chunk());
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_image_buffer.append']);
    expect(h.socket().sentJson<{ image?: string }>()[2].image).toBe(btoa(String.fromCharCode(...JPEG_A)));
    // Later frames go at once, as before the drop.
    src.emit(JPEG_B);
    expect(types(h.socket()).slice(-1)).toEqual(['input_image_buffer.append']);
    expect(src.subscribers).toBe(1);
    await h.session.stop();
    expect(src.subscribers).toBe(0);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });
});

describe('the Qwen adapter reconnects: split legs and the conformance scenario', () => {
  it('split legs: only the dropped leg reconnects', async () => {
    const seam = fakeHeaderSockets();
    const { clock, timers } = trackedClock();
    const logs: Record<LegName, AdapterEvent[]> = { speaker: [], participant: [] };
    const contexts: Record<LegName, SessionContext> = { speaker: AUTO_CTX, participant: PARTICIPANT_CTX };
    const adapter = createQwenAdapter({ openHeaderSocket: seam.open, detect: async () => ({ endpoint: 'intl' }) });
    const start = async (leg: LegName, id: string) => {
      const starting = adapter.start(
        { context: contexts[leg], config: configFor(contexts[leg]), credentials: KEY, clock, signal: new AbortController().signal },
        eventsFrom((e) => { logs[leg].push(e); }),
      );
      await flush();
      const socket = seam.sockets.last();
      socket.open();
      await flush();
      socket.receive(SERVER.created(id));
      socket.receive(SERVER.updated());
      return { session: await starting, socket };
    };
    const of = <K extends AdapterEvent['kind']>(leg: LegName, kind: K) => logs[leg].filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
    /** The newest socket, an attempt's, opens and answers; whose it is shows in the target its update names. */
    const answerNewest = async () => {
      await flush();
      const socket = seam.sockets.last();
      socket.open();
      await flush();
      socket.receive(SERVER.created('sess_x'));
      socket.receive(SERVER.updated());
      await flush();
      return socket;
    };
    const speaker = await start('speaker', 'sess_A');
    const participant = await start('participant', 'sess_B');
    expect(speaker.session.info.shared).toBeUndefined();
    expect(participant.session.info.shared).toBeUndefined();

    speaker.socket.serverClose(1011);
    await flush();
    expect(seam.sockets.all).toHaveLength(3);
    expect(of('speaker', 'reconnecting')).toHaveLength(1);
    expect(of('participant', 'reconnecting')).toEqual([]);
    // The participant goes on meanwhile.
    for (const f of turn(1, { source: 'Hello.', translation: '你好。' })) participant.socket.receive(f);
    expect(of('participant', 'segmentText').map((e) => e.payload.text)).toEqual(['Hello.', '你好。']);
    const back = await answerNewest();
    expect(back.sentJson<{ session: { translation: { language: string } } }>()[0].session.translation.language).toBe('en');
    expect(of('speaker', 'reconnected')).toHaveLength(1);
    expect(of('participant', 'reconnected')).toEqual([]);

    // Both drop at once: two reconnectors, each on its own schedule. The speaker's drop is a flap, so its attempt 1 waits 250 ms; the participant's starts at once.
    back.serverClose(1011);
    participant.socket.serverClose(1011);
    await flush();
    expect(of('speaker', 'reconnecting')).toHaveLength(2);
    expect(of('participant', 'reconnecting')).toHaveLength(1);
    const participantBack = await answerNewest();
    clock.advance(250);
    const speakerBack = await answerNewest();
    const languages = [participantBack, speakerBack].map((s) => s.sentJson<{ session: { translation: { language: string } } }>()[0].session.translation.language);
    expect(languages).toEqual(['zh', 'en']);
    expect(of('speaker', 'reconnected')).toHaveLength(2);
    expect(of('participant', 'reconnected')).toHaveLength(1);
    expect(of('speaker', 'failed')).toEqual([]);
    expect(of('participant', 'failed')).toEqual([]);
    expect(checkConformance(logs.speaker, contexts.speaker)).toEqual([]);
    expect(checkConformance(logs.participant, contexts.participant)).toEqual([]);
    await speaker.session.stop();
    await participant.session.stop();
    expect(timers()).toBe(0);
  });

  it('the reconnecting scenario passes, own key and managed', async () => {
    const lease = fakeLease({ ok: true, apiKey: TOKEN_1, expiresAt: 60_000, fresh: true });
    for (const harness of [qwenHarness(), qwenHarness(managed(lease))]) {
      const report = await runScenario(harness, 'reconnect');
      expect(report.violations).toEqual([]);
      expect(report.problems).toEqual([]);
    }
    expect(lease.port.reissue).toHaveBeenCalledTimes(1);
  });
});
