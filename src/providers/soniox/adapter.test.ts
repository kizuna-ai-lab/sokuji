/**
 * Soniox's adapter for one leg (`SonioxCore`, `start`): the conformance
 * suite but typed text, the STT config frame, a 503's reconnect and every
 * other failure path (choice 8; the reconnect itself in
 * `adapter.reconnect.test.ts`), manual turns
 * (ruling 5), the keepalive, unreadable frames (choice 7), stop, and Plan
 * B's session seams. The adapter transcribes and translates and never
 * speaks: a session's speech is in `composite.test.ts`. Driven on
 * `FakeSocket` and a virtual clock from the first run — no network, no fake
 * timers, no stubbed global.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SharedSettings } from '../../lib/provider/types';
import { AdapterStartError, type SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { RECONNECT_DELAYS_MS } from '../../lib/session/reconnect';
import { createSonioxAdapter, sttFailureCode } from './adapter';
import { buildSoniox, type SonioxConfig } from './config';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxReissue, type SonioxSettings } from './settings';
import { AUTO_CTX, END, ERROR_503, FIN, isStt, KEY, msg, orig, SHARED, tr, trackedClock, type Json } from './testing';

function started(o: { context?: SessionContext; settings?: Partial<SonioxSettings>; credentials?: SonioxCredentials; shared?: SharedSettings } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const starting = createSonioxAdapter({ openSocket: sockets.create }).start(
    { context, config: buildSoniox(context, { ...SONIOX_DEFAULTS, ...o.settings }, o.shared ?? SHARED), credentials: o.credentials ?? KEY, clock, signal: controller.signal },
    events,
  );
  const stt = () => sockets.all.filter(isStt).slice(-1)[0];
  const openAll = () => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type);
  const sttSockets = () => sockets.all.filter(isStt);
  return { sockets, clock, timers, log, controller, starting, stt, openAll, of, frames, sttSockets };
}

async function live(o?: Parameters<typeof started>[0]) {
  const h = started(o);
  h.openAll();
  const session = await h.starting;
  return { ...h, session };
}

/** The server's 503 and the close that follows it on the dropped socket, then the reconnect's first attempt, opened. */
async function reconnectOnce(h: Awaited<ReturnType<typeof live>>) {
  const dropped = h.stt();
  dropped.receive(ERROR_503);
  dropped.serverClose(1011);
  await flush();
  h.openAll();
  await flush();
}

/** A drop no attempt follows: the leg fails at once (spec 2026-11-05 reconnect §4.1). */
const ended = (drop: Record<string, unknown>) => ({ ...drop, retryable: false, managed: false });

describe('the Soniox adapter: agent text (spec 2026-11-05 §4.3)', () => {
  it('a reconnected socket asks again (Review Focus 5)', async () => {
    const h = await live({ shared: { ...SHARED, speaks: true } });
    await reconnectOnce(h);
    expect(h.sttSockets().map((s) => s.sentJson<Json>()[0].enable_agent_text_input)).toEqual([true, true]);
  });
});

describe('the Soniox adapter: conformance', () => {
  let sockets = fakeSockets();
  const stt = () => sockets.all.filter(isStt).slice(-1)[0];
  const openAll = () => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
  const harness: AdapterHarness<SonioxConfig, SonioxCredentials> = {
    adapter: createSonioxAdapter({ openSocket: (url) => sockets.create(url) }),
    config: (context) => { sockets = fakeSockets(); return buildSoniox(context, SONIOX_DEFAULTS, SHARED); },
    credentials: KEY,
    opening: () => [{ run: openAll }, { flush: true }],
    // The text alone: the adapter never speaks, whatever the scenario's context says.
    exchange: [{ run: () => stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END)) }],
    // A close the table ends (spec 2026-11-05 reconnect §4.1): a 1011 would reconnect.
    serverClose: [{ run: () => stt().serverClose(1008, 'policy violation') }, { flush: true }],
    refuse: [{ run: () => stt().drop() }],
    // The 503 drops the socket at once; the attempt's socket is the newest.
    reconnect: [
      { run: () => stt().receive(ERROR_503) },
      { flush: true },
      { run: openAll },
      { flush: true },
    ],
  };

  describe('passes every conformance scenario but typed text', () => {
    it('runs all of them but text', () => {
      expect(scenarioNames(harness)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close', 'reconnect']);
    });

    it.each(scenarioNames(harness))('%s', async (name) => {
      const report = await runScenario(harness, name);
      expect(report.violations).toEqual([]);
      expect(report.problems).toEqual([]);
    });
  });
});

