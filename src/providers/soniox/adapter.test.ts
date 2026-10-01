/**
 * Soniox's adapter for one leg (`SonioxCore`, `start`): the conformance
 * suite but typed text, the STT config frame, the own-key 503 resume ladder
 * and every other failure path (ruling 3, choice 8), manual turns
 * (ruling 5), the keepalive, unreadable frames (choice 7), speech with its
 * filled-in ranges (ruling 2), stop, and Plan B's session seams. Driven on
 * `FakeSocket` and a virtual clock from the first run — no network, no fake
 * timers, no stubbed global.
 */
import { describe, it, expect, vi } from 'vitest';
import { AdapterStartError, type SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { createSonioxAdapter, MAX_RESUME_CYCLES, RESUME_DELAYS_MS, sttFailureCode } from './adapter';
import { buildSoniox, type SonioxConfig } from './config';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import { AUTO_CTX, b64, END, ERROR_503, FIN, isStt, KEY, msg, orig, SHARED, tr, trackedClock, type Json } from './testing';

function started(o: { context?: SessionContext; settings?: Partial<SonioxSettings>; credentials?: SonioxCredentials } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const starting = createSonioxAdapter({ openSocket: sockets.create }).start(
    { context, config: buildSoniox(context, { ...SONIOX_DEFAULTS, ...o.settings }, SHARED), credentials: o.credentials ?? KEY, clock, signal: controller.signal },
    events,
  );
  const stt = () => sockets.all.filter(isStt).slice(-1)[0];
  const tts = () => sockets.all.filter((s) => !isStt(s)).slice(-1)[0];
  const openAll = () => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type);
  const sttSockets = () => sockets.all.filter(isStt);
  return { sockets, clock, timers, log, controller, starting, stt, tts, openAll, of, frames, sttSockets };
}

async function live(o?: Parameters<typeof started>[0]) {
  const h = started(o);
  h.openAll();
  const session = await h.starting;
  return { ...h, session };
}

/** The server's 503, the close that follows it, and the resume's first attempt, opened. */
async function resumeOnce(h: Awaited<ReturnType<typeof live>>) {
  h.stt().receive(ERROR_503);
  h.stt().serverClose(1011);
  await flush();
  h.openAll();
  await flush();
}

/** The TTS stream the adapter opened last on this socket. */
const lastStream = (s: FakeSocket) => s.sentJson<{ stream_id?: string; model?: string }>().filter((m) => m.model !== undefined).map((m) => m.stream_id!).pop();

