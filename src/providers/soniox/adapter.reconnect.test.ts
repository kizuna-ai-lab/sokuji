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
import { FLAP_WINDOW_MS, MAX_RECONNECTS, type DropInfo } from '../../lib/session/reconnect';
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
    streamEnded: vi.fn(),
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
  it('any 5xx, a 408 and a socket error reconnect; 401, 402, 403, another 4xx and an unknown code end', () => {
    for (const error of ['500', '502', '503', '504', '408', 'socket_error']) expect(sonioxDropAction({ error, atGrantEnd: false })).toBe('reconnect');
    for (const error of ['401', '402', '403', '400', '404', '600', 'boom']) expect(sonioxDropAction({ error, atGrantEnd: false })).toBe('end');
  });

  it('a 429 reconnects, unless its words say a quota or balance is used up', () => {
    const measured = 'Concurrent requests limit for real-time transcription has been exceeded for your project.';
    expect(sonioxDropAction({ error: '429', message: measured, atGrantEnd: false })).toBe('reconnect');
    expect(sonioxDropAction({ error: '429', atGrantEnd: false })).toBe('reconnect');
    expect(sonioxDropAction({ error: '429', message: '', atGrantEnd: false })).toBe('reconnect');
    for (const message of ['quota exceeded', 'Insufficient balance', 'Billing limit reached', 'payment required', 'Out of CREDIT']) {
      expect(sonioxDropAction({ error: '429', message, atGrantEnd: false })).toBe('end');
    }
    // Only a 429's words are read.
    expect(sonioxDropAction({ error: '400', message: 'rate limited', atGrantEnd: false })).toBe('end');
    expect(sonioxDropAction({ error: '503', message: 'quota exceeded', atGrantEnd: false })).toBe('reconnect');
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

  it("an attempt's socket that opens and closes in the same tick fails that attempt: a second reconnecting, then reconnected once the next opens", async () => {
    const h = await live();
    h.stt().serverClose(1006);
    await flush();
    // It opens, and its 1006 lands before the attempt's answer is read.
    const flapped = h.stt();
    flapped.open();
    flapped.serverClose(1006);
    await flush();
    expect(h.of('reconnected')).toEqual([]);
    expect(h.frames('session.reconnect_failed')).toHaveLength(1);
    h.clock.advance(250);
    await flush();
    expect(h.sttSockets()).toHaveLength(3);
    expect(h.of('reconnecting').map((e) => e.payload!.attempt)).toEqual([1, 2]);
    await openAttempt(h);
    expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 2, credentialsReissued: false, reissueMs: 0, budgetShared: false }]);
    expect(h.of('failed')).toEqual([]);
    // Live on the new socket.
    h.session.appendAudio(voicedPcm(100));
    expect(binary(h.stt())).toHaveLength(1);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('a 500, a 502, a 504, a 408 and a socket error reconnect at once, the server\'s words in the Logs', async () => {
    const error = (code: number, message: string) => (s: FakeSocket) => s.receive(JSON.stringify({ error_code: code, error_message: message }));
    const acts: Array<[(s: FakeSocket) => void, Omit<DropInfo, 'retryable' | 'managed'>]> = [
      [error(500, 'Internal error'), { cause: 'error', errorCode: '500' }],
      [error(502, 'Bad gateway'), { cause: 'error', errorCode: '502' }],
      [error(504, 'Gateway timeout'), { cause: 'error', errorCode: '504' }],
      [error(408, 'Request timeout'), { cause: 'error', errorCode: '408' }],
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
    // The leg's words are the last attempt's; the verdict's reason rides only in `giveUp`.
    expect(h.of('failed')).toEqual([{
      kind: 'failed',
      payload: {
        code: 'connection_lost',
        message: 'Soniox STT connection failed',
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

  it('a live 429 with the measured concurrency words reconnects; a 429 saying the quota is used up ends with rate_limit', async () => {
    const h = await live();
    const first = h.stt();
    first.receive(JSON.stringify({ error_code: 429, error_message: 'Concurrent requests limit for real-time transcription has been exceeded for your project.' }));
    expect(first.closedByClient).not.toBeNull();
    expect(h.sttSockets()).toHaveLength(2);
    await openAttempt(h);
    expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf({ cause: 'error', errorCode: '429' }) }]);
    expect(h.of('reconnected')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);

    const q = await live();
    q.stt().receive(JSON.stringify({ error_code: 429, error_message: 'Organization quota exceeded' }));
    await flush();
    expect(q.of('failed')).toEqual([{ kind: 'failed', payload: { code: 'rate_limit', message: '[Soniox 429] Organization quota exceeded', drop: { cause: 'error', errorCode: '429', retryable: false, managed: false } } }]);
    expect(q.of('reconnecting')).toEqual([]);
    expect(q.sttSockets()).toHaveLength(1);
  });

  it('401, a quota 429 and a non-retryable close end at once with their code and drop.retryable false', async () => {
    const cases: Array<[(s: FakeSocket) => void, string, Omit<DropInfo, 'retryable' | 'managed'>]> = [
      [(s) => s.receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' })), 'auth', { cause: 'error', errorCode: '401' }],
      [(s) => s.receive(JSON.stringify({ error_code: 402, error_message: 'Payment required' })), 'client', { cause: 'error', errorCode: '402' }],
      [(s) => s.receive(JSON.stringify({ error_code: 429, error_message: 'Quota exceeded' })), 'rate_limit', { cause: 'error', errorCode: '429' }],
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
    // Each drop past the flapping window of the reconnect before it: no flap, so neither the ladder nor the per-minute limit applies.
    for (let i = 0; i < MAX_RECONNECTS; i++) {
      h.clock.advance(FLAP_WINDOW_MS + 1);
      h.stt().serverClose(1006);
      await flush();
      await openAttempt(h);
    }
    expect(h.of('reconnected')).toHaveLength(MAX_RECONNECTS);
    const count = h.sttSockets().length;
    h.clock.advance(FLAP_WINDOW_MS + 1);
    h.stt().serverClose(1006);
    await flush();
    expect(h.sttSockets()).toHaveLength(count);
    expect(h.of('failed')).toEqual([{
      kind: 'failed',
      // No attempt said why: plain connection-lost words, no reason token.
      payload: { code: 'connection_lost', message: 'The Soniox connection was lost.', drop: dropOf({ cause: 'close', closeCode: 1006 }), giveUp: { attempts: 0, reason: 'session_cap' } },
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

  it('tells the lease when the connection whose first frame it reported ends — at its drop, before the reissue, and at the stop — never for one that answered nothing', async () => {
    const lease = fakeLease(KEY_1, KEY_2);
    const h = await live(managed(lease));
    h.stt().receive(msg(orig('Hi', false)));
    expect(lease.port.streamEnded).not.toHaveBeenCalled();
    h.stt().serverClose(1006);
    await flush();
    expect(lease.port.streamEnded).toHaveBeenCalledTimes(1);
    expect(lease.port.streamEnded.mock.invocationCallOrder[0]).toBeLessThan(lease.port.reissue.mock.invocationCallOrder[0]);
    await openAttempt(h);
    expect(h.of('reconnected')).toHaveLength(1);
    // Back, but dropped again before its first frame: its key was never reported, so there is nothing to tell.
    h.stt().serverClose(1006);
    await flush();
    h.clock.advance(250);
    await flush();
    await openAttempt(h);
    expect(h.of('reconnected')).toHaveLength(2);
    expect(lease.port.streamEnded).toHaveBeenCalledTimes(1);
    h.stt().receive(msg(orig('Again', false)));
    expect(lease.port.streamAccepted).toHaveBeenCalledTimes(2);
    await h.session.stop();
    expect(lease.port.streamEnded).toHaveBeenCalledTimes(2);
    expect(h.of('failed')).toEqual([]);
  });

  it('managed: a key whose socket never opened is reused by the next attempt; past its window a new one is fetched (Review Focus 4)', async () => {
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
    // Attempt 2's connect is still going when key-1's window closes, 9 s after its reissue answered: it is given up, and attempt 3 fetches key-2.
    const stalled = h.stt();
    h.clock.advance(8_749);
    await flush();
    expect(stalled.closedByClient).toBeNull();
    h.clock.advance(1);
    await flush();
    expect(stalled.closedByClient).not.toBeNull();
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

  it("managed: a reissued key opens nothing past its window, 10 s from the reissue's answer less 1 s: a connect still going then is given up, and the next attempt reissues and reconnects", async () => {
    // Answered at once, at 0: a socket that would open at 12 s is given up at 9 s.
    {
      const lease = fakeLease(KEY_1, KEY_2);
      const h = await live(managed(lease));
      h.stt().serverClose(1006);
      await flush();
      const slow = h.stt();
      expect(slow.protocols).toEqual(['soniox-api-key', 'key-1']);
      h.clock.advance(8_999);
      await flush();
      expect(slow.closedByClient).toBeNull();
      h.clock.advance(1);
      await flush();
      expect(slow.closedByClient).not.toBeNull();
      expect(h.frames('session.reconnect_failed')).toEqual([{ attempt: 1, message: "The reissued key's start window closed before its connection opened." }]);
      h.clock.advance(250);
      await flush();
      expect(lease.port.reissue).toHaveBeenCalledTimes(2);
      expect(h.stt().protocols).toEqual(['soniox-api-key', 'key-2']);
      await openAttempt(h);
      expect(h.stt().sentJson<Json>()[0]).toMatchObject({ client_reference_id: 'ref-2' });
      expect(h.of('reconnected').map((e) => e.payload)).toEqual([{ attempts: 2, credentialsReissued: true, reissueMs: 0, budgetShared: false }]);
      expect(h.of('failed')).toEqual([]);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
    // Answered 3 s after it was asked: the window counts from the answer, to 12 s.
    {
      const lease = fakeLease();
      const h = await live(managed(lease));
      h.stt().serverClose(1006);
      await flush();
      h.clock.advance(3_000);
      lease.answer(KEY_1);
      await flush();
      const slow = h.stt();
      h.clock.advance(8_999);
      await flush();
      expect(slow.closedByClient).toBeNull();
      h.clock.advance(1);
      await flush();
      expect(slow.closedByClient).not.toBeNull();
      expect(h.clock.now()).toBe(12_000);
    }
  });

  it("managed: a client clock 30 s behind the server's expiresAt does not keep a dead key: past its own window the next attempt reissues", async () => {
    // The server's clock runs 30 s ahead: its 10 s window ends, by the client's clock, at 40 s.
    const skewed: SonioxReissue = { ok: true, stt: 'key-1', clientReferenceId: 'ref-1', expiresAt: 40_000 };
    const lease = fakeLease(skewed, KEY_2);
    const h = await live(managed(lease));
    h.stt().serverClose(1006);
    await flush();
    // Attempts 1–6, at 0, 250, 750, 1750, 3750 and 7750, each fail before opening: key-1, unspent and inside its 9 s, serves them all.
    for (const delay of [0, 250, 500, 1_000, 2_000, 4_000]) {
      if (delay) h.clock.advance(delay);
      await flush();
      expect(h.stt().protocols).toEqual(['soniox-api-key', 'key-1']);
      await failAttempt(h);
    }
    expect(lease.port.reissue).toHaveBeenCalledTimes(1);
    // Attempt 7, at 11 750: past key-1's window, whatever the server's expiresAt says.
    h.clock.advance(4_000);
    await flush();
    expect(lease.port.reissue).toHaveBeenCalledTimes(2);
    expect(h.stt().protocols).toEqual(['soniox-api-key', 'key-2']);
    await openAttempt(h);
    expect(h.of('reconnected').map((e) => e.payload!.attempts)).toEqual([7]);
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
          message: 'The lease has ended.',
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
          message: refusal.message,
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

  it('a grant-end 403 and then the socket dropping ends as a lease end, with no reconnect (§4.2)', async () => {
    const acts: Array<(s: FakeSocket) => void> = [
      (s) => s.drop(),
      (s) => s.receive(ERROR_503),
    ];
    for (const act of acts) {
      const lease = fakeLease(KEY_1);
      lease.port.atGrantEnd.mockReturnValue(true);
      const h = await live(managed(lease));
      h.stt().receive(JSON.stringify({ error_code: 403, error_message: 'Session duration exceeded' }));
      act(h.stt());
      await flush();
      expect(lease.port.cutoff).toHaveBeenCalledTimes(1);
      expect(h.of('closed')).toHaveLength(1);
      expect(h.of('reconnecting')).toEqual([]);
      expect(h.of('failed')).toEqual([]);
      expect(lease.port.reissue).not.toHaveBeenCalled();
      expect(h.sttSockets()).toHaveLength(1);
      expect(h.timers()).toBe(0);
      expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
    }
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
const BOTH_CONTEXTS: Record<LegName, SessionContext> = {
  speaker: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' },
  participant: { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' },
};

/** Both legs live, split (two cores) or shared (one socket); each leg's log, and one log of both in order. */
async function liveBoth(shared: boolean, o: { participantSpeaks?: boolean } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const settings = { ...SONIOX_DEFAULTS, bothModeSharedSession: shared };
  const CONTEXTS = o.participantSpeaks ? { ...BOTH_CONTEXTS, participant: { ...BOTH_CONTEXTS.participant, speech: true } } : BOTH_CONTEXTS;
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
  /** Every TTS socket on this key, oldest first. */
  const ttsOn = (key: string) => sockets.all.filter((s) => !isStt(s) && s.protocols?.[1] === key);
  const of = <K extends AdapterEvent['kind']>(leg: LegName, kind: K) => logs[leg].filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  const conformance = () => ({ speaker: checkConformance(logs.speaker, CONTEXTS.speaker), participant: checkConformance(logs.participant, CONTEXTS.participant) });
  return { sockets, clock, timers, sessions, logs, all, sttOn, sttSockets, ttsOn, of, conformance };
}

/** The texts a TTS socket was sent to speak. */
const spokenOn = (s: FakeSocket) => s.sentJson<{ text?: string }>().map((m) => m.text).filter((t): t is string => !!t);

describe('the Soniox adapter reconnects: speech comes back', () => {
  it("a stall's reconnect lets the leg's TTS socket go, half-open as it may be: the next translation goes on a new one, and nothing is degraded", async () => {
    const h = await live();
    const tts = () => h.sockets.all.filter((x) => !isStt(x));
    const before = tts()[0];
    h.stt().receive(msg(orig('Hi.'), tr('やあ。'), END));
    expect(spokenOn(before)).toEqual(['やあ。']);
    // The blip: the server says nothing more while the leg talks, and both sockets still read as open.
    speak(h, SONIOX_STALL_MS);
    expect(h.of('reconnecting').map((e) => e.payload)).toEqual([{ attempt: 1, drop: dropOf({ cause: 'stall' }) }]);
    expect(before.readyState).toBe(FakeSocket.OPEN);
    expect(before.closedByClient).toBeNull();
    await openAttempt(h);
    expect(h.of('reconnected')).toHaveLength(1);
    expect(before.closedByClient).not.toBeNull();
    h.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(tts()).toHaveLength(2);
    tts()[1].open();
    await flush();
    expect(spokenOn(tts()[1])).toEqual(['こんにちは。']);
    expect(spokenOn(before)).toEqual(['やあ。']);
    expect(h.of('degraded')).toEqual([]);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('a leg with no TTS socket — text-only, or not speaking — opens none at the reconnect', async () => {
    for (const [credentials, context] of [[{ region: 'us', stt: 'k' }, AUTO_CTX], [KEY, { ...AUTO_CTX, speech: false }]] as const) {
      const h = await live(credentials, context);
      expect(h.sockets.all.filter((x) => !isStt(x))).toEqual([]);
      h.stt().serverClose(1006);
      await flush();
      await openAttempt(h);
      expect(h.of('reconnected')).toHaveLength(1);
      h.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
      await flush();
      expect(h.sockets.all.filter((x) => !isStt(x))).toEqual([]);
    }
  });

  it("split Both: only the reconnected leg's speech gets a new socket", async () => {
    const h = await liveBoth(false, { participantSpeaks: true });
    const [speakerTts] = h.ttsOn('k-spk');
    const [participantTts] = h.ttsOn('k-par');
    h.sttOn('k-spk').serverClose(1006);
    await flush();
    h.sttOn('k-spk').open();
    await flush();
    expect(h.of('speaker', 'reconnected')).toHaveLength(1);
    expect(speakerTts.closedByClient).not.toBeNull();
    expect(participantTts.closedByClient).toBeNull();
    h.sttOn('k-par').receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    expect(h.ttsOn('k-par')).toHaveLength(1);
    expect(spokenOn(participantTts)).toEqual(['Good morning.']);
    h.sttOn('k-spk').receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(h.ttsOn('k-spk')).toHaveLength(2);
    expect(h.of('speaker', 'degraded')).toEqual([]);
    expect(h.of('participant', 'degraded')).toEqual([]);
  });

  it("shared Both: the one socket's reconnect gives both legs' speech new sockets", async () => {
    const h = await liveBoth(true, { participantSpeaks: true });
    const [speakerTts] = h.ttsOn('k-spk');
    const [participantTts] = h.ttsOn('k-par');
    h.sttSockets()[0].serverClose(1006);
    await flush();
    h.sttSockets()[1].open();
    await flush();
    expect(h.of('speaker', 'reconnected')).toHaveLength(1);
    expect(speakerTts.closedByClient).not.toBeNull();
    expect(participantTts.closedByClient).not.toBeNull();
    h.sttSockets()[1].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    h.sttSockets()[1].receive(msg({ ...orig('Ohayō.'), language: 'ja', start_ms: 1_000, end_ms: 1_500 }, tr('Good morning.', 'en', 'ja'), END));
    expect(h.ttsOn('k-spk')).toHaveLength(2);
    expect(h.ttsOn('k-par')).toHaveLength(2);
    for (const s of [h.ttsOn('k-spk')[1], h.ttsOn('k-par')[1]]) s.open();
    await flush();
    expect(spokenOn(h.ttsOn('k-spk')[1])).toEqual(['こんにちは。']);
    expect(spokenOn(h.ttsOn('k-par')[1])).toEqual(['Good morning.']);
    expect(h.of('speaker', 'degraded')).toEqual([]);
    expect(h.of('participant', 'degraded')).toEqual([]);
  });
});

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

    // Both drop at once: two reconnectors, each on its own key and its own schedule. The speaker's drop is a flap, so its attempt 1 waits 250 ms; the participant's starts at once.
    h.sttOn('k-spk').serverClose(1006);
    h.sttOn('k-par').serverClose(1006);
    await flush();
    expect(h.sttSockets()).toHaveLength(4);
    h.sttOn('k-par').open();
    await flush();
    expect(h.of('participant', 'reconnected')).toHaveLength(1);
    expect(h.of('speaker', 'reconnected')).toHaveLength(1);
    h.clock.advance(250);
    await flush();
    expect(h.sttSockets()).toHaveLength(5);
    // The speaker's attempt 1 fails; attempt 2 carries on down its ladder, 500 ms on.
    h.sttOn('k-spk').drop();
    await flush();
    h.clock.advance(500);
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

  it("shared Both: the network's return through either facade wakes the one socket", async () => {
    const h = await liveBoth(true);
    h.sttSockets()[0].serverClose(1006);
    await flush();
    // Attempt 1 fails: waiting 250 ms, the participant's facade starts attempt 2 at once.
    h.sttSockets()[1].drop();
    await flush();
    expect(h.sttSockets()).toHaveLength(2);
    h.sessions.participant.networkRestored!();
    expect(h.sttSockets()).toHaveLength(3);
    // Attempt 2 fails: waiting 500 ms, the speaker's facade starts attempt 3 at once.
    h.sttSockets()[2].drop();
    await flush();
    expect(h.sttSockets()).toHaveLength(3);
    h.sessions.speaker.networkRestored!();
    expect(h.sttSockets()).toHaveLength(4);
    h.sttSockets()[3].open();
    await flush();
    for (const leg of ['speaker', 'participant'] as const) expect(h.of(leg, 'reconnected').map((e) => e.payload!.attempts)).toEqual([3]);
    expect(h.conformance()).toEqual({ speaker: [], participant: [] });
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