describe('the Soniox adapter: one leg', () => {
  it("asks the participant's own socket for diarization, and never the speaker's", async () => {
    const participant = await live({ shared: { ...SHARED, reversed: () => true } });
    expect(participant.stt().sentJson<Json>()[0]).toMatchObject({ enable_speaker_diarization: true });
    const speaker = await live();
    expect(speaker.stt().sentJson<Json>()[0]).not.toHaveProperty('enable_speaker_diarization');
  });

  it("asks the participant's own socket for no diarization when speaker labels are off, and its segments carry no person", async () => {
    const h = await live({ settings: { speakerLabels: false }, shared: { ...SHARED, reversed: () => true } });
    expect(h.stt().sentJson<Json>()[0]).not.toHaveProperty('enable_speaker_diarization');
    h.stt().receive(msg({ ...orig('Hello.'), speaker: '1' }, tr('こんにちは。'), END));
    expect(h.of('segmentOpened').length).toBeGreaterThan(0);
    for (const e of [...h.of('segmentOpened'), ...h.of('segmentText')]) expect(e.payload).not.toHaveProperty('person');
  });

  it("sends the leg's direction: one_way to the target, both languages as hints (the source first), the context and the knobs; no diarization, no client reference", async () => {
    const { stt } = await live({ settings: { endpointMaxDelayMs: 3000 }, shared: { ...SHARED, words: { entries: [{ written: 'Sokuji' }], background: '' } } });
    const config = stt().sentJson<Json>()[0];
    expect(stt().protocols).toEqual(['soniox-api-key', 'test-key']);
    expect(config).not.toHaveProperty('api_key');
    expect(config).toMatchObject({
      model: 'stt-rt-v6',
      audio_format: 'pcm_s16le',
      sample_rate: 24000,
      translation: { type: 'one_way', target_language: 'ja' },
      language_hints: ['en', 'ja'],
      context: { terms: ['Sokuji'] },
      max_endpoint_delay_ms: 3000,
    });
    expect(config).not.toHaveProperty('enable_speaker_diarization');
    expect(config).not.toHaveProperty('client_reference_id');
  });

  it('sends no hint for an auto source', async () => {
    const { stt } = await live({ context: { ...AUTO_CTX, direction: { source: 'auto', target: 'ja' } } });
    expect(stt().sentJson<Json>()[0]).not.toHaveProperty('language_hints');
  });

  it('sends one hint when both languages go out as the same wire code', async () => {
    const { stt } = await live({ context: { ...AUTO_CTX, direction: { source: 'en', target: 'en' } } });
    expect(stt().sentJson<Json>()[0]).toMatchObject({ language_hints: ['en'] });
  });

  it("opens its socket at the key's region", async () => {
    const { stt } = await live({ credentials: { region: 'jp', stt: 'k', tts: 'k' } });
    expect(stt().url).toBe('wss://stt-rt.jp.soniox.com/transcribe-websocket');
  });

  it("tells the run the region it dialled: the key's, which for a managed session is the grant's", async () => {
    const { session } = await live({ credentials: { region: 'jp', stt: 'k', tts: 'k' } });
    expect(session.info.region).toBe('jp');
  });

  it('never speaks: no TTS socket, no audio and no word of a speech key, whether the leg speaks or not and whatever keys it holds', async () => {
    for (const context of [AUTO_CTX, { ...AUTO_CTX, speech: false }]) {
      for (const credentials of [KEY, { region: 'us', stt: 'k' }] as SonioxCredentials[]) {
        const { sockets, session, stt, log } = await live({ context, credentials });
        stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
        await flush();
        expect(sockets.all).toHaveLength(1);
        expect(sockets.all.every(isStt)).toBe(true);
        expect(log.filter((e) => e.kind === 'audio' || e.kind === 'speechRanges' || e.kind === 'degraded')).toEqual([]);
        // The switch is the voice's: the text unit's session has none.
        expect(session.setSpeech).toBeUndefined();
        await session.stop();
      }
    }
  });

  it("a bad key: the start resolves, then its error frame fails the leg with auth, in the server's words, once", async () => {
    const { stt, of, log } = await live();
    stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
    expect(of('failed')).toEqual([{ kind: 'failed', payload: { code: 'auth', message: '[Soniox 401] Invalid API key', drop: ended({ cause: 'error', errorCode: '401' }) } }]);
    // The failure closed the socket itself; the close event that follows says nothing more.
    expect(stt().closedByClient).not.toBeNull();
    await flush();
    expect(of('failed')).toHaveLength(1);
    expect(log[log.length - 1].kind).toBe('failed');
  });

  it('a failure sends no end of the stream: only a stop says goodbye, not a session the server refused (Stage 2 session end, choice 8)', async () => {
    const { stt, log } = await live();
    const socket = stt();
    socket.receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
    expect(socket.closedByClient).not.toBeNull();
    expect(socket.sent).not.toContain('');
    expect(log.filter((e) => e.kind === 'frame' && e.payload.type === 'stt.end')).toEqual([]);
  });

  it("words every other STT error by its type, keeping the server's words, and ends the leg without an attempt", async () => {
    // A 5xx reconnects instead (spec 2026-11-05 reconnect §4.1), and so does a 429 unless it says a quota is used up; a code that is no number still ends, as `server`.
    const cases: Array<[number | string, string, string]> = [[429, 'rate_limit', 'quota exceeded'], [400, 'client', 'said 400'], ['boom', 'server', 'said boom']];
    for (const [code, type, words] of cases) {
      const { stt, of, frames, sttSockets } = await live();
      stt().receive(JSON.stringify({ error_code: code, error_message: words }));
      expect(of('failed')).toEqual([{ kind: 'failed', payload: { code: type, message: `[Soniox ${code}] ${words}`, drop: ended({ cause: 'error', errorCode: String(code) }) } }]);
      // The server's own words in the Logs (choice 16).
      expect(frames('stt.error').map((e) => e.payload.payload)).toEqual([{ code: String(code), message: words }]);
      expect(of('reconnecting')).toEqual([]);
      expect(sttSockets()).toHaveLength(1);
      expect(sttFailureCode(String(code))).toBe(type);
    }
    expect(sttFailureCode('401')).toBe('auth');
    expect(sttFailureCode('403')).toBe('auth');
    expect(sttFailureCode('500')).toBe('server');
  });

  it('a close the table ends fails with connection_lost once, its code and words in the Logs before it', async () => {
    // The Logs row keeps the old client's `{ code, message }`: the wire's code and the server's words (choice 16, `surfaceRecoverableOutage`).
    const cases: Array<[number, string, Json]> = [
      [1008, 'Policy violation', { code: '1008', message: 'Policy violation' }],
      [4000, '', { code: '4000', message: 'The Soniox connection closed unexpectedly' }],
    ];
    for (const [code, reason, row] of cases) {
      const { stt, of, log, frames } = await live();
      stt().serverClose(code, reason);
      await flush();
      const failed = of('failed');
      expect(failed).toEqual([{ kind: 'failed', payload: { code: 'connection_lost', message: expect.any(String), drop: ended({ cause: 'close', closeCode: code }) } }]);
      const lostAt = log.findIndex((e) => e.kind === 'frame' && e.payload.type === 'session.connection_lost');
      expect(lostAt).toBeGreaterThanOrEqual(0);
      expect(lostAt).toBeLessThan(log.indexOf(failed[0]));
      expect(frames('session.connection_lost').map((e) => e.payload.payload)).toEqual([row]);
      expect(of('reconnecting')).toEqual([]);
    }
  });

  it('a 503 reconnects on the shared schedule — at once, after 250 ms, after 500 ms more — reconnecting, then reconnected', async () => {
    expect(RECONNECT_DELAYS_MS.slice(0, 3)).toEqual([0, 250, 500]);
    const { stt, sttSockets, clock, log, openAll, of, frames } = await live();
    const first = stt();
    first.receive(msg(orig('Half', false), tr('半')));
    first.receive(ERROR_503);
    // The close that follows the 503 reaches nothing: the socket was already dropped.
    first.serverClose(1011);
    await flush();
    const at = log.findIndex((e) => e.kind === 'reconnecting');
    expect(at).toBeGreaterThanOrEqual(0);
    // The utterance closed as it stands, at the drop.
    expect(log.slice(0, at).flatMap((e) => (e.kind === 'segmentClosed' ? [e.payload.ref] : []))).toEqual([1, 2]);
    expect(sttSockets()).toHaveLength(2);

    stt().drop();
    await flush();
    clock.advance(249);
    await flush();
    expect(sttSockets()).toHaveLength(2);
    clock.advance(1);
    await flush();
    expect(sttSockets()).toHaveLength(3);

    stt().drop();
    await flush();
    clock.advance(499);
    await flush();
    expect(sttSockets()).toHaveLength(3);
    clock.advance(1);
    await flush();
    expect(sttSockets()).toHaveLength(4);

    openAll();
    await flush();
    expect(of('reconnected')).toHaveLength(1);
    expect(log.findIndex((e) => e.kind === 'reconnected')).toBeGreaterThan(at);
    expect(stt().sentJson()[0]).toEqual(first.sentJson()[0]);
    expect(of('failed')).toEqual([]);
    expect(of('degraded')).toEqual([]);
    expect(frames('stt.error').map((e) => e.payload.payload)).toEqual([{ code: '503', message: 'Service unavailable' }]);
    expect(frames('session.reconnecting').map((e) => e.payload.payload)).toEqual([{ cause: 'error', code: '503' }]);
    expect(frames('session.reconnect_failed')).toHaveLength(2);
    expect(frames('session.reconnected')).toHaveLength(1);
  });

  it('never reuses a ref across a reconnect', async () => {
    const h = await live();
    h.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    await reconnectOnce(h);
    expect(h.of('reconnected')).toHaveLength(1);
    h.stt().receive(msg(orig('Again.'), tr('また。'), END));
    expect(h.of('segmentOpened').map((e) => e.payload.ref)).toEqual([1, 2, 3, 4]);
  });

  it('a stop during a reconnect backoff leaves nothing behind: no attempt, no timer, no event', async () => {
    const { session, stt, sttSockets, clock, log, timers, frames } = await live();
    stt().receive(ERROR_503);
    await flush();
    // The first attempt fails: the reconnector now waits 250 ms for the second.
    stt().drop();
    await flush();
    expect(frames('session.reconnect_failed')).toHaveLength(1);
    const n = log.length;
    const count = sttSockets().length;
    await session.stop();
    await flush();
    expect(timers()).toBe(0);
    clock.advance(60_000);
    await flush();
    expect(sttSockets()).toHaveLength(count);
    expect(log.length).toBe(n);
  });

  it("a stop while a reconnect attempt's connect is in flight closes that socket, and nothing follows", async () => {
    const { session, stt, sttSockets, clock, log, timers } = await live();
    stt().receive(ERROR_503);
    await flush();
    const attempt = stt();
    expect(attempt.readyState).toBe(FakeSocket.CONNECTING);
    const n = log.length;
    const stopping = session.stop();
    expect(attempt.closedByClient).not.toBeNull();
    await stopping;
    await flush();
    expect(timers()).toBe(0);
    clock.advance(60_000);
    await flush();
    expect(sttSockets()).toHaveLength(2);
    expect(log.length).toBe(n);
  });

  it('endTurn sends finalize; <fin> closes the source at once and holds the translation for its late words (ruling 5)', async () => {
    const { session, stt, clock, of, frames } = await live({ context: { ...AUTO_CTX, turns: 'manual' } });
    const refs = (kind: 'segmentOpened' | 'segmentClosed') => of(kind).map((e) => e.payload.ref);
    session.endTurn();
    expect(stt().sentJson().slice(-1)[0]).toEqual({ type: 'finalize' });
    expect(frames('stt.finalize')).toHaveLength(1);
    expect(frames('stt.finalize')[0].payload.direction).toBe('out');

    stt().receive(msg(orig('Hi.'), FIN));
    expect(refs('segmentClosed')).toEqual([1]);
    expect(refs('segmentOpened')).toEqual([1]);

    stt().receive(msg(tr('やあ。')));
    expect(refs('segmentOpened')).toEqual([1, 2]);
    expect(of('segmentText').filter((e) => e.payload.ref === 2).map((e) => e.payload.text)).toEqual(['やあ。']);
    clock.advance(1_999);
    expect(refs('segmentClosed')).toEqual([1]);
    clock.advance(1);
    expect(refs('segmentClosed')).toEqual([1, 2]);
  });

  it('the keepalive covers the silence between presses', async () => {
    const { stt, clock } = await live({ context: { ...AUTO_CTX, turns: 'manual' } });
    expect(stt().sentJson()).not.toContainEqual({ type: 'keepalive' });
    clock.advance(15_000);
    expect(stt().sentJson()).toContainEqual({ type: 'keepalive' });
  });

  it('an unreadable STT frame goes to the Logs only, once per episode (choice 7)', async () => {
    const { stt, of, frames } = await live();
    stt().receive('{bad');
    stt().receive('{bad');
    expect(frames('stt.unreadable')).toHaveLength(1);
    expect(frames('stt.unreadable')[0].payload).toMatchObject({ direction: 'in', type: 'stt.unreadable', payload: { message: expect.any(String) } });
    expect(of('degraded')).toEqual([]);
    expect(of('failed')).toEqual([]);
    stt().receive(msg(orig('Hi', false)));
    stt().receive('{bad');
    expect(frames('stt.unreadable')).toHaveLength(2);
    expect(of('degraded')).toEqual([]);
    expect(of('failed')).toEqual([]);
  });

  it("a reconnect's STT socket starts its own unreadable episode", async () => {
    const h = await live();
    h.stt().receive('{bad');
    expect(h.frames('stt.unreadable')).toHaveLength(1);
    // The old socket's episode never ended; the new socket's first bad frame is a new one.
    await reconnectOnce(h);
    expect(h.of('reconnected')).toHaveLength(1);
    h.stt().receive('{bad');
    expect(h.frames('stt.unreadable')).toHaveLength(2);
  });

  it('stop ends the stream, framed, and closes the socket before its first await, and nothing follows (Stage 2 session end, ruling 2 (ii))', async () => {
    const { session, stt, log, clock, timers } = await live();
    const n = log.length;
    const stopping = session.stop();
    expect(stt().closedByClient).not.toBeNull();
    // The end of the stream: an empty text frame, and its Logs line.
    expect(stt().sent[stt().sent.length - 1]).toBe('');
    expect(log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'stt.end' } }]);
    // The keepalive stopped with its socket.
    expect(timers()).toBe(0);
    await stopping;
    clock.advance(60_000);
    await flush();
    expect(log.length).toBe(n + 1);
  });

  it('a stop after the session failed sends and frames no end: its socket is gone', async () => {
    const { session, stt, log } = await live();
    stt().serverClose(1008, 'policy violation');
    await flush();
    const n = log.length;
    await session.stop();
    expect(log.length).toBe(n);
  });

  it('a start its signal aborts opens nothing and closes its socket', async () => {
    const { controller, starting, stt, log } = started();
    controller.abort(new Error('cancelled'));
    await expect(starting).rejects.toThrow(/cancelled/);
    expect(stt().closedByClient).not.toBeNull();
    await flush();
    expect(log).toEqual([]);
  });

  it('a refused STT socket fails the start with network, and says nothing', async () => {
    const { starting, stt, log } = started();
    stt().drop();
    const error = await starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect((error as AdapterStartError).code).toBe('network');
    await flush();
    expect(log).toEqual([]);
  });

  it('a start whose STT connect times out tries once more with the same key, and starts when that one opens', async () => {
    const h = started();
    h.clock.advance(15_000);
    await flush();
    expect(h.sttSockets()).toHaveLength(2);
    const [first, second] = h.sttSockets();
    expect(first.closedByClient).not.toBeNull();
    expect(second.protocols).toEqual(first.protocols);
    expect(h.frames('session.stt_connect_retry')).toHaveLength(1);
    second.open();
    await expect(h.starting).resolves.toBeDefined();
  });

  it('a second timeout fails the start with network, and tries no third time', async () => {
    const h = started();
    h.clock.advance(15_000);
    await flush();
    h.clock.advance(15_000);
    const error = await h.starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect((error as AdapterStartError).code).toBe('network');
    h.clock.advance(60_000);
    await flush();
    expect(h.sttSockets()).toHaveLength(2);
    expect(h.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
  });

  it('a refused STT socket is not tried again: the server answered', async () => {
    const h = started();
    h.stt().drop();
    await h.starting.then(() => null, () => null);
    h.clock.advance(60_000);
    await flush();
    expect(h.sttSockets()).toHaveLength(1);
  });

  it('a cancel while the second try connects ends the start and closes it', async () => {
    const h = started();
    h.clock.advance(15_000);
    await flush();
    h.controller.abort(new Error('cancelled'));
    await expect(h.starting).rejects.toThrow(/cancelled/);
    expect(h.sttSockets()[1].closedByClient).not.toBeNull();
    h.clock.advance(60_000);
    await flush();
    expect(h.sttSockets()).toHaveLength(2);
  });

  describe('the start resolves once the STT socket is open: a failing start only ever rejects', () => {
    /** Opens the STT socket. Resolves with where the log stood when the start resolved, or -1 when it still waits. */
    async function sttOpened(h: ReturnType<typeof started>): Promise<number> {
      let resolvedAt = -1;
      void h.starting.then(() => { resolvedAt = h.log.length; }, () => {});
      h.stt().open();
      await flush();
      return resolvedAt;
    }

    it("a bad key's error frame fails the leg after the start resolved, once", async () => {
      const h = started();
      const resolvedAt = await sttOpened(h);
      expect(resolvedAt).toBeGreaterThanOrEqual(0);
      // Before the resolve: the start's own frame, and nothing else.
      expect(h.log.slice(0, resolvedAt).map((e) => (e.kind === 'frame' ? e.payload.type : e.kind))).toEqual(['session.opened']);
      h.stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
      // The failure closed the STT socket itself; the close event that follows says nothing more.
      expect(h.stt().closedByClient).not.toBeNull();
      await flush();
      expect(h.of('failed')).toEqual([{ kind: 'failed', payload: { code: 'auth', message: '[Soniox 401] Invalid API key', drop: ended({ cause: 'error', errorCode: '401' }) } }]);
      expect(h.log.indexOf(h.of('failed')[0])).toBeGreaterThanOrEqual(resolvedAt);
      expect(h.timers()).toBe(0);
    });

    it('a 503 right after the start resolved reconnects', async () => {
      const h = started();
      const resolvedAt = await sttOpened(h);
      expect(resolvedAt).toBeGreaterThanOrEqual(0);
      h.stt().receive(ERROR_503);
      await flush();
      expect(h.log.findIndex((e) => e.kind === 'reconnecting')).toBeGreaterThanOrEqual(resolvedAt);
      h.openAll();
      await flush();
      expect(h.of('reconnected')).toHaveLength(1);
      expect(h.of('failed')).toEqual([]);
    });
  });

  it('opens with session.opened, the region and the translation and nothing else, and no frame carries the key', async () => {
    const { stt, of } = await live();
    expect(of('frame')[0].payload).toEqual({
      direction: 'out',
      type: 'session.opened',
      payload: { region: 'us', translation: { type: 'one_way', target_language: 'ja' } },
    });
    stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(of('frame').length).toBeGreaterThan(1);
    expect(JSON.stringify(of('frame'))).not.toContain('test-key');
  });
});