describe('the Soniox adapter: conformance', () => {
  let sockets = fakeSockets();
  const stt = () => sockets.all.filter(isStt).slice(-1)[0];
  const tts = () => sockets.all.filter((s) => !isStt(s)).slice(-1)[0] as FakeSocket | undefined;
  const openAll = () => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
  const harness: AdapterHarness<SonioxConfig, SonioxCredentials> = {
    adapter: createSonioxAdapter({ openSocket: (url) => sockets.create(url) }),
    config: (context) => { sockets = fakeSockets(); return buildSoniox(context, SONIOX_DEFAULTS, SHARED); },
    credentials: KEY,
    opening: () => [{ run: openAll }, { flush: true }],
    exchange: [
      { run: () => stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END)) },
      // Its speech, when the leg speaks: two chunks, then the segment's clean end.
      { run: () => {
        const t = tts();
        const id = t && lastStream(t);
        if (!t || !id) return;
        t.receive(JSON.stringify({ stream_id: id, audio: b64(2400) }));
        t.receive(JSON.stringify({ stream_id: id, audio: b64(1200) }));
        t.receive(JSON.stringify({ stream_id: id, terminated: true }));
      } },
    ],
    serverClose: [{ run: () => stt().serverClose(1011, 'server error') }, { flush: true }],
    refuse: [{ run: () => stt().drop() }],
    reconnect: [
      { run: () => stt().receive(ERROR_503) },
      { run: () => stt().serverClose(1011) },
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
  it("sends the leg's direction: one_way to the target, the source as the only hint, the context and the knobs; no diarization, no client reference", async () => {
    const { stt } = await live({ settings: { vocabularyTerms: 'Sokuji', endpointMaxDelayMs: 3000 } });
    const config = stt().sentJson<Json>()[0];
    expect(config).toMatchObject({
      api_key: 'test-key',
      model: 'stt-rt-v5',
      audio_format: 'pcm_s16le',
      sample_rate: 24000,
      translation: { type: 'one_way', target_language: 'ja' },
      language_hints: ['en'],
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

  it("opens both sockets at the key's region", async () => {
    const { stt, tts } = await live({ credentials: { region: 'jp', stt: 'k', tts: 'k' } });
    expect(stt().url).toBe('wss://stt-rt.jp.soniox.com/transcribe-websocket');
    expect(tts().url).toBe('wss://tts-rt.jp.soniox.com/tts-websocket');
  });

  it('opens no TTS socket for a leg that does not speak', async () => {
    const { sockets } = await live({ context: { ...AUTO_CTX, speech: false } });
    expect(sockets.all).toHaveLength(1);
  });

  it("a bad key: the start resolves, then its error frame fails the leg with auth, in the server's words, once", async () => {
    const { stt, of, log } = await live();
    stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
    expect(of('failed')).toEqual([{ kind: 'failed', payload: { code: 'auth', message: '[Soniox 401] Invalid API key' } }]);
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

  it("words every other STT error by its type, keeping the server's words", async () => {
    const cases: Array<[number | string, string]> = [[429, 'rate_limit'], [400, 'client'], [500, 'server'], ['boom', 'server']];
    for (const [code, type] of cases) {
      const { stt, of } = await live();
      stt().receive(JSON.stringify({ error_code: code, error_message: `said ${code}` }));
      expect(of('failed')).toEqual([{ kind: 'failed', payload: { code: type, message: `[Soniox ${code}] said ${code}` } }]);
      expect(sttFailureCode(String(code))).toBe(type);
    }
    expect(sttFailureCode('401')).toBe('auth');
    expect(sttFailureCode('403')).toBe('auth');
  });

  it('a 408, a socket error and a bare close each fail with connection_lost, once', async () => {
    // The Logs row keeps the old client's `{ code, message }`: the wire's code and the server's words (choice 16, `surfaceRecoverableOutage`).
    const acts: Array<[(s: FakeSocket) => void, Json]> = [
      [(s) => s.receive(JSON.stringify({ error_code: 408, error_message: 'Request timeout' })), { code: '408', message: 'Request timeout' }],
      [(s) => s.drop(), { code: 'socket_error', message: expect.any(String) }],
      [(s) => s.serverClose(1006), { code: '1006', message: 'The Soniox connection closed unexpectedly' }],
    ];
    for (const [act, row] of acts) {
      const { stt, of, log, frames } = await live();
      act(stt());
      await flush();
      const failed = of('failed');
      expect(failed).toHaveLength(1);
      expect(failed[0].payload.code).toBe('connection_lost');
      const lostAt = log.findIndex((e) => e.kind === 'frame' && e.payload.type === 'session.connection_lost');
      expect(lostAt).toBeGreaterThanOrEqual(0);
      expect(lostAt).toBeLessThan(log.indexOf(failed[0]));
      expect(frames('session.connection_lost').map((e) => e.payload.payload)).toEqual([row]);
    }
  });

  it('a 503 resumes silently on the clock — at once, after 1 s, after 3 s — reconnecting, then reconnected', async () => {
    expect(RESUME_DELAYS_MS).toEqual([0, 1_000, 3_000]);
    const { stt, sttSockets, clock, log, openAll, of, frames } = await live();
    const first = stt();
    first.receive(msg(orig('Half', false), tr('半')));
    first.receive(ERROR_503);
    first.serverClose(1011);
    await flush();
    const at = log.findIndex((e) => e.kind === 'reconnecting');
    expect(at).toBeGreaterThanOrEqual(0);
    // The utterance closed as it stands, after the leg said it reconnects.
    expect(log.slice(at).flatMap((e) => (e.kind === 'segmentClosed' ? [e.payload.ref] : []))).toEqual([1, 2]);
    expect(sttSockets()).toHaveLength(2);

    stt().drop();
    await flush();
    clock.advance(999);
    await flush();
    expect(sttSockets()).toHaveLength(2);
    clock.advance(1);
    await flush();
    expect(sttSockets()).toHaveLength(3);

    stt().drop();
    await flush();
    clock.advance(2_999);
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
    expect(frames('session.stt_503')).toHaveLength(1);
    // The close that started the resume, as the old client's row carried it (choice 16).
    expect(frames('session.stt_resuming').map((e) => e.payload.payload)).toEqual([{ code: 1011, reason: '' }]);
    expect(frames('session.stt_resume_attempt_failed')).toHaveLength(2);
    expect(frames('session.stt_resumed')).toHaveLength(1);
  });

  it("a resume whose three attempts fail ends with connection_lost and the 503's own words", async () => {
    const { stt, clock, of, frames } = await live();
    stt().receive(ERROR_503);
    stt().serverClose(1011);
    await flush();
    stt().drop();
    await flush();
    clock.advance(1_000);
    await flush();
    stt().drop();
    await flush();
    expect(of('failed')).toEqual([]);
    clock.advance(3_000);
    await flush();
    stt().drop();
    await flush();
    expect(of('failed')).toEqual([{ kind: 'failed', payload: { code: 'connection_lost', message: 'Soniox 503: Service unavailable' } }]);
    expect(of('reconnected')).toEqual([]);
    expect(frames('session.connection_lost').map((e) => e.payload.payload)).toEqual([{ code: '503', message: 'Service unavailable' }]);
  });

  it('past five resume cycles a 503 is an outage', async () => {
    expect(MAX_RESUME_CYCLES).toBe(5);
    const h = await live();
    for (let cycle = 1; cycle <= 5; cycle++) {
      await resumeOnce(h);
      expect(h.of('reconnected')).toHaveLength(cycle);
    }
    expect(h.of('failed')).toEqual([]);
    h.stt().receive(ERROR_503);
    expect(h.of('failed')).toHaveLength(1);
    expect(h.of('failed')[0].payload.code).toBe('connection_lost');
    const count = h.sockets.all.length;
    h.stt().serverClose(1011);
    await flush();
    h.clock.advance(10_000);
    await flush();
    expect(h.sockets.all).toHaveLength(count);
  });

  it('never reuses a ref across a resume', async () => {
    const h = await live();
    h.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    await resumeOnce(h);
    expect(h.of('reconnected')).toHaveLength(1);
    h.stt().receive(msg(orig('Again.'), tr('また。'), END));
    expect(h.of('segmentOpened').map((e) => e.payload.ref)).toEqual([1, 2, 3, 4]);
  });

  it('a stop during a resume backoff leaves nothing behind: no attempt, no timer, no event', async () => {
    const { session, stt, tts, sttSockets, clock, log, timers, frames } = await live();
    stt().receive(ERROR_503);
    stt().serverClose(1011);
    await flush();
    // The first attempt fails: the ladder now waits 1 s for the second.
    stt().drop();
    await flush();
    expect(frames('session.stt_resume_attempt_failed')).toHaveLength(1);
    const n = log.length;
    const count = sttSockets().length;
    await session.stop();
    expect(tts().closedByClient).not.toBeNull();
    await flush();
    expect(timers()).toBe(0);
    clock.advance(10_000);
    await flush();
    expect(sttSockets()).toHaveLength(count);
    expect(log.length).toBe(n);
  });

  it("a stop while a resume attempt's connect is in flight closes that socket, and nothing follows", async () => {
    const { session, stt, tts, sttSockets, clock, log, timers } = await live();
    stt().receive(ERROR_503);
    stt().serverClose(1011);
    await flush();
    const attempt = stt();
    expect(attempt.readyState).toBe(FakeSocket.CONNECTING);
    const n = log.length;
    const stopping = session.stop();
    expect(attempt.closedByClient).not.toBeNull();
    expect(tts().closedByClient).not.toBeNull();
    await stopping;
    await flush();
    expect(timers()).toBe(0);
    clock.advance(10_000);
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

  it('a resumed STT socket starts its own unreadable episode', async () => {
    const h = await live();
    h.stt().receive('{bad');
    expect(h.frames('stt.unreadable')).toHaveLength(1);
    // The old socket's episode never ended; the resumed socket's first bad frame is a new one.
    await resumeOnce(h);
    expect(h.of('reconnected')).toHaveLength(1);
    h.stt().receive('{bad');
    expect(h.frames('stt.unreadable')).toHaveLength(2);
  });

  it('speaks each final translation, streams its audio, and fills in its ranges', async () => {
    const { stt, tts, log, of } = await live();
    stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    const sent = tts().sentJson<Json>();
    expect(sent).toContainEqual(expect.objectContaining({ stream_id: 'utt-1-1', voice: 'Adrian', language: 'ja' }));
    expect(sent).toContainEqual({ stream_id: 'utt-1-1', text: 'こんにちは。', text_end: false });

    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(1200) }));
    const audio = of('audio');
    expect(audio.map((e) => [e.payload.ref, e.payload.pcm.length, 'range' in e.payload])).toEqual([[2, 2400, false], [2, 1200, false]]);
    expect(of('speechRanges')).toEqual([]);

    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    // 2 400 and 1 200 samples over the six units of 'こんにちは。'.
    expect(of('speechRanges')).toEqual([{ kind: 'speechRanges', payload: { ref: 2, ranges: [{ index: 0, range: [0, 4] }, { index: 1, range: [4, 6] }] } }]);
    expect(log.indexOf(of('speechRanges')[0])).toBeGreaterThan(log.indexOf(audio[1]));
  });

  it('stop ends the stream, framed, and closes both sockets before its first await, and nothing follows (Stage 2 session end, ruling 2 (ii))', async () => {
    const { session, stt, tts, log, clock, timers } = await live();
    const n = log.length;
    const stopping = session.stop();
    expect(stt().closedByClient).not.toBeNull();
    expect(tts().closedByClient).not.toBeNull();
    // The end of the stream: an empty text frame, and its Logs line — no TTS stream was speaking.
    expect(stt().sent[stt().sent.length - 1]).toBe('');
    expect(log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'stt.end' } }]);
    // Both keepalives stopped with their sockets.
    expect(timers()).toBe(0);
    await stopping;
    clock.advance(60_000);
    await flush();
    expect(log.length).toBe(n + 1);
  });

  it('stop ends a TTS stream still speaking with text_end, framed after the STT stream\'s end (Stage 2 session end, ruling 2 (ii))', async () => {
    const { session, stt, tts, log } = await live();
    // A final translation with no sentence end and no <end> yet: its TTS stream is still open.
    stt().receive(msg(orig('Hello'), tr('こんにちは')));
    expect(tts().sentJson<Json>().filter((m) => m.text_end === true)).toEqual([]);
    const n = log.length;
    await session.stop();
    expect(tts().sentJson<Json>().slice(-1)).toEqual([{ stream_id: 'utt-1-1', text: '', text_end: true }]);
    expect(log.slice(n)).toEqual([
      { kind: 'frame', payload: { direction: 'out', type: 'stt.end' } },
      { kind: 'frame', payload: { direction: 'out', type: 'tts.end', payload: { streamId: 'utt-1-1' } } },
    ]);
  });

  it('a stop after the session failed sends and frames no end: its socket is gone', async () => {
    const { session, stt, log } = await live();
    stt().serverClose(1011, 'server error');
    await flush();
    const n = log.length;
    await session.stop();
    expect(log.length).toBe(n);
  });

  it('a start its signal aborts opens nothing and closes both sockets', async () => {
    const { controller, starting, stt, tts, log } = started();
    controller.abort(new Error('cancelled'));
    await expect(starting).rejects.toThrow(/cancelled/);
    expect(stt().closedByClient).not.toBeNull();
    expect(tts().closedByClient).not.toBeNull();
    await flush();
    expect(log).toEqual([]);
  });

  it('a refused STT socket fails the start with network, and closes the TTS socket', async () => {
    const { starting, stt, tts, log } = started();
    stt().drop();
    const error = await starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect((error as AdapterStartError).code).toBe('network');
    expect(tts().closedByClient).not.toBeNull();
    await flush();
    expect(log).toEqual([]);
  });

  describe('the start resolves on the STT socket alone: a failing start only ever rejects', () => {
    /** Opens the STT socket only; the TTS socket stays connecting. Resolves with where the log stood when the start resolved, or -1 when it still waits. */
    async function sttOpened(h: ReturnType<typeof started>): Promise<number> {
      let resolvedAt = -1;
      void h.starting.then(() => { resolvedAt = h.log.length; }, () => {});
      h.stt().open();
      await flush();
      return resolvedAt;
    }

    it("a bad key's error frame while the TTS socket still opens fails the leg after the start resolved, once", async () => {
      const h = started();
      const resolvedAt = await sttOpened(h);
      expect(h.tts().readyState).toBe(FakeSocket.CONNECTING);
      expect(resolvedAt).toBeGreaterThanOrEqual(0);
      // Before the resolve: the start's own frame, and nothing else.
      expect(h.log.slice(0, resolvedAt).map((e) => (e.kind === 'frame' ? e.payload.type : e.kind))).toEqual(['session.opened']);
      h.stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
      // The failure closed the STT socket itself; the close event that follows says nothing more.
      expect(h.stt().closedByClient).not.toBeNull();
      await flush();
      expect(h.of('failed')).toEqual([{ kind: 'failed', payload: { code: 'auth', message: '[Soniox 401] Invalid API key' } }]);
      expect(h.log.indexOf(h.of('failed')[0])).toBeGreaterThanOrEqual(resolvedAt);
      // The failure closed the TTS socket still opening, and left no timer running.
      expect(h.tts().closedByClient).not.toBeNull();
      expect(h.timers()).toBe(0);
    });

    it('a 503 while the TTS socket still opens resumes after the start resolved', async () => {
      const h = started();
      const resolvedAt = await sttOpened(h);
      expect(resolvedAt).toBeGreaterThanOrEqual(0);
      h.stt().receive(ERROR_503);
      h.stt().serverClose(1011);
      await flush();
      expect(h.log.findIndex((e) => e.kind === 'reconnecting')).toBeGreaterThanOrEqual(resolvedAt);
      h.openAll();
      await flush();
      expect(h.of('reconnected')).toHaveLength(1);
      expect(h.of('failed')).toEqual([]);
    });

    it('text flows while the TTS socket still opens; its speech waits for the socket, then goes in order', async () => {
      const h = started();
      expect(await sttOpened(h)).toBeGreaterThanOrEqual(0);
      h.stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
      expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['Hello.', 'こんにちは。']);
      expect(h.of('segmentClosed').map((e) => e.payload.ref)).toEqual([1, 2]);
      expect(h.tts().sent).toEqual([]);

      h.tts().open();
      await flush();
      const sent = h.tts().sentJson<Json>();
      expect(sent[0]).toMatchObject({ stream_id: 'utt-1-1', voice: 'Adrian', language: 'ja' });
      expect(sent.slice(1)).toEqual([
        { stream_id: 'utt-1-1', text: 'こんにちは。', text_end: false },
        { stream_id: 'utt-1-1', text: '', text_end: true },
      ]);
      h.tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
      h.tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(1200) }));
      h.tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
      expect(h.of('speechRanges')).toEqual([{ kind: 'speechRanges', payload: { ref: 2, ranges: [{ index: 0, range: [0, 4] }, { index: 1, range: [4, 6] }] } }]);
      expect(h.frames('tts.connect_failed')).toEqual([]);
    });

    it('a stop while the TTS socket still opens closes it, and nothing follows but the STT stream\'s end', async () => {
      const h = started();
      expect(await sttOpened(h)).toBeGreaterThanOrEqual(0);
      const session = await h.starting;
      expect(h.tts().readyState).toBe(FakeSocket.CONNECTING);
      const n = h.log.length;
      const stopping = session.stop();
      expect(h.stt().closedByClient).not.toBeNull();
      expect(h.tts().closedByClient).not.toBeNull();
      await stopping;
      await flush();
      expect(h.timers()).toBe(0);
      h.clock.advance(20_000);
      await flush();
      // No TTS stream was open to end (Stage 2 session end, ruling 2 (ii)).
      expect(h.log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'stt.end' } }]);
    });
  });

  it('opens with session.opened, and no frame carries the key', async () => {
    const { stt, tts, of } = await live();
    expect(of('frame')[0].payload).toMatchObject({
      direction: 'out',
      type: 'session.opened',
      payload: { region: 'us', translation: { type: 'one_way', target_language: 'ja' } },
    });
    stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(1200) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    expect(of('speechRanges')).toHaveLength(1);
    expect(JSON.stringify(of('frame'))).not.toContain('test-key');
  });
});

