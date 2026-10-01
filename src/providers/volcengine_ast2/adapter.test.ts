/**
 * Doubao AST 2.0's adapter: the conformance suite, the opening and its
 * refusals in words, the audio going up (resampled, paced, kept alive,
 * tailed), subtitles to segments, spoken sentences, failures and stop. On
 * `FakeSocket` and a virtual clock — no network, no fake timers.
 */
import { describe, it, expect, vi } from 'vitest';
import { AdapterStartError } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { Conversation } from '../../lib/conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { createAst2Adapter, START_TIMEOUT_MS } from './adapter';
import { IDLE_MS, KEEPALIVE_MS } from './audioIn';
import type { Ast2Config } from './config';
import type { Ast2Credentials } from './settings';
import type { OggDecoder } from './speech';
import { API_KEY, APP_KEY, AUTO_CTX, configFor, counterIds, liveAst2, pcmOf, RefusingWebSocket, SERVER, startAst2 } from './testing';
import { ast2Url, EventType, OFFLINE, REFUSED_UPGRADE } from './wire';

const MANUAL = { ...AUTO_CTX, turns: 'manual' as const };
/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = () => new Int16Array(2_048).fill(1_000);
const isSilent = (pcm: Int16Array) => pcm.every((s) => s === 0);
/** The values a credential of this kind holds: what no frame and no failure may carry. */
const secretsOf = (k: Ast2Credentials) => (k.kind === 'app' ? [k.appKey, k.accessKey] : [k.apiKey]);

function harness(): AdapterHarness<Ast2Config, Ast2Credentials> {
  let sockets = fakeSockets();
  let ids = counterIds();
  const last = () => sockets.last();
  const reply = (frame: () => ArrayBuffer): ScenarioStep => ({ run: () => last().receive(frame()) });
  return {
    adapter: createAst2Adapter({ openSocket: (url) => sockets.create(url), decode: async (ogg) => new Int16Array(ogg.length), newId: () => ids(), online: () => true }),
    config: (context) => { sockets = fakeSockets(); ids = counterIds(); return configFor(context); },
    credentials: APP_KEY,
    opening: () => [{ run: () => last().open() }, reply(() => SERVER.started()), { flush: true }],
    exchange: [
      reply(() => SERVER.subtitle('source', 'start')),
      reply(() => SERVER.subtitle('source', 'response', '你好')),
      reply(() => SERVER.subtitle('source', 'end', '你好。')),
      // The translation's times on its Start and End, and its spoken sentence carrying them: the clip is ranged, so the kit checks the range (Gemini/AST2 follow-up, ruling 1).
      reply(() => SERVER.subtitle('translation', 'start', '', { startTime: 20, endTime: 1_460 })),
      reply(() => SERVER.subtitle('translation', 'response', 'Hello')),
      reply(() => SERVER.subtitle('translation', 'end', 'Hello.', { startTime: 20, endTime: 1_460 })),
      reply(() => SERVER.ttsStart({ startTime: 20, endTime: 1_460 })),
      reply(() => SERVER.ttsChunk(96)),
      reply(() => SERVER.ttsEnd()),
    ],
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ run: () => last().drop() }, { flush: true }],
  };
}