describe("the Soniox adapter: Plan B's session seams", () => {
  it("tells a lease the first frame of each socket: a 503 reconnects on a reissued key, whose socket's first frame it tells again", async () => {
    const reissued: SonioxReissue = { ok: true, stt: 'key-1', clientReferenceId: 'ref-1', expiresAt: 10_000 };
    const lease = { streamAccepted: vi.fn(), streamEnded: vi.fn(), atGrantEnd: vi.fn(() => false), cutoff: vi.fn(), reissue: vi.fn(async () => reissued) };
    const h = await live({ credentials: { ...KEY, lease } });
    expect(lease.streamAccepted).not.toHaveBeenCalled();
    h.stt().receive(msg(orig('Hi', false)));
    h.stt().receive(msg(orig('Hi there', false)));
    expect(lease.streamAccepted).toHaveBeenCalledTimes(1);
    h.stt().receive(ERROR_503);
    await flush();
    expect(lease.reissue).toHaveBeenCalledTimes(1);
    expect(h.stt().protocols).toEqual(['soniox-api-key', 'key-1']);
    h.openAll();
    await flush();
    expect(h.of('reconnected')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
    expect(lease.streamAccepted).toHaveBeenCalledTimes(1);
    h.stt().receive(msg(orig('Again', false)));
    h.stt().receive(msg(orig('Again and', false)));
    expect(lease.streamAccepted).toHaveBeenCalledTimes(2);
  });

  it('an error frame first never tells the lease a stream was accepted', async () => {
    const lease = { streamAccepted: vi.fn(), streamEnded: vi.fn(), atGrantEnd: vi.fn(() => false), cutoff: vi.fn(), reissue: vi.fn() };
    const { stt, of } = await live({ credentials: { ...KEY, lease } });
    stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
    expect(lease.streamAccepted).not.toHaveBeenCalled();
    expect(of('failed')).toHaveLength(1);
    expect(of('failed')[0].payload.code).toBe('auth');
  });

  it("a 403 at the grant's end closes the leg without a failure, after the lease's cutoff", async () => {
    let closedAtCutoff = -1;
    const lease = { streamAccepted: vi.fn(), streamEnded: vi.fn(), atGrantEnd: vi.fn(() => true), cutoff: vi.fn(() => { closedAtCutoff = h.of('closed').length; }), reissue: vi.fn() };
    const h = await live({ credentials: { ...KEY, lease } });
    h.stt().receive(JSON.stringify({ error_code: 403, error_message: 'Session duration exceeded' }));
    expect(lease.atGrantEnd).toHaveBeenCalledWith(0);
    h.stt().serverClose(1000);
    await flush();
    expect(lease.cutoff).toHaveBeenCalledTimes(1);
    expect(closedAtCutoff).toBe(0);
    expect(h.of('closed')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
  });

  it("a 403 before the grant's end is an auth failure", async () => {
    const lease = { streamAccepted: vi.fn(), streamEnded: vi.fn(), atGrantEnd: () => false, cutoff: vi.fn(), reissue: vi.fn() };
    const { stt, of } = await live({ credentials: { ...KEY, lease } });
    stt().receive(JSON.stringify({ error_code: 403, error_message: 'Forbidden' }));
    expect(of('failed')).toEqual([{ kind: 'failed', payload: { code: 'auth', message: '[Soniox 403] Forbidden', drop: { cause: 'error', errorCode: '403', retryable: false, managed: true } } }]);
    expect(lease.cutoff).not.toHaveBeenCalled();
  });

  it('a client reference rides in the config frame when the credentials carry one', async () => {
    const { stt } = await live({ credentials: { ...KEY, clientReferenceId: 'ref-1' } });
    expect(stt().sentJson<Json>()[0]).toMatchObject({ client_reference_id: 'ref-1' });
  });
});

describe('language codes (unified language codes)', () => {
  it("sends Filipino to Soniox as tl and reads Soniox's tl back as fil", async () => {
    const { stt, of } = await live({ context: { ...AUTO_CTX, direction: { source: 'en', target: 'fil' } } });
    expect(stt().sentJson<Json>()[0]).toMatchObject({ translation: { type: 'one_way', target_language: 'tl' }, language_hints: ['en', 'tl'] });
    stt().receive(msg(orig('Hello.'), tr('Kumusta.', 'tl'), END));
    const languages = of('segmentText').map((e) => e.payload.language);
    expect(languages).toContain('fil');
    expect(languages).not.toContain('tl');
  });

  it('drops a language Soniox reports outside the table', async () => {
    const { stt, of } = await live();
    stt().receive(msg({ ...orig('Hello.'), language: 'xx' }, END));
    expect(of('segmentText').length).toBeGreaterThan(0);
    for (const e of of('segmentText')) expect(e.payload).not.toHaveProperty('language');
  });

  it("labels each segment with its person, and a reconnect's socket starts a new epoch", async () => {
    const h = await live({ shared: { ...SHARED, reversed: () => true } });
    h.stt().receive(msg({ ...orig('Hello.'), speaker: '1' }, tr('こんにちは。'), END));
    await reconnectOnce(h);
    h.stt().receive(msg({ ...orig('Again.'), speaker: '1' }, tr('また。'), END));
    expect(h.of('segmentOpened').map((e) => e.payload.person)).toEqual(['1.1', '1.1', '2.1', '2.1']);
  });
});