describe("the Soniox adapter: Plan B's session seams", () => {
  it('tells a lease the first frame of each socket, and never resumes under one', async () => {
    const lease = { streamAccepted: vi.fn(), atGrantEnd: vi.fn(() => false), cutoff: vi.fn() };
    const { stt, sttSockets, of } = await live({ credentials: { ...KEY, lease } });
    expect(lease.streamAccepted).not.toHaveBeenCalled();
    stt().receive(msg(orig('Hi', false)));
    stt().receive(msg(orig('Hi there', false)));
    expect(lease.streamAccepted).toHaveBeenCalledTimes(1);
    stt().receive(ERROR_503);
    expect(of('failed')).toHaveLength(1);
    expect(of('failed')[0].payload.code).toBe('connection_lost');
    stt().serverClose(1011);
    await flush();
    expect(sttSockets()).toHaveLength(1);
    expect(of('reconnecting')).toEqual([]);
  });

  it('an error frame first never tells the lease a stream was accepted', async () => {
    const lease = { streamAccepted: vi.fn(), atGrantEnd: vi.fn(() => false), cutoff: vi.fn() };
    const { stt, of } = await live({ credentials: { ...KEY, lease } });
    stt().receive(JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }));
    expect(lease.streamAccepted).not.toHaveBeenCalled();
    expect(of('failed')).toHaveLength(1);
    expect(of('failed')[0].payload.code).toBe('auth');
  });

  it("a 403 at the grant's end closes the leg without a failure, after the lease's cutoff", async () => {
    let closedAtCutoff = -1;
    const lease = { streamAccepted: vi.fn(), atGrantEnd: vi.fn(() => true), cutoff: vi.fn(() => { closedAtCutoff = h.of('closed').length; }) };
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
    const lease = { streamAccepted: vi.fn(), atGrantEnd: () => false, cutoff: vi.fn() };
    const { stt, of } = await live({ credentials: { ...KEY, lease } });
    stt().receive(JSON.stringify({ error_code: 403, error_message: 'Forbidden' }));
    expect(of('failed')).toEqual([{ kind: 'failed', payload: { code: 'auth', message: '[Soniox 403] Forbidden' } }]);
    expect(lease.cutoff).not.toHaveBeenCalled();
  });

  it('a leg that should speak but has no TTS key runs text-only, saying tts_degraded once', async () => {
    const h = started({ credentials: { region: 'us', stt: 'k' } });
    expect(h.sockets.all).toHaveLength(1);
    h.openAll();
    await h.starting;
    await flush();
    expect(h.of('degraded')).toEqual([{ kind: 'degraded', payload: expect.objectContaining({ code: 'tts_degraded' }) }]);
    expect(h.sockets.all).toHaveLength(1);
  });

  it('a client reference rides in both config frames when the credentials carry one', async () => {
    const { stt, tts } = await live({ credentials: { ...KEY, clientReferenceId: 'ref-1' } });
    expect(stt().sentJson<Json>()[0]).toMatchObject({ client_reference_id: 'ref-1' });
    stt().receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(tts().sentJson<Json>()).toContainEqual(expect.objectContaining({ stream_id: 'utt-1-1', model: expect.any(String), client_reference_id: 'ref-1' }));
  });
});