describe('the Doubao AST 2.0 adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but typed text and reconnecting, which Doubao has neither of', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the Doubao AST 2.0 adapter: opening', () => {
  it('dials the endpoint with the credentials in its query, reads binary frames as ArrayBuffers, and starts its session once the socket opens', () => {
    const h = startAst2({ patch: { hotWordTableId: 'hot-1' } });
    expect(h.socket().url).toBe(ast2Url(APP_KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    expect(h.requests()).toEqual([]);
    h.socket().open();
    const [start] = h.requests();
    expect(start.event).toBe(EventType.StartSession);
    expect(start.requestMeta).toMatchObject({ AppKey: '1234567890', SessionID: 'id-1', ConnectionID: 'id-2', Sequence: 0 });
    expect(start.request).toMatchObject({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en', corpus: { boostingTableId: 'hot-1' } });
    expect(start.targetAudio).toMatchObject({ format: 'ogg_opus', rate: 24000 });
    expect(h.frames('session.start')).toEqual([{ sessionId: 'id-1', mode: 's2s', source: 'zh', target: 'en', corpus: { boostingTableId: 'hot-1' }, voice: null }]);
  });

  it('starts its session in the chosen fixed voice, and frames the voice it asked for (#577)', () => {
    const h = startAst2({ patch: { voices: { en: 'zh_female_vv_uranus_bigtts' } } });
    h.socket().open();
    const [start] = h.requests();
    expect(start.request).toMatchObject({ mode: 's2s', speakerId: 'zh_female_vv_uranus_bigtts', ttsResourceId: 'seed-tts-2.0' });
    expect(h.frames('session.start')).toEqual([{ sessionId: 'id-1', mode: 's2s', source: 'zh', target: 'en', corpus: null, voice: 'zh_female_vv_uranus_bigtts' }]);
  });

  it('dials an API key in its query and sends no App ID; a silent leg starts text only, with no target audio', () => {
    const h = startAst2({ credentials: API_KEY, context: { ...AUTO_CTX, speech: false } });
    expect(h.socket().url).toBe(ast2Url(API_KEY));
    h.socket().open();
    const [start] = h.requests();
    expect(start.requestMeta?.AppKey).toBe('');
    expect(start.request).toMatchObject({ mode: 's2t' });
    expect(start.targetAudio ?? null).toBeNull();
  });

  it('resolves only on SessionStarted, emitting nothing but frames, over a websocket, its keepalive armed', async () => {
    const h = startAst2();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    h.socket().open();
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.started());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.started')).toEqual([{ sessionId: 'id-1' }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(1);
  });

  it.each([
    [true, 'auth', REFUSED_UPGRADE],
    [false, 'network', OFFLINE],
  ] as const)('a socket that fails before it opens (online: %s) rejects as %s, in words (choice 8)', async (online, code, message) => {
    const h = startAst2({ online });
    h.socket().drop();
    const error = await h.starting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code, message });
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it("a refusal before SessionStarted rejects with the status's code and Doubao's words; SessionFailed as the service's; a close after the open as the service's", async () => {
    const status = startAst2();
    status.socket().open();
    status.socket().receive(SERVER.status(45000001, 'unsupported language pair', EventType.SessionFailed));
    await expect(status.starting).rejects.toMatchObject({ code: 'client', message: '[Doubao 45000001] unsupported language pair' });
    expect(status.frames('session.status')).toEqual([{ event: 'SessionFailed', statusCode: 45000001, message: 'unsupported language pair', sequence: 0 }]);
    expect(status.socket().closedByClient).not.toBeNull();

    const failed = startAst2();
    failed.socket().open();
    failed.socket().receive(SERVER.failed('no quota'));
    await expect(failed.starting).rejects.toMatchObject({ code: 'server', message: '[Doubao 20000000] no quota' });

    const closed = startAst2();
    closed.socket().open();
    closed.socket().serverClose(1011, 'busy');
    await expect(closed.starting).rejects.toMatchObject({ code: 'server', message: 'Doubao closed the connection before the session started (1011 busy).' });
    expect(closed.content()).toEqual([]);
  });

  it.each([
    ['SessionFinished', SERVER.finished, 'session.finished'],
    ['SessionCanceled', SERVER.canceled, 'session.canceled'],
  ] as const)('a %s before SessionStarted rejects the start at once, as the service ending it', async (_event, frame, type) => {
    const h = startAst2();
    // Read without awaiting: a start that ignored the end would hang to its 30 s bound, and the case must fail at once, not on the test's own timeout.
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    let error: unknown;
    void h.starting.then(() => { outcome = 'resolved'; }, (e: unknown) => { outcome = 'rejected'; error = e; });
    h.socket().open();
    h.socket().receive(frame());
    await flush();
    expect(outcome).toBe('rejected');
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: 'server', message: 'Doubao ended the session before it started.' });
    expect(h.frames(type)).toHaveLength(1);
    expect(h.content()).toEqual([]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
  });

  it('bounds the start: no SessionStarted within 30 s rejects — network when the socket never opened, server when it did — and closes the socket', async () => {
    const never = startAst2();
    never.clock.advance(START_TIMEOUT_MS);
    await expect(never.starting).rejects.toMatchObject({ code: 'network', message: 'Doubao did not open the connection within 30 s.' });
    expect(never.socket().closedByClient).not.toBeNull();
    expect(never.timers()).toBe(0);

    const silent = startAst2();
    let settled = false;
    void silent.starting.catch(() => { settled = true; });
    silent.socket().open();
    silent.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    silent.clock.advance(1);
    await expect(silent.starting).rejects.toMatchObject({ code: 'server', message: 'Doubao did not start the session within 30 s.' });
  });

  it('an abort while opening rejects with its reason, closes the socket and emits nothing; a start already aborted opens no socket', async () => {
    const h = startAst2();
    h.socket().open();
    const reason = new Error('cancelled');
    h.controller.abort(reason);
    await expect(h.starting).rejects.toBe(reason);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);

    const sockets = fakeSockets();
    const controller = new AbortController();
    controller.abort(reason);
    const starting = createAst2Adapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: configFor(), credentials: APP_KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    );
    await expect(starting).rejects.toBe(reason);
    expect(sockets.all).toEqual([]);
  });

  it.each([
    ['App ID + Access Token', APP_KEY],
    ['API key', API_KEY],
  ] as const)("a browser that will not open the socket rejects the start in fixed words, never its own, which quote the URL (%s)", async (_mode, credentials) => {
    // As Chromium throws it: a DOMException named SyntaxError, the URL with its credentials in the message.
    const openSocket = (url: string): WebSocket => { throw new DOMException(`Failed to construct 'WebSocket': The URL '${url}' is invalid.`, 'SyntaxError'); };
    const { events, log } = recordEvents();
    let starting: Promise<unknown> = Promise.resolve();
    expect(() => {
      starting = createAst2Adapter({ openSocket }).start(
        { context: AUTO_CTX, config: configFor(), credentials, clock: createVirtualClock(0), signal: new AbortController().signal },
        events,
      );
    }).not.toThrow();
    const error = await starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: 'network', message: 'The browser would not open the socket (SyntaxError).' });
    // No cause either: the console line that reports a failed start prints it raw.
    expect((error as AdapterStartError).cause).toBeUndefined();
    for (const secret of [ast2Url(credentials), ...secretsOf(credentials), 'openspeech.bytedance.com']) {
      expect((error as Error).message).not.toContain(secret);
    }
    expect(log).toEqual([]);
  });

  it("through the app's own socket, a browser's refusal still reads as the browser's error name, and nothing is opened or said", async () => {
    vi.stubGlobal('WebSocket', RefusingWebSocket);
    try {
      const { events, log } = recordEvents();
      // No opener injected: the seam the app uses, reading the stubbed global.
      const starting = createAst2Adapter({ decode: async (ogg) => new Int16Array(ogg.length), newId: counterIds(), online: () => true }).start(
        { context: AUTO_CTX, config: configFor(), credentials: API_KEY, clock: createVirtualClock(0), signal: new AbortController().signal },
        events,
      );
      const error = await starting.then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterStartError);
      expect(error).toMatchObject({ code: 'network', message: 'The browser would not open the socket (SyntaxError).' });
      expect((error as AdapterStartError).cause).toBeUndefined();
      expect(log).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the Doubao AST 2.0 adapter: audio up', () => {
  it('sends 16 kHz in 80 ms packets, each its own TaskRequest with the ids and the next Sequence, and frames none of them', async () => {
    const h = await liveAst2();
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk());
    const audio = h.requests().slice(1);
    expect(audio.map((r) => r.event)).toEqual([EventType.TaskRequest, EventType.TaskRequest, EventType.TaskRequest]);
    expect(audio.map((r) => r.requestMeta?.Sequence)).toEqual([1, 2, 3]);
    expect(audio.every((r) => r.requestMeta?.SessionID === 'id-1' && r.requestMeta?.ConnectionID === 'id-2')).toBe(true);
    expect(audio.map((r) => pcmOf(r).length)).toEqual([1_280, 1_280, 1_280]);
    expect(h.of('frame').filter((f) => f.payload.direction === 'out').map((f) => f.payload.type)).toEqual(['session.start']);
  });

  it('never splices silence into speech: none goes up while chunks arrive every 85 ms (ruling 7; survey §0.6)', async () => {
    const h = await liveAst2();
    for (let i = 0; i < 36; i++) {
      h.session.appendAudio(chunk());
      h.clock.advance(85);
    }
    const packets = h.requests().slice(1).map(pcmOf);
    expect(packets.length).toBeGreaterThan(30);
    expect(packets.filter(isSilent)).toEqual([]);
    expect(h.frames('audio.idle')).toEqual([]);
  });

  it('keeps the session alive after a real idle: one 80 ms of silence per 80 ms, framed on the transitions only (ruling 7)', async () => {
    const h = await liveAst2();
    h.session.appendAudio(chunk());
    const sent = () => h.requests().slice(1).map(pcmOf);
    const before = sent().length;
    // Ticks at 80, 160, 240 ms: under the idle threshold.
    h.clock.advance(240);
    expect(sent().length).toBe(before);
    // 320 ms: past it — what the pacer held (the chunk's last 84 samples), the first silent packet, and the one frame for them.
    h.clock.advance(KEEPALIVE_MS);
    expect(sent().slice(before).map((p) => [p.length, isSilent(p)])).toEqual([[84, false], [1_280, true]]);
    expect(h.frames('audio.idle')).toEqual([{ sinceMs: 320 }]);
    h.clock.advance(800);
    expect(sent().length).toBe(before + 12);
    expect(h.frames('audio.idle')).toHaveLength(1);
    // Speech again: resumed once, and no silence until the next real idle.
    h.session.appendAudio(chunk());
    expect(h.frames('audio.resumed')).toEqual([undefined]);
    const resumedAt = sent().length;
    h.clock.advance(IDLE_MS - 10);
    expect(sent().length).toBe(resumedAt);
  });

  it('sends what the pacer holds before the first silence of an idle, so no speech from before it follows the silence (ruling 7)', async () => {
    const h = await liveAst2();
    h.session.appendAudio(new Int16Array(600).fill(500));
    // Ticks at 80, 160, 240 ms, then 320 ms: the first past the idle threshold.
    h.clock.advance(4 * KEEPALIVE_MS);
    expect(h.requests().slice(1).map(pcmOf).map((p) => [p.length, isSilent(p)])).toEqual([[400, false], [1_280, true]]);
    // Speech again: nothing left over from before the idle rides ahead of it.
    h.session.appendAudio(new Int16Array(1_920).fill(700));
    expect(h.requests().slice(3).map(pcmOf).map((p) => [p.length, p.every((s) => s === 700)])).toEqual([[1_280, true]]);
  });

  it('a push-to-talk release or cancel sends what waits and 500 ms of silence at once (ruling 6); automatic turns send none', async () => {
    const h = await liveAst2({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(new Int16Array(600).fill(500));
    h.session.endTurn();
    const tail = h.requests().slice(1).map(pcmOf);
    expect(tail.map((p) => p.length)).toEqual([400, 1_280, 1_280, 1_280, 1_280, 1_280, 1_280, 320]);
    expect(tail.slice(1).every(isSilent)).toBe(true);
    h.session.cancelTurn();
    expect(h.frames('turn.tail')).toEqual([{ ms: 500 }, { ms: 500, cancelled: true }]);
    // A release restamps (choice 10): with an idle already running, a press and a release with no chunk, and no silence follows the tail until a real idle has passed again.
    h.clock.advance(4 * KEEPALIVE_MS);
    expect(h.frames('audio.idle')).toHaveLength(1);
    h.session.beginTurn();
    h.session.endTurn();
    const afterTail = h.requests().length;
    h.clock.advance(IDLE_MS - 10);
    expect(h.requests()).toHaveLength(afterTail);

    const auto = await liveAst2();
    auto.session.beginTurn();
    auto.session.endTurn();
    auto.session.cancelTurn();
    expect(auto.requests()).toHaveLength(1);
  });
});

describe('the Doubao AST 2.0 adapter: what comes down', () => {
  it("makes each side's subtitles a segment with no origin and no timing, framing the Sequence and both times (ruling 11)", async () => {
    const h = await liveAst2();
    h.socket().receive(SERVER.subtitle('source', 'start', '', { sequence: 4 }));
    h.socket().receive(SERVER.subtitle('source', 'response', '你好', { sequence: 4, startTime: 120, endTime: 900 }));
    h.socket().receive(SERVER.subtitle('source', 'end', '你好。', { sequence: 4, startTime: 120, endTime: 1_300 }));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.', { sequence: 4, startTime: 150, endTime: 1_350 }));
    expect(h.content().map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'segmentText', 'segmentClosed', 'segmentOpened', 'segmentText', 'segmentClosed']);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'translation' }]);
    expect(h.of('segmentText').every((e) => e.payload.timing === undefined && e.payload.language === undefined)).toBe(true);
    expect(h.frames('subtitle.source')).toEqual([
      { phase: 'start', ref: 1, text: '', startTime: 0, endTime: 0, sequence: 4, spkChg: false },
      { phase: 'response', ref: 1, text: '你好', startTime: 120, endTime: 900, sequence: 4, spkChg: false },
      { phase: 'end', ref: 1, text: '你好。', startTime: 120, endTime: 1_300, sequence: 4, spkChg: false },
    ]);
    expect(h.frames('subtitle.translation')).toEqual([{ phase: 'end', ref: 2, text: 'Hello.', startTime: 150, endTime: 1_350, sequence: 4, spkChg: false }]);
  });

  it('plays each spoken sentence as one rangeless clip on the translation locked at its start (ruling 10)', async () => {
    const h = await liveAst2();
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Hello'));
    h.socket().receive(SERVER.ttsStart({ sequence: 5 }));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.'));
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Next'));
    h.socket().receive(SERVER.ttsChunk(40));
    h.socket().receive(SERVER.none());
    h.socket().receive(SERVER.ttsChunk(24));
    h.socket().receive(SERVER.ttsEnd({ sequence: 5 }));
    await flush();
    expect(h.of('audio').map((e) => e.payload)).toEqual([{ pcm: new Int16Array(64), ref: 1 }]);
    // No times in these frames: the lock gives the ref, and the clip stays rangeless (Gemini/AST2 follow-up, choice 2).
    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 1, startTime: 0, endTime: 0, sequence: 5 }]);
    expect(h.frames('tts.sentence_end')).toEqual([{ chunks: 2, bytes: 64, sequence: 5 }]);
    expect(h.frames('tts.clip')).toEqual([{ ref: 1, matched: false, range: null }]);
    // The hot-path rule: no frame per TTSResponse chunk, and none for a frame with no event; one per clip, as it goes to L1.
    expect(h.of('frame').filter((f) => f.payload.direction === 'in').map((f) => f.payload.type)).toEqual([
      'session.started', 'subtitle.translation', 'tts.sentence_start', 'subtitle.translation', 'subtitle.translation', 'tts.sentence_end', 'tts.clip',
    ]);
  });

  it("plays a sentence that starts before its translation's first text on that translation's row, not the previous one (ruling 10)", async () => {
    const h = await liveAst2();
    const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: AUTO_CTX.direction, clock: h.clock });
    let folded = 0;
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.'));
    // The next translation has started, with no text yet, when its sentence does.
    h.socket().receive(SERVER.subtitle('translation', 'start'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk(64));
    h.socket().receive(SERVER.ttsEnd());
    await flush();
    fold();
    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 2, startTime: 0, endTime: 0, sequence: 0 }]);
    expect(h.of('audio').map((e) => e.payload.ref)).toEqual([2]);
    // L1 holds the clip until the segment opens.
    h.socket().receive(SERVER.subtitle('translation', 'response', 'How are you?'));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'How are you?'));
    fold();
    const translations = conv.snapshot().segments.filter((s) => s.side === 'translation');
    expect(translations.map((s) => [s.text, s.speech.length])).toEqual([['Hello.', 0], ['How are you?', 1]]);
    expect(translations[1].speech[0].pcm).toHaveLength(64);
  });

  it("voices each translation by the server times its sentence carries: the clip spans the whole final subtitle, stated (Gemini/AST2 follow-up, ruling 1)", async () => {
    const waiting: Array<() => void> = [];
    const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
    const h = await liveAst2({ decode });
    const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: AUTO_CTX.direction, clock: h.clock });
    let folded = 0;
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    // The owner's probe, zh → en: T1 ends before S1 starts.
    const T1 = { startTime: 20, endTime: 1_460 };
    h.socket().receive(SERVER.subtitle('translation', 'start', '', T1));
    for (const piece of ['W', 'ing', ' uses', ' real', '-time', ' translation', ' ']) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Wing uses real-time translation ', T1));
    h.socket().receive(SERVER.ttsStart(T1));
    h.socket().receive(SERVER.ttsChunk(40));
    h.socket().receive(SERVER.ttsEnd(T1));
    // S2 starts, and here its clip decodes, before T2 ends (the probe: S2 at 8.72 s, T2's End at 8.86 s).
    const T2 = { startTime: 1_940, endTime: 4_500 };
    h.socket().receive(SERVER.subtitle('translation', 'start', '', T2));
    for (const piece of ['to', ' help', ' you', ' speak', ' more', ' flu', 'ently']) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
    h.socket().receive(SERVER.ttsStart(T2));
    h.socket().receive(SERVER.ttsChunk(24));
    h.socket().receive(SERVER.ttsEnd(T2));
    await flush();
    waiting[0]();
    await flush();
    waiting[1]();
    await flush();
    fold();
    expect(h.of('audio').map((e) => e.payload)).toEqual([
      { pcm: new Int16Array(40), ref: 1, range: [0, 32] },
      // Its text is not final yet: rangeless for now.
      { pcm: new Int16Array(24), ref: 2 },
    ]);
    expect(h.of('speechRanges')).toEqual([]);
    h.socket().receive(SERVER.subtitle('translation', 'response', '.'));
    h.socket().receive(SERVER.subtitle('translation', 'response', ' '));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'to help you speak more fluently. ', T2));
    fold();
    expect(h.of('speechRanges').map((e) => e.payload)).toEqual([{ ref: 2, ranges: [{ index: 0, range: [0, 33] }] }]);
    // The lock at each start, and the times the clip was matched by as it went to L1.
    expect(h.frames('tts.sentence_start')).toEqual([
      { ref: 1, ...T1, sequence: 0 },
      { ref: 2, ...T2, sequence: 0 },
    ]);
    expect(h.frames('tts.clip')).toEqual([
      { ref: 1, matched: true, range: [0, 32] },
      { ref: 2, matched: true, range: null },
    ]);
    // L1 holds both ranges against the texts it shows.
    const translations = conv.snapshot().segments.filter((s) => s.side === 'translation');
    expect(translations.map((s) => [s.text, s.speech.map((x) => x.range)])).toEqual([
      ['Wing uses real-time translation ', [[0, 32]]],
      ['to help you speak more fluently. ', [[0, 33]]],
    ]);
  });

  it('a sentence whose times name no recent translation plays rangeless on the lock, as before', async () => {
    const h = await liveAst2();
    h.socket().receive(SERVER.subtitle('translation', 'start', '', { startTime: 20, endTime: 1_460 }));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.', { startTime: 20, endTime: 1_460 }));
    h.socket().receive(SERVER.ttsStart({ startTime: 9_192, endTime: 11_912 }));
    h.socket().receive(SERVER.ttsChunk(16));
    h.socket().receive(SERVER.ttsEnd({ startTime: 9_192, endTime: 11_912 }));
    await flush();
    expect(h.of('audio').map((e) => e.payload)).toEqual([{ pcm: new Int16Array(16), ref: 1 }]);
    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 1, startTime: 9_192, endTime: 11_912, sequence: 0 }]);
    expect(h.frames('tts.clip')).toEqual([{ ref: 1, matched: false, range: null }]);
    expect(h.of('speechRanges')).toEqual([]);
  });

  it("matches a sentence's times as its clip goes to L1: a sentence that started before its translation's Start voices that translation, not the lock's (Gemini/AST2 follow-up, choice 2)", async () => {
    const waiting: Array<() => void> = [];
    const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
    const h = await liveAst2({ decode });
    h.socket().receive(SERVER.subtitle('translation', 'start', '', { startTime: 20, endTime: 1_460 }));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.', { startTime: 20, endTime: 1_460 }));
    const T2 = { startTime: 1_940, endTime: 4_500 };
    h.socket().receive(SERVER.ttsStart(T2));
    h.socket().receive(SERVER.ttsChunk(24));
    h.socket().receive(SERVER.ttsEnd(T2));
    // Its translation starts, and ends, while the clip decodes.
    h.socket().receive(SERVER.subtitle('translation', 'start', '', T2));
    h.socket().receive(SERVER.subtitle('translation', 'end', 'How are you?', T2));
    await flush();
    waiting[0]();
    await flush();
    expect(h.frames('tts.sentence_start')).toEqual([{ ref: 1, ...T2, sequence: 0 }]);
    expect(h.of('audio').map((e) => e.payload)).toEqual([{ pcm: new Int16Array(24), ref: 2, range: [0, 12] }]);
  });

  it('keeps the order and the refs of two sentences whose decodes overlap, and flushes what TTSEnded leaves', async () => {
    const waiting: Array<() => void> = [];
    const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
    const h = await liveAst2({ decode });
    h.socket().receive(SERVER.subtitle('translation', 'response', 'One'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk(10));
    h.socket().receive(SERVER.ttsEnd());
    h.socket().receive(SERVER.subtitle('translation', 'start'));
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Two'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk(20));
    h.socket().receive(SERVER.ttsEnded());
    await flush();
    waiting[0]();
    await flush();
    waiting[1]();
    await flush();
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.pcm.length])).toEqual([[1, 10], [2, 20]]);
    expect(h.frames('tts.ended')).toEqual([{ chunks: 1, bytes: 20, sequence: 0 }]);
  });

  it('a leg that does not speak ignores every TTS event', async () => {
    const h = await liveAst2({ context: { ...AUTO_CTX, speech: false } });
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Hi'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk());
    h.socket().receive(SERVER.ttsEnd());
    await flush();
    expect(h.of('audio')).toEqual([]);
    expect(h.frames('tts.sentence_start')).toEqual([]);
  });

  it('a clip that will not decode says tts_degraded, and the session goes on', async () => {
    const h = await liveAst2({ decode: async () => { throw new Error('EncodingError'); } });
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk());
    h.socket().receive(SERVER.ttsEnd());
    await flush();
    expect(h.of('degraded').map((e) => [e.payload.code, e.payload.reason])).toEqual([['tts_degraded', 'tts_decode']]);
    expect(h.of('failed')).toEqual([]);
  });

  it.each([
    ['App ID + Access Token', APP_KEY],
    ['API key', API_KEY],
  ] as const)('frames usage and a muted microphone; drops a foreign session; never frames a credential or the URL (%s)', async (_mode, credentials) => {
    const h = await liveAst2({ credentials, context: MANUAL });
    h.socket().receive(SERVER.usage());
    h.socket().receive(SERVER.muted(3_000));
    h.socket().receive(SERVER.subtitle('source', 'response', 'not ours', { session: 'someone-else' }));
    h.socket().receive(SERVER.subtitle('source', 'response', 'ours'));
    expect(h.frames('session.usage')).toEqual([{ durationMsec: 61_000, wordCount: 12, items: [{ unit: 'minute', quantity: expect.closeTo(1.02, 5) }] }]);
    expect(h.frames('session.audio_muted')).toEqual([{ mutedDurationMs: 3_000 }]);
    expect(h.frames('session.foreign')).toEqual([{ event: 'SourceSubtitleResponse' }]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['ours']);
    // Every other frame the leg says — an idle and its end, a tail, a spoken sentence, an unreadable frame, a socket error — then a failure.
    h.session.appendAudio(chunk());
    h.clock.advance(4 * KEEPALIVE_MS);
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello.'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk());
    h.socket().receive(SERVER.ttsEnd());
    h.socket().receive(SERVER.ttsEnded());
    h.socket().receive('not a frame');
    h.socket().onerror?.call(h.socket(), new Event('error'));
    h.socket().receive(SERVER.status(55000031, 'server busy'));
    await flush();
    const types = new Set(h.of('frame').map((f) => f.payload.type));
    for (const type of ['session.start', 'session.started', 'audio.idle', 'audio.resumed', 'turn.tail', 'tts.sentence_start', 'tts.sentence_end', 'session.unreadable', 'session.socket_error', 'session.status']) {
      expect(types).toContain(type);
    }
    expect(h.of('failed')).toHaveLength(1);
    // The whole log but its pcm: frames, failures and degradations alike.
    const everything = JSON.stringify(h.log.filter((e) => e.kind !== 'audio'));
    for (const secret of [...secretsOf(credentials), 'openspeech.bytedance.com', 'api_resource_id', 'api_key', 'api_app_key', 'api_access_key']) {
      expect(everything).not.toContain(secret);
    }
  });

  it('pairs an exchange by proximity through the projection (F16): no origin stated, inferred', async () => {
    const h = await liveAst2();
    const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: AUTO_CTX.direction, clock: h.clock });
    let folded = 0;
    /** L1 folds the content as it arrives, so each segment opens at its own time. */
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    h.socket().receive(SERVER.subtitle('source', 'end', '你好，今天怎么样？'));
    fold();
    h.clock.advance(600);
    h.socket().receive(SERVER.subtitle('translation', 'end', 'Hello, how are you today?'));
    fold();
    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
    const exchanges = entries.filter((e) => e.kind === 'exchange');
    expect(exchanges).toHaveLength(1);
    for (const ex of exchanges) { if (ex.kind === 'exchange') expect(ex.pairing).toBe('inferred'); }
  });
});

