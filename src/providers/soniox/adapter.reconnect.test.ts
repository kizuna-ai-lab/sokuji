/**
 * Soniox's reconnect (spec 2026-11-05 reconnect §4): a dropped STT socket
 * comes back through the shared reconnector, with an own key (the same key
 * again) or managed (a key the lease reissues, reused while its socket never
 * opened); which ends reconnect and which end the leg; split and shared
 * Both; what the gap does to segments, audio and agent text; the stall
 * watchdog; the network's return; a stop during the attempts. On
 * `FakeSocket` and a virtual clock.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SessionContext, StartRequest } from '../../lib/contract/adapter';
import { checkConformance } from '../../lib/contract/conformance';
import { eventsFrom, recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { flush, voicedPcm } from '../../lib/contract/testing/drive';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import type { LegName } from '../../lib/conversation/types';
import type { SharedSettings } from '../../lib/provider/types';
import { MAX_RECONNECTS, type DropInfo } from '../../lib/session/reconnect';
import { createSonioxAdapter, SONIOX_STALL_MS, sonioxDropAction } from './adapter';
import { buildSoniox, type SonioxConfig } from './config';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxReissue } from './settings';
import { AUTO_CTX, END, ERROR_503, isStt, KEY, msg, orig, SHARED, tr, trackedClock, type Json } from './testing';

const KEY_1: SonioxReissue = { ok: true, stt: 'key-1', clientReferenceId: 'ref-1', expiresAt: 10_000 };
const KEY_2: SonioxReissue = { ok: true, stt: 'key-2', clientReferenceId: 'ref-2', expiresAt: 40_000 };

/** A managed lease whose reissues answer in the order given; one asked past them waits for `answer`. */
function fakeLease(...answers: SonioxReissue[]) {
  const waiting: Array<(a: SonioxReissue) => void> = [];
  const port = {
    streamAccepted: vi.fn(),
    atGrantEnd: vi.fn((_now: number) => false),
    cutoff: vi.fn(),
    reissue: vi.fn(() => {
      const next = answers.shift();
      return next ? Promise.resolve(next) : new Promise<SonioxReissue>((resolve) => waiting.push(resolve));
    }),
  };
  return { port, answer: (a: SonioxReissue) => waiting.shift()!(a), waiting };
}

/** Managed credentials: the lease's first key, its reference, and the port. */
const managed = (lease: ReturnType<typeof fakeLease>): SonioxCredentials => ({ ...KEY, stt: 'key-0', clientReferenceId: 'ref-0', lease: lease.port });

/** One leg, live: its STT and TTS sockets opened, the start resolved. */
async function live(credentials: SonioxCredentials = KEY, context: SessionContext = AUTO_CTX) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const starting = createSonioxAdapter({ openSocket: sockets.create }).start(
    { context, config: buildSoniox(context, SONIOX_DEFAULTS, SHARED), credentials, clock, signal: new AbortController().signal },
    events,
  );
  for (const s of sockets.all) s.open();
  const session = await starting;
  const sttSockets = () => sockets.all.filter(isStt);
  const stt = () => sttSockets().slice(-1)[0];
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  return { sockets, clock, timers, log, session, sttSockets, stt, of, frames };
}

type Live = Awaited<ReturnType<typeof live>>;

/** The newest STT socket, an attempt's, opens. */
async function openAttempt(h: Pick<Live, 'stt'>): Promise<void> {
  h.stt().open();
  await flush();
}

/** The newest STT socket, an attempt's, drops before it opens. */
async function failAttempt(h: Pick<Live, 'stt'>): Promise<void> {
  h.stt().drop();
  await flush();
}

/** Audio the leg sends while it talks: 100-ms chunks on the clock. */
function speak(h: Pick<Live, 'session' | 'clock'>, ms: number): void {
  for (let t = 0; t < ms; t += 100) {
    h.session.appendAudio(voicedPcm(100));
    h.clock.advance(100);
  }
}