describe('the Doubao AST 2.0 adapter: failures and stop', () => {
  it.each([
    [55000031, 'server', 'server busy'],
    [45000081, 'client', 'invalid audio format'],
  ] as const)("fails the run on a mid-session status %s with the status's code, %s, once, and then says nothing (ruling 8)", async (status, code, words) => {
    const h = await liveAst2();
    h.socket().receive(SERVER.status(status, words));
    const n = h.log.length;
    await flush();
    h.clock.advance(10_000);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code, message: `[Doubao ${status}] ${words}` }]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
    expect(h.log.length).toBe(n);
  });

  it("fails on SessionFailed after the start, where the old client ignored it; closes on the server's SessionFinished or SessionCanceled (choice 19)", async () => {
    const failed = await liveAst2();
    failed.socket().receive(SERVER.failed('killed'));
    expect(failed.of('failed').map((e) => e.payload.code)).toEqual(['server']);

    const finished = await liveAst2();
    finished.socket().receive(SERVER.finished());
    expect(finished.of('closed').map((e) => e.payload)).toEqual([{ reason: 'SessionFinished' }]);
    expect(finished.frames('session.finished')).toHaveLength(1);

    const canceled = await liveAst2();
    canceled.socket().receive(SERVER.canceled());
    expect(canceled.of('closed').map((e) => e.payload)).toEqual([{ reason: 'SessionCanceled' }]);
    expect(canceled.frames('session.canceled')).toHaveLength(1);
    expect(canceled.frames('session.unknown')).toEqual([]);
    // Closed, not left live on a session the server cancelled: nothing more goes up.
    const sent = canceled.requests().length;
    canceled.session.appendAudio(chunk());
    canceled.clock.advance(1_000);
    expect(canceled.requests()).toHaveLength(sent);
    expect(canceled.timers()).toBe(0);
  });

  it('an unexpected close fails with connection_lost; a socket error alone is a Logs line', async () => {
    const h = await liveAst2();
    h.socket().onerror?.call(h.socket(), new Event('error'));
    expect(h.frames('session.socket_error')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
    h.socket().serverClose(1006, '');
    await flush();
    expect(h.frames('session.connection_lost')).toEqual([{ code: 1006, reason: '' }]);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to Doubao closed (1006).' }]);
    expect(h.timers()).toBe(0);
  });

  it('a frame that will not read is said once per episode, in the Logs and as parse_error, and the stream goes on', async () => {
    const h = await liveAst2();
    // One episode: two unreadable frames in a row.
    h.socket().receive('not a frame');
    h.socket().receive(new ArrayBuffer(3));
    // A frame that reads ends it; the next unreadable one starts another.
    h.socket().receive(SERVER.subtitle('source', 'response', 'Hi'));
    h.socket().receive('again');
    expect(h.frames('session.unreadable')).toEqual([{ message: expect.any(String) }, { message: expect.any(String) }]);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error']);
    expect(h.of('segmentOpened')).toHaveLength(1);
  });

  it('stop sends FinishSession, framed, and closes the socket before it returns, cancels every timer, and nothing follows — a decode still running included (Stage 2 session end, ruling 2 (ii), (iv))', async () => {
    const waiting: Array<() => void> = [];
    const decode: OggDecoder = (ogg) => new Promise((resolve) => { waiting.push(() => resolve(new Int16Array(ogg.length))); });
    const h = await liveAst2({ decode });
    h.socket().receive(SERVER.subtitle('translation', 'response', 'Hi'));
    h.socket().receive(SERVER.ttsStart());
    h.socket().receive(SERVER.ttsChunk());
    h.socket().receive(SERVER.ttsEnd());
    await flush();
    const n = h.log.length;
    const stopping = h.session.stop();
    expect(h.requests().map((r) => r.event).slice(-1)).toEqual([EventType.FinishSession]);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    // The one line the ending says, before it returns; SessionFinished is not awaited.
    expect(h.log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'session.finish', payload: { sessionId: 'id-1' } } }]);
    await stopping;
    expect(h.timers()).toBe(0);
    waiting[0]();
    h.clock.advance(10_000);
    await flush();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.log.length).toBe(n + 1);
  });

  it('a stop on a session already ended sends and frames no FinishSession (Stage 2 session end, ruling 2 (ii))', async () => {
    const h = await liveAst2();
    h.socket().drop();
    await flush();
    const n = h.log.length;
    await h.session.stop();
    expect(h.requests().map((r) => r.event)).not.toContain(EventType.FinishSession);
    expect(h.log.length).toBe(n);
  });

  it("leaves no listener behind: the signal's once the start settles, the socket's once the session ends", async () => {
    const h = startAst2();
    const removed = vi.spyOn(h.controller.signal, 'removeEventListener');
    h.socket().open();
    h.socket().receive(SERVER.started());
    const session = await h.starting;
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    const socket = h.socket();
    await session.stop();
    expect([socket.onopen, socket.onmessage, socket.onerror, socket.onclose]).toEqual([null, null, null, null]);
  });
});