const binary = (s: FakeSocket) => s.sent.filter((d) => typeof d !== 'string');
const refs = (h: Pick<Live, 'of'>, kind: 'segmentOpened' | 'segmentClosed') => h.of(kind).map((e) => e.payload.ref);
const dropOf = (drop: Omit<DropInfo, 'retryable' | 'managed'>, managedKey = false): DropInfo => ({ ...drop, retryable: true, managed: managedKey });

describe('sonioxDropAction: what a live socket\'s end means (spec §4.1)', () => {
  it('503, 408 and a socket error reconnect; 401, 402, 403, 429, another 4xx and an unknown code end', () => {
    for (const error of ['503', '408', 'socket_error']) expect(sonioxDropAction({ error, atGrantEnd: false })).toBe('reconnect');
    for (const error of ['401', '402', '403', '429', '400', '404', 'boom']) expect(sonioxDropAction({ error, atGrantEnd: false })).toBe('end');
  });

  it("a 403 at the grant's end is the cutoff; only a 403 is", () => {
    expect(sonioxDropAction({ error: '403', atGrantEnd: true })).toBe('cutoff');
    expect(sonioxDropAction({ error: '401', atGrantEnd: true })).toBe('end');
    expect(sonioxDropAction({ error: '503', atGrantEnd: true })).toBe('reconnect');
    expect(sonioxDropAction({ close: 1006, atGrantEnd: true })).toBe('reconnect');
  });

  it('a close by its code: the transport family reconnects, a refused request or an unknown code ends', () => {
    for (const close of [1000, 1001, 1005, 1006, 1011, 1012, 1013, 1014]) expect(sonioxDropAction({ close, atGrantEnd: false })).toBe('reconnect');
    for (const close of [1003, 1007, 1008, 1009, 1010, 4000, undefined]) expect(sonioxDropAction({ close, atGrantEnd: false })).toBe('end');
  });
});

describe('the Soniox adapter reconnects: own key', () => {
  it('own key: a 1006 after live reconnects with the same key and the leg stays live', async () => {
    const h = await live();
    const first = h.stt();
    first.serverClose(1006);
    await flush();
    expect(h.sttSockets()).toHaveLength(2);
    expect(h.stt().protocols).toEqual(first.protocols);
    await openAttempt(h);
    expect(h.of('reconnecting')).toEqual([{ kind: 'reconnecting', payload: { attempt: 1, drop: dropOf({ cause: 'close', closeCode: 1006 }) } }]);
    expect(h.of('reconnected')).toEqual([{ kind: 'reconnected', payload: { attempts: 1, credentialsReissued: false, reissueMs: 0, budgetShared: false } }]);
    expect(h.of('failed')).toEqual([]);
    // The config frame byte for byte again.
    expect(h.stt().sentJson()[0]).toEqual(first.sentJson()[0]);
    expect(h.frames('session.reconnecting')).toEqual([{ cause: 'close', code: 1006 }]);
    expect(h.frames('session.reconnected')).toEqual([{ downMs: 0, attempts: 1 }]);
    h.stt().receive(msg(orig('Again.'), tr('また。'), END));
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['Again.', 'また。']);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('a 408 and a socket error reconnect at once, the server\'s words in the Logs', async () => {
    const acts: Array<[(s: FakeSocket) => void, Omit<DropInfo, 'retryable' | 'managed'>]> = [
      [(s) => s.receive(JSON.stringify({ error_code: 408, error_message: 'Request timeout' })), { cause: 'error', errorCode: '408' }],
      [(s) => s.drop(), { cause: 'error', errorCode: 'socket_error' }],
    ];
    for (const [act, drop] of acts) {
      const h = await live();
      const first = h.stt();
      act(first);
      // Break before make: the dropped socket is closed before the attempt's opens.
      expect(first.closedByClient).not.toBeNull();
      expect(h.sttSockets()).toHaveLength(2);
      await openAttempt(h);
      expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf(drop) }]);
      expect(h.of('reconnected')).toHaveLength(1);
      expect(h.of('failed')).toEqual([]);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
    const h = await live();
    h.stt().receive(JSON.stringify({ error_code: 408, error_message: 'Request timeout' }));
    expect(h.frames('stt.error')).toEqual([{ code: '408', message: 'Request timeout' }]);
  });

  it('the own-key 503 path uses the shared schedule: attempts at 0, 250, 750, 1750, 3750, 7750, then every 4 s, and at 30 s it gives up', async () => {
    const h = await live();
    h.stt().receive(ERROR_503);
    await flush();
    const offsets = [0, 250, 750, 1750, 3750, 7750, 11750, 15750, 19750, 23750, 27750];
    let at = 0;
    for (const [i, offset] of offsets.entries()) {
      if (offset > at) {
        h.clock.advance(offset - at - 1);
        await flush();
        expect(h.sttSockets()).toHaveLength(i + 1);
        h.clock.advance(1);
        await flush();
        at = offset;
      }
      expect(h.sttSockets()).toHaveLength(i + 2);
      // Every attempt on the same key.
      expect(h.stt().protocols).toEqual(['soniox-api-key', 'test-key']);
      await failAttempt(h);
    }
    expect(h.of('failed')).toEqual([]);
    h.clock.advance(30_000 - at - 1);
    await flush();
    expect(h.of('failed')).toEqual([]);
    h.clock.advance(1);
    await flush();
    expect(h.sttSockets()).toHaveLength(offsets.length + 1);
    expect(h.of('failed')).toEqual([{
      kind: 'failed',
      payload: {
        code: 'connection_lost',
        message: expect.any(String),
        drop: dropOf({ cause: 'error', errorCode: '503' }),
        giveUp: { attempts: offsets.length, reason: 'timeout', errorCode: 'socket_error' },
      },
    }]);
    expect(h.of('reconnecting').map((e) => e.payload!.attempt)).toEqual(offsets.map((_, i) => i + 1));
    expect(h.frames('session.reconnect_failed')).toHaveLength(offsets.length);
    expect(h.frames('session.connection_lost')).toEqual([{ attempts: offsets.length }]);
    expect(h.timers()).toBe(0);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('401, 429 and a non-retryable close end at once with their code and drop.retryable false', async () => {
    const cases: Array<[(s: FakeSocket) => void, string, Omit<DropInfo, 'retryable' | 'managed'>]> = [
      [(s) => s.receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' })), 'auth', { cause: 'error', errorCode: '401' }],
      [(s) => s.receive(JSON.stringify({ error_code: 402, error_message: 'Payment required' })), 'client', { cause: 'error', errorCode: '402' }],
      [(s) => s.receive(JSON.stringify({ error_code: 429, error_message: 'Too many requests' })), 'rate_limit', { cause: 'error', errorCode: '429' }],
      [(s) => s.serverClose(1008, 'Policy violation'), 'connection_lost', { cause: 'close', closeCode: 1008 }],
    ];
    for (const isManaged of [false, true]) {
      for (const [act, code, drop] of cases) {
        const lease = fakeLease(KEY_1);
        const h = await live(isManaged ? managed(lease) : KEY);
        act(h.stt());
        await flush();
        expect(h.of('failed')).toEqual([{ kind: 'failed', payload: { code, message: expect.any(String), drop: { ...drop, retryable: false, managed: isManaged } } }]);
        expect(h.of('reconnecting')).toEqual([]);
        expect(h.sttSockets()).toHaveLength(1);
        expect(lease.port.reissue).not.toHaveBeenCalled();
        expect(h.timers()).toBe(0);
        expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
      }
    }
  });

  it('the 101st drop ends with connection_lost, carrying its drop and a session_cap give-up, without an attempt', async () => {
    expect(MAX_RECONNECTS).toBe(100);
    const h = await live();
    for (let i = 0; i < MAX_RECONNECTS; i++) {
      h.stt().serverClose(1006);
      await flush();
      await openAttempt(h);
    }
    expect(h.of('reconnected')).toHaveLength(MAX_RECONNECTS);
    const count = h.sttSockets().length;
    h.stt().serverClose(1006);
    await flush();
    expect(h.sttSockets()).toHaveLength(count);
    expect(h.of('failed')).toEqual([{
      kind: 'failed',
      payload: { code: 'connection_lost', message: expect.any(String), drop: dropOf({ cause: 'close', closeCode: 1006 }), giveUp: { attempts: 0, reason: 'session_cap' } },
    }]);
    expect(h.timers()).toBe(0);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });
});

describe('the Soniox adapter reconnects: managed', () => {
  it('managed: a 1006 reissues once and connects with the new key and reference id', async () => {
    const lease = fakeLease(KEY_1);
    const h = await live(managed(lease));
    const first = h.stt();
    expect(first.sentJson<Json>()[0]).toMatchObject({ client_reference_id: 'ref-0' });
    first.receive(msg(orig('Hi', false)));
    expect(lease.port.streamAccepted).toHaveBeenCalledTimes(1);
    first.serverClose(1006);
    await flush();
    expect(lease.port.reissue).toHaveBeenCalledTimes(1);
    // The key rides the subprotocol, never the config frame.
    expect(h.stt().protocols).toEqual(['soniox-api-key', 'key-1']);
    await openAttempt(h);
    const config = h.stt().sentJson<Json>()[0];
    expect(config).toMatchObject({ client_reference_id: 'ref-1' });
    expect(config).not.toHaveProperty('api_key');
    expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf({ cause: 'close', closeCode: 1006 }, true) }]);
    expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 1, credentialsReissued: true, reissueMs: 0, budgetShared: false }]);
    // A late frame from the old socket, still closing, reaches nothing: no segment, no report for the new key.
    first.onmessage!.call(first, new MessageEvent('message', { data: msg(orig('Late', false)) }));
    expect(lease.port.streamAccepted).toHaveBeenCalledTimes(1);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['Hi']);
    // The new key's first frame reports it.
    h.stt().receive(msg(orig('Again', false)));
    expect(lease.port.streamAccepted).toHaveBeenCalledTimes(2);
    expect(lease.port.reissue).toHaveBeenCalledTimes(1);
    expect(h.of('failed')).toEqual([]);
    expect(JSON.stringify(h.of('frame'))).not.toMatch(/key-[01]/);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('managed: a key whose socket never opened is reused by the next attempt; after its expiresAt a new one is fetched (Review Focus 4)', async () => {
    const lease = fakeLease(KEY_1, KEY_2);
    const h = await live(managed(lease));
    h.stt().serverClose(1006);
    await flush();
    expect(lease.port.reissue).toHaveBeenCalledTimes(1);
    expect(h.stt().protocols).toEqual(['soniox-api-key', 'key-1']);
    // Attempt 1's socket never opened: key-1 is unspent, and attempt 2 takes it.
    await failAttempt(h);
    h.clock.advance(250);
    await flush();
    expect(h.sttSockets()).toHaveLength(3);
    expect(h.stt().protocols).toEqual(['soniox-api-key', 'key-1']);
    expect(lease.port.reissue).toHaveBeenCalledTimes(1);
    // Attempt 2's connect stalls to the stream's own 15 s bound, past key-1's expiresAt (10 s): attempt 3 fetches key-2.
    h.clock.advance(15_000);
    await flush();
    expect(h.sttSockets()).toHaveLength(3);
    h.clock.advance(500);
    await flush();
    expect(lease.port.reissue).toHaveBeenCalledTimes(2);
    expect(h.sttSockets()).toHaveLength(4);
    expect(h.stt().protocols).toEqual(['soniox-api-key', 'key-2']);
    await openAttempt(h);
    expect(h.stt().sentJson<Json>()[0]).toMatchObject({ client_reference_id: 'ref-2' });
    expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 3, credentialsReissued: true, reissueMs: 0, budgetShared: false }]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('a retryable reissue failure is a failed attempt; the next one asks again', async () => {
    const lease = fakeLease({ ok: false, retry: true, message: 'HTTP 503' }, KEY_1);
    const h = await live(managed(lease));
    h.stt().serverClose(1006);
    await flush();
    expect(h.sttSockets()).toHaveLength(1);
    expect(h.frames('session.reconnect_failed')).toEqual([{ attempt: 1, message: 'HTTP 503' }]);
    h.clock.advance(250);
    await flush();
    expect(lease.port.reissue).toHaveBeenCalledTimes(2);
    expect(h.stt().protocols).toEqual(['soniox-api-key', 'key-1']);
    await openAttempt(h);
    expect(h.of('reconnected')).toHaveLength(1);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('503 on a managed key now reconnects', async () => {
    const lease = fakeLease(KEY_1);
    const h = await live(managed(lease));
    h.stt().receive(ERROR_503);
    await flush();
    expect(lease.port.reissue).toHaveBeenCalledTimes(1);
    await openAttempt(h);
    expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf({ cause: 'error', errorCode: '503' }, true) }]);
    expect(h.of('reconnected')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('a lease_ended reissue at grant end ends as a lease end; before it, as connection_lost', async () => {
    const ended: SonioxReissue = { ok: false, retry: false, code: 'lease_ended', message: 'The lease has ended.' };
    {
      const lease = fakeLease(ended);
      lease.port.atGrantEnd.mockReturnValue(true);
      const h = await live(managed(lease));
      h.stt().serverClose(1006);
      await flush();
      expect(lease.port.cutoff).toHaveBeenCalledTimes(1);
      expect(h.of('closed')).toHaveLength(1);
      expect(h.of('failed')).toEqual([]);
      expect(h.sttSockets()).toHaveLength(1);
      expect(h.timers()).toBe(0);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
    {
      const lease = fakeLease(ended);
      const h = await live(managed(lease));
      h.stt().serverClose(1006);
      await flush();
      expect(lease.port.cutoff).not.toHaveBeenCalled();
      expect(h.of('closed')).toEqual([]);
      expect(h.of('failed')).toEqual([{
        kind: 'failed',
        payload: {
          code: 'connection_lost',
          message: expect.any(String),
          drop: dropOf({ cause: 'close', closeCode: 1006 }, true),
          giveUp: { attempts: 1, reason: 'lease_ended', errorCode: 'connection_lost', refusalCode: 'lease_ended' },
        },
      }]);
      expect(h.timers()).toBe(0);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
  });

  it('sign_in_required ends with that code; wallet_frozen with its own; any other refusal as connection_lost', async () => {
    const cases: Array<[SonioxReissue & { ok: false; retry: false }, string]> = [
      [{ ok: false, retry: false, code: 'sign_in_required', message: 'Sign in again.' }, 'sign_in_required'],
      [{ ok: false, retry: false, code: 'wallet_frozen', message: 'The wallet is frozen.' }, 'wallet_frozen'],
      [{ ok: false, retry: false, code: 'reissue_limit', message: 'No more keys.' }, 'connection_lost'],
      [{ ok: false, retry: false, code: 'unsupported', message: 'HTTP 404' }, 'connection_lost'],
    ];
    for (const [refusal, code] of cases) {
      const lease = fakeLease(refusal);
      const h = await live(managed(lease));
      h.stt().serverClose(1006);
      await flush();
      expect(h.of('failed')).toEqual([{
        kind: 'failed',
        payload: {
          code,
          message: expect.any(String),
          drop: dropOf({ cause: 'close', closeCode: 1006 }, true),
          giveUp: { attempts: 1, reason: 'refused', errorCode: code, refusalCode: refusal.code },
        },
      }]);
      expect(h.sttSockets()).toHaveLength(1);
      expect(h.timers()).toBe(0);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
  });

  it('the grant timer firing during attempts cancels the reconnector with no timers left (Review Focus 5)', async () => {
    // A reissue in flight: the grant's end stops the session (the run ends as a lease end) before it answers.
    {
      const lease = fakeLease();
      const h = await live(managed(lease));
      h.stt().serverClose(1006);
      await flush();
      expect(lease.waiting).toHaveLength(1);
      lease.port.atGrantEnd.mockReturnValue(true);
      const n = h.log.length;
      await h.session.stop();
      expect(h.timers()).toBe(0);
      lease.answer(KEY_1);
      await flush();
      h.clock.advance(60_000);
      await flush();
      expect(h.sttSockets()).toHaveLength(1);
      expect(h.log.length).toBe(n);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
    // Waiting out a backoff.
    {
      const lease = fakeLease({ ok: false, retry: true, message: 'HTTP 503' });
      const h = await live(managed(lease));
      h.stt().serverClose(1006);
      await flush();
      expect(h.timers()).toBeGreaterThan(0);
      const n = h.log.length;
      await h.session.stop();
      expect(h.timers()).toBe(0);
      h.clock.advance(60_000);
      await flush();
      expect(lease.port.reissue).toHaveBeenCalledTimes(1);
      expect(h.log.length).toBe(n);
    }
  });
});

describe('the Soniox adapter reconnects: the gap', () => {
  it('the in-flight utterance closes at the drop; audio appended during the gap sends nothing', async () => {
    const h = await live();
    h.stt().receive(msg(orig('Half', false), tr('半')));
    expect(refs(h, 'segmentOpened')).toEqual([1, 2]);
    h.stt().serverClose(1006);
    await flush();
    // Closed as they stand, at the drop: before its first `reconnecting`.
    const at = h.log.findIndex((e) => e.kind === 'reconnecting');
    expect(h.log.slice(0, at).flatMap((e) => (e.kind === 'segmentClosed' ? [e.payload.ref] : []))).toEqual([1, 2]);
    const attempt = h.stt();
    expect(attempt.readyState).toBe(FakeSocket.CONNECTING);
    h.session.appendAudio(voicedPcm(100));
    expect(h.session.agentText!('lost', false)).toBe(false);
    await openAttempt(h);
    expect(binary(attempt)).toEqual([]);
    h.session.appendAudio(voicedPcm(100));
    expect(binary(attempt)).toHaveLength(1);
    // New segments go on with the next refs.
    h.stt().receive(msg(orig('Again.'), tr('また。'), END));
    expect(refs(h, 'segmentOpened')).toEqual([1, 2, 3, 4]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('a stall of SONIOX_STALL_MS while sending audio drops with cause stall; silence on our side never trips it', async () => {
    expect(SONIOX_STALL_MS).toBe(5_000);
    const h = await live();
    // The server answering while the leg talks keeps the socket alive.
    speak(h, 3_000);
    h.stt().receive(msg(orig('Hi', false)));
    speak(h, 4_000);
    expect(h.of('reconnecting')).toEqual([]);
    // Silence on our side: the server owes nothing.
    h.clock.advance(60_000);
    expect(h.of('reconnecting')).toEqual([]);
    // Speech again: the server's silence counts from it, not from before the pause.
    speak(h, 4_900);
    expect(h.of('reconnecting')).toEqual([]);
    const stalled = h.stt();
    speak(h, 100);
    expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf({ cause: 'stall' }) }]);
    expect(stalled.closedByClient).not.toBeNull();
    expect(h.sttSockets()).toHaveLength(2);
    expect(h.frames('session.reconnecting')).toEqual([{ cause: 'stall' }]);
    await openAttempt(h);
    expect(h.of('reconnected')).toHaveLength(1);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('a grant-end 403 waiting for its close is no stall, however long the server is silent', async () => {
    const lease = fakeLease();
    lease.port.atGrantEnd.mockReturnValue(true);
    const h = await live(managed(lease));
    h.stt().receive(JSON.stringify({ error_code: 403, error_message: 'Session duration exceeded' }));
    speak(h, 10_000);
    expect(h.of('reconnecting')).toEqual([]);
    expect(lease.port.reissue).not.toHaveBeenCalled();
    h.stt().serverClose(1000);
    await flush();
    expect(lease.port.cutoff).toHaveBeenCalledTimes(1);
    expect(h.of('closed')).toHaveLength(1);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('networkRestored during a wait attempts at once', async () => {
    const h = await live();
    h.stt().serverClose(1006);
    await flush();
    // Attempts 1–5 fail on the schedule; the sixth would wait 4 s.
    for (const delay of [0, 250, 500, 1_000, 2_000]) {
      if (delay) h.clock.advance(delay);
      await flush();
      await failAttempt(h);
    }
    expect(h.sttSockets()).toHaveLength(6);
    const now = h.clock.now();
    h.session.networkRestored!();
    expect(h.sttSockets()).toHaveLength(7);
    expect(h.clock.now()).toBe(now);
    await openAttempt(h);
    expect(h.of('reconnected').map((e) => e.payload!.attempts)).toEqual([6]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });
});

/** The participant's direction is the pair's reverse (`shared.ts`). */
const BOTH_SHARED: SharedSettings = { ...SHARED, reversed: (direction) => direction.source === 'ja' };
const SPK: SonioxCredentials = { region: 'us', stt: 'k-spk', tts: 'k-spk' };
const PAR: SonioxCredentials = { region: 'us', stt: 'k-par', tts: 'k-par' };
const CONTEXTS: Record<LegName, SessionContext> = {
  speaker: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' },
  participant: { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' },
};

/** Both legs live, split (two cores) or shared (one socket); each leg's log, and one log of both in order. */
async function liveBoth(shared: boolean) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const settings = { ...SONIOX_DEFAULTS, bothModeSharedSession: shared };
  const logs: Record<LegName, AdapterEvent[]> = { speaker: [], participant: [] };
  const all: Array<{ leg: LegName; kind: AdapterEvent['kind'] }> = [];
  const events = (leg: LegName) => eventsFrom((e) => { logs[leg].push(e); all.push({ leg, kind: e.kind }); });
  const signal = new AbortController().signal;
  const request = (leg: LegName, credentials: SonioxCredentials): StartRequest<SonioxConfig, SonioxCredentials> =>
    ({ context: CONTEXTS[leg], config: buildSoniox(CONTEXTS[leg], settings, BOTH_SHARED), credentials, clock, signal });
  const starting = createSonioxAdapter({ openSocket: sockets.create }).startBoth(
    { speaker: request('speaker', SPK), participant: request('participant', PAR) },
    { speaker: events('speaker'), participant: events('participant') },
  );
  for (const s of sockets.all) s.open();
  const sessions = await starting;
  /** The newest STT socket on this key. */
  const sttOn = (key: string) => sockets.all.filter((s) => isStt(s) && s.protocols?.[1] === key).slice(-1)[0];
  const sttSockets = () => sockets.all.filter(isStt);
  const of = <K extends AdapterEvent['kind']>(leg: LegName, kind: K) => logs[leg].filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  const conformance = () => ({ speaker: checkConformance(logs.speaker, CONTEXTS.speaker), participant: checkConformance(logs.participant, CONTEXTS.participant) });
  return { sockets, clock, timers, sessions, logs, all, sttOn, sttSockets, of, conformance };
}

describe('the Soniox adapter reconnects: Both', () => {
  it('split Both: a drop on the speaker core reconnects only it; the participant keeps receiving (Review Focus 2)', async () => {
    const h = await liveBoth(false);
    expect(h.sessions.speaker.info.shared).toBeUndefined();
    expect(h.sessions.participant.info.shared).toBeUndefined();
    h.sttOn('k-spk').serverClose(1006);
    await flush();
    expect(h.sttSockets()).toHaveLength(3);
    expect(h.of('speaker', 'reconnecting')).toHaveLength(1);
    expect(h.of('participant', 'reconnecting')).toEqual([]);
    h.sttOn('k-par').receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    expect(h.of('participant', 'segmentText').map((e) => e.payload.text)).toEqual(['Ohayō.', 'Good morning.']);
    h.sttOn('k-spk').open();
    await flush();
    expect(h.of('speaker', 'reconnected')).toHaveLength(1);
    expect(h.of('participant', 'reconnected')).toEqual([]);

    // Both drop at once: two reconnectors, each on its own key and its own schedule.
    h.sttOn('k-spk').serverClose(1006);
    h.sttOn('k-par').serverClose(1006);
    await flush();
    expect(h.sttSockets()).toHaveLength(5);
    h.sttOn('k-par').open();
    await flush();
    expect(h.of('participant', 'reconnected')).toHaveLength(1);
    expect(h.of('speaker', 'reconnected')).toHaveLength(1);
    h.sttOn('k-spk').drop();
    await flush();
    h.clock.advance(250);
    await flush();
    h.sttOn('k-spk').open();
    await flush();
    expect(h.of('speaker', 'reconnected').map((e) => e.payload!.attempts)).toEqual([1, 2]);
    expect(h.of('speaker', 'failed')).toEqual([]);
    expect(h.of('participant', 'failed')).toEqual([]);
    expect(h.conformance()).toEqual({ speaker: [], participant: [] });
  });

  it('shared Both: one socket reconnects and both legs get reconnecting and reconnected', async () => {
    const h = await liveBoth(true);
    expect(h.sessions.speaker.info.shared).toBe(true);
    expect(h.sessions.participant.info.shared).toBe(true);
    expect(h.sttSockets()).toHaveLength(1);
    h.sttSockets()[0].serverClose(1006);
    await flush();
    expect(h.sttSockets()).toHaveLength(2);
    const drop = dropOf({ cause: 'close', closeCode: 1006 });
    for (const leg of ['speaker', 'participant'] as const) expect(h.of(leg, 'reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop }]);
    h.sttSockets()[1].open();
    await flush();
    for (const leg of ['speaker', 'participant'] as const) expect(h.of(leg, 'reconnected')).toHaveLength(1);
    expect(h.conformance()).toEqual({ speaker: [], participant: [] });
  });

  it("shared Both: the network's return wakes the one socket once, whichever facades hear it", async () => {
    const h = await liveBoth(true);
    h.sttSockets()[0].serverClose(1006);
    await flush();
    // Attempt 1 in flight: a wake now would make attempt 2 skip its wait; the participant's facade does not wake it.
    h.sessions.participant.networkRestored!();
    h.sttSockets()[1].drop();
    await flush();
    expect(h.sttSockets()).toHaveLength(2);
    // Waiting: the speaker's facade wakes it.
    h.sessions.speaker.networkRestored!();
    expect(h.sttSockets()).toHaveLength(3);
  });

  it('shared Both: a failure fails the speaker first, then the participant', async () => {
    const h = await liveBoth(true);
    h.sttSockets()[0].serverClose(1008, 'Policy violation');
    await flush();
    expect(h.all.filter((e) => e.kind === 'failed').map((e) => e.leg)).toEqual(['speaker', 'participant']);
    for (const leg of ['speaker', 'participant'] as const) {
      expect(h.of(leg, 'failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: expect.any(String), drop: { cause: 'close', closeCode: 1008, retryable: false, managed: false } }]);
    }
    expect(h.timers()).toBe(0);
    expect(h.conformance()).toEqual({ speaker: [], participant: [] });
  });
});
