/**
 * OpenAI Translate's adapter: the conformance suite, the opening and its
 * refusals in words, the audio going up and a release's tail, the deltas to
 * segments, failures and stop. On `FakeSocket` and a virtual clock — no
 * network, no fake timers.
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
import { createTranslateAdapter, ERROR_WORDS_MS, NEVER_OPENED, START_TIMEOUT_MS } from './adapter';
import type { TranslateConfig } from './config';
import type { TranslateCredentials } from './settings';
import { FRAME_SAMPLES } from './tail';
import { AUTO_CTX, configFor, KEY, liveTranslate, RefusingWebSocket, SERVER, startTranslate } from './testing';
import { translateProtocols, translateUrl } from './wire';

const MANUAL = { ...AUTO_CTX, turns: 'manual' as const };
/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = () => new Int16Array(2_048).fill(1_000);
const isSilent = (pcm: Int16Array) => pcm.every((s) => s === 0);
/** What no frame, failure or refusal may carry: the key, and the subprotocol that holds it. */
const SECRETS = [KEY.apiKey, 'openai-insecure-api-key', 'translateKey'];

function harness(): AdapterHarness<TranslateConfig, TranslateCredentials> {
  let sockets = fakeSockets();
  const last = () => sockets.last();
  const reply = (frame: () => string): ScenarioStep => ({ run: () => last().receive(frame()) });
  return {
    adapter: createTranslateAdapter({ openSocket: (url, protocols) => sockets.create(url, protocols) }),
    config: (context) => { sockets = fakeSockets(); return configFor(context); },
    credentials: KEY,
    opening: () => [{ run: () => last().open('realtime') }, reply(() => SERVER.created()), reply(() => SERVER.updated()), { flush: true }],
    exchange: [
      reply(() => SERVER.input('こんにちは。')),
      reply(() => SERVER.output('Hello.')),
      reply(() => SERVER.audio()),
      reply(() => SERVER.heartbeat()),
      { advance: 2_000 },
    ],
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ run: () => last().drop() }, { flush: true }],
  };
}

describe('the OpenAI Translate adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but typed text and reconnecting, which Translate has neither of', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the OpenAI Translate adapter: opening', () => {
  it('dials the endpoint with the model in its query and the key in a subprotocol, reads binary frames as ArrayBuffers, and sends nothing until the session exists (choice 3)', () => {
    const h = startTranslate();
    expect(h.socket().url).toBe(translateUrl(h.config));
    expect(h.socket().protocols).toEqual(translateProtocols(KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    h.socket().open('realtime');
    expect(h.sent()).toEqual([]);
    expect(h.frames('session.opened')).toEqual([{ model: 'gpt-realtime-translate', target: 'en', transcriptModel: 'gpt-live-transcribe', noiseReduction: null, speaking: true, manual: false }]);
  });

  it("configures the session once the server's session exists, framing what the server started with and what it was sent (choice 1)", () => {
    const h = startTranslate({ patch: { noiseReduction: 'Far field' } });
    h.socket().open('realtime');
    h.socket().receive(SERVER.created());
    expect(h.sent()).toEqual([{ type: 'session.update', session: { audio: { output: { language: 'en' }, input: { transcription: { model: 'gpt-live-transcribe' }, noise_reduction: { type: 'far_field' } } } } }]);
    expect(h.frames('session.created')).toEqual([{ id: 'sess_1', model: 'gpt-realtime-translate', expiresAt: 1_790_000_000, audio: { input: { noise_reduction: { type: 'near_field' }, transcription: null }, output: { language: 'en' } } }]);
    expect(h.frames('session.update')).toEqual([{ audio: { output: { language: 'en' }, input: { transcription: { model: 'gpt-live-transcribe' }, noise_reduction: { type: 'far_field' } } } }]);
  });

  it('resolves only once the server confirms the configuration, emitting nothing but frames, over a websocket, with no timer left (choice 1)', async () => {
    const h = startTranslate();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    h.socket().open('realtime');
    h.socket().receive(SERVER.created());
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.updated());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.updated')).toEqual([{ audio: { input: { noise_reduction: null, transcription: { model: 'gpt-live-transcribe' } }, output: { language: 'en' } } }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it.each([
    ['invalid_api_key', 'invalid_request_error', 'auth'],
    ['rate_limit_exceeded', 'invalid_request_error', 'rate_limit'],
    ['unknown_parameter', 'invalid_request_error', 'client'],
    [null, 'server_error', 'server'],
  ] as const)('an error (%s) before the configuration is confirmed rejects the start in OpenAI\'s words, as %s', async (code, type, expected) => {
    const h = startTranslate();
    h.socket().open('realtime');
    h.socket().receive(SERVER.created());
    h.socket().receive(SERVER.error({ type, code, message: 'The request was refused.' }));
    const error = await h.starting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: expected, message: `[OpenAI ${code ?? type}] The request was refused.` });
    expect(h.frames('session.error')).toEqual([{ type, code, message: 'The request was refused.', param: null }]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a socket that fails before it opens rejects as the network, in words naming the network and the key — never the key itself (choice 2)', async () => {
    const h = startTranslate();
    h.socket().drop();
    const error = await h.starting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: 'network', message: NEVER_OPENED });
    expect(NEVER_OPENED).toBe("OpenAI's socket did not open (check the network, and that the API key is still valid).");
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it("a close after the socket opened, or the server's session.closed, before the start rejects as the service's", async () => {
    const closed = startTranslate();
    closed.socket().open('realtime');
    closed.socket().serverClose(1008, 'policy');
    await expect(closed.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the connection before the session started (1008 policy).' });
    expect(closed.frames('session.connection_lost')).toEqual([{ code: 1008, reason: 'policy' }]);

    const ended = startTranslate();
    ended.socket().open('realtime');
    ended.socket().receive(SERVER.created());
    ended.socket().receive(SERVER.closed());
    await expect(ended.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the session before it started.' });
    expect(ended.socket().closedByClient).not.toBeNull();
    expect(ended.content()).toEqual([]);
  });

  it('bounds the start: no confirmation within 30 s rejects — network when the socket never opened, server when it did — and closes the socket (choice 2)', async () => {
    const never = startTranslate();
    never.clock.advance(START_TIMEOUT_MS);
    await expect(never.starting).rejects.toMatchObject({ code: 'network', message: 'OpenAI did not open the connection within 30 s.' });
    expect(never.socket().closedByClient).not.toBeNull();
    expect(never.timers()).toBe(0);

    const silent = startTranslate();
    let settled = false;
    void silent.starting.catch(() => { settled = true; });
    silent.socket().open('realtime');
    silent.socket().receive(SERVER.created());
    silent.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    silent.clock.advance(1);
    await expect(silent.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI did not start the session within 30 s.' });
    expect(silent.socket().closedByClient).not.toBeNull();
    expect(silent.timers()).toBe(0);
  });

  it('an abort while opening rejects with its reason, closes the socket and emits nothing; a start already aborted opens no socket', async () => {
    const h = startTranslate();
    h.socket().open('realtime');
    const reason = new Error('cancelled');
    h.controller.abort(reason);
    await expect(h.starting).rejects.toBe(reason);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);

    const sockets = fakeSockets();
    const controller = new AbortController();
    controller.abort(reason);
    const starting = createTranslateAdapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    );
    await expect(starting).rejects.toBe(reason);
    expect(sockets.all).toEqual([]);
  });

  it("a browser that will not open the socket rejects the start in fixed words, never its own, which quote the key (choice 3)", async () => {
    // As Chromium throws it for an invalid subprotocol: a DOMException named SyntaxError, the subprotocols in the message.
    const openSocket = (_url: string, protocols: string[]): WebSocket => { throw new DOMException(`Failed to construct 'WebSocket': The subprotocol '${protocols[1]}' is invalid.`, 'SyntaxError'); };
    const { events, log } = recordEvents();
    let starting: Promise<unknown> = Promise.resolve();
    expect(() => {
      starting = createTranslateAdapter({ openSocket }).start(
        { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: new AbortController().signal },
        events,
      );
    }).not.toThrow();
    const error = await starting.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: 'network', message: 'The browser would not open the socket (SyntaxError).' });
    // No cause either: the console line that reports a failed start prints it raw.
    expect((error as AdapterStartError).cause).toBeUndefined();
    for (const secret of SECRETS) expect((error as Error).message).not.toContain(secret);
    expect(log).toEqual([]);
  });

  it("through the app's own socket, a browser's refusal still reads as the browser's error name, and nothing is opened or said", async () => {
    vi.stubGlobal('WebSocket', RefusingWebSocket);
    try {
      const { events, log } = recordEvents();
      // No opener injected: the seam the app uses, reading the stubbed global.
      const starting = createTranslateAdapter().start(
        { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: new AbortController().signal },
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

describe('the OpenAI Translate adapter: audio up, and a release', () => {
  it('sends each chunk as it came, one append each, and frames none of them (the hot-path rule)', async () => {
    const h = await liveTranslate();
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk());
    expect(h.sent().map((m) => m.type)).toEqual(['session.update', ...new Array(3).fill('session.input_audio_buffer.append')]);
    expect(h.appended().map((p) => [p.length, p[0]])).toEqual([[2_048, 1_000], [2_048, 1_000], [2_048, 1_000]]);
    expect(h.of('frame').filter((f) => f.payload.direction === 'out').map((f) => f.payload.type)).toEqual(['session.opened', 'session.update']);
  });

  it('under push-to-talk a release pads the held remainder to the 200 ms grid, then sends silence in real time until the translation is quiet 1 s (ruling 2)', async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.session.beginTurn();
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk());
    h.session.endTurn();
    // Three chunks, 6 144 samples; the pad completes the second 200 ms frame.
    expect(h.appended().slice(3).map((p) => [p.length, isSilent(p)])).toEqual([[3_456, true]]);
    expect(h.frames('turn.tail')).toEqual([{ padSamples: 3_456 }]);
    // The translation of the press's last words comes out while the tail runs.
    h.clock.advance(300);
    h.socket().receive(SERVER.output('the last words.'));
    h.clock.advance(700);
    // A heartbeat is no output: the quiet the tail waits for runs on through it.
    h.socket().receive(SERVER.heartbeat());
    h.clock.advance(300);
    expect(h.frames('turn.tail_end')).toEqual([]);
    h.clock.advance(200);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 1_200, lastOutputMs: 300 }]);
    const tail = h.appended().slice(4);
    expect(tail.map((p) => [p.length, isSilent(p)])).toEqual(new Array(6).fill([FRAME_SAMPLES, true]));
    // Everything sent ends on the grid.
    expect(h.appended().reduce((n, p) => n + p.length, 0) % FRAME_SAMPLES).toBe(0);
    expect(h.timers()).toBe(1);
  });

  it.each([true, false])('content audio during a release tail keeps it running, as text does, speaking %s (ruling 2; choices 5, 7)', async (speech) => {
    const h = await liveTranslate({ context: { ...MANUAL, speech } });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.clock.advance(800);
    h.socket().receive(SERVER.audio());
    h.clock.advance(1_000);
    expect(h.frames('turn.tail_end')).toEqual([]);
    h.clock.advance(200);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 1_800, lastOutputMs: 800 }]);
  });

  it('audio at a rate it does not play still keeps a release tail running: skipped, it is the translation speaking all the same (ruling 2; choices 7, 16)', async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.clock.advance(800);
    h.socket().receive(SERVER.audio({ rate: 16_000 }));
    h.clock.advance(1_000);
    expect(h.frames('turn.tail_end')).toEqual([]);
    h.clock.advance(200);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 1_800, lastOutputMs: 800 }]);
    expect(h.of('audio')).toEqual([]);
  });

  it("a press without speech sends the same tail, said as a cancel: the press's audio is the model's input already, and no clear exists (choice 7)", async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.cancelTurn();
    h.clock.advance(1_200);
    expect(h.frames('turn.tail')).toEqual([{ padSamples: 2_752, cancelled: true }]);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null, cancelled: true }]);
  });

  it('a new press ends the tail at once, before its audio goes up; audio would end it too (ruling 2)', async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.clock.advance(400);
    h.session.beginTurn();
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'press', silenceMs: 400, lastOutputMs: null }]);
    const before = h.appended().length;
    h.clock.advance(1_000);
    expect(h.appended()).toHaveLength(before);
    h.session.appendAudio(chunk());
    expect(h.appended().slice(before).map((p) => isSilent(p))).toEqual([false]);

    h.session.endTurn();
    // The pad counts what the first tail sent: its pad and its two silent frames are on the server's grid too.
    expect(h.frames('turn.tail')[1]).toEqual({ padSamples: 2_752 });
    expect(h.appended().reduce((n, p) => n + p.length, 0) % FRAME_SAMPLES).toBe(0);
    h.session.appendAudio(chunk());
    expect(h.frames('turn.tail_end')[1]).toEqual({ reason: 'audio', silenceMs: 0, lastOutputMs: null });
  });

  it('under automatic turns the turn keys send nothing', async () => {
    const h = await liveTranslate();
    h.session.beginTurn();
    h.session.endTurn();
    h.session.cancelTurn();
    h.clock.advance(5_000);
    expect(h.sent().map((m) => m.type)).toEqual(['session.update']);
    expect(h.frames('turn.tail')).toEqual([]);
  });
});

describe('the OpenAI Translate adapter: what comes down', () => {
  it('makes each side a segment with no timing or language, the source stating its origin and the translation that source, and frames every delta with its elapsed_ms (ruling 6; Stage 2 translation cuts, ruling 2)', async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.input('こんにちは', 200));
    h.socket().receive(SERVER.input('、元気?', 400));
    h.socket().receive(SERVER.output('Hello,', 1_000));
    h.socket().receive(SERVER.output(' how are you?', null));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' }]);
    expect(h.of('segmentText').map((e) => e.payload)).toEqual([
      { ref: 1, text: 'こんにちは' }, { ref: 1, text: 'こんにちは、元気?' }, { ref: 2, text: 'Hello,' }, { ref: 2, text: 'Hello, how are you?' },
    ]);
    expect(h.frames('session.input_transcript.delta')).toEqual([{ delta: 'こんにちは', elapsedMs: 200 }, { delta: '、元気?', elapsedMs: 400 }]);
    expect(h.frames('session.output_transcript.delta')).toEqual([{ delta: 'Hello,', elapsedMs: 1_000 }, { delta: ' how are you?', elapsedMs: null }]);
    h.clock.advance(1_500);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('plays content audio under the translation, ranged by arrival, framed with its elapsed_ms; a heartbeat is nothing at all (rulings 6; choice 6)', async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.output('Hello'));
    h.socket().receive(SERVER.audio({ elapsed: 1_200 }));
    h.socket().receive(SERVER.heartbeat());
    h.socket().receive(SERVER.output(' there.'));
    h.socket().receive(SERVER.audio({ elapsed: 1_400 }));
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.range, e.payload.pcm.length])).toEqual([[1, [0, 5], 4_800], [1, [5, 12], 4_800]]);
    expect(h.frames('session.output_audio.delta')).toEqual([
      { samples: 4_800, rms: 0.0275, elapsedMs: 1_200, sampleRate: 24_000 },
      { samples: 4_800, rms: 0.0275, elapsedMs: 1_400, sampleRate: 24_000 },
    ]);
    // The heartbeat: no segment, no frame, and it holds no timer open.
    h.clock.advance(1_500);
    expect(h.of('segmentClosed')).toHaveLength(1);
    h.socket().receive(SERVER.heartbeat());
    expect(h.of('segmentOpened')).toHaveLength(1);
    expect(h.timers()).toBe(0);
  });

  it('a leg that does not speak gets the same rows and sends the same configuration, and emits no audio: Text only changes playback alone (ruling 4; choice 5)', async () => {
    const run = async (speech: boolean) => {
      const h = await liveTranslate({ context: { ...AUTO_CTX, speech } });
      h.socket().receive(SERVER.output('Hello'));
      h.socket().receive(SERVER.audio());
      h.clock.advance(1_000);
      h.socket().receive(SERVER.audio());
      // Past the text's own 1.5 s: the audio holds the translation open, played or not.
      h.clock.advance(1_000);
      expect(h.of('segmentClosed')).toEqual([]);
      h.clock.advance(500);
      return h;
    };
    const spoken = await run(true);
    const silent = await run(false);
    expect(silent.sent()).toEqual(spoken.sent());
    const rows = (h: typeof spoken) => h.content().filter((e) => e.kind !== 'audio');
    expect(rows(silent)).toEqual(rows(spoken));
    expect(spoken.of('audio')).toHaveLength(2);
    expect(silent.of('audio')).toEqual([]);
  });

  it('skips audio at a rate it does not play, says so once on a speaking leg, and lets it hold the translation (choice 16)', async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.output('Hello'));
    h.socket().receive(SERVER.audio({ rate: 16_000 }));
    h.clock.advance(1_000);
    h.socket().receive(SERVER.audio({ rate: 16_000 }));
    h.clock.advance(1_000);
    expect(h.of('audio')).toEqual([]);
    expect(h.of('segmentClosed')).toEqual([]);
    expect(h.of('degraded').map((e) => [e.payload.code, e.payload.reason])).toEqual([['tts_degraded', 'audio_rate_16000']]);

    const silent = await liveTranslate({ context: { ...AUTO_CTX, speech: false } });
    silent.socket().receive(SERVER.audio({ rate: 16_000 }));
    expect(silent.of('degraded')).toEqual([]);
  });

  it('plays a frame at the noise floor inside an open translation and frames it, but it neither opens one nor holds it open (Stage 2 translation cuts, choice 11)', async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.audio({ fill: 30 }));
    expect(h.of('segmentOpened')).toEqual([]);
    expect(h.frames('session.output_audio.delta')).toEqual([{ samples: 4_800, rms: 0.0009, elapsedMs: 0, sampleRate: 24_000 }]);
    h.socket().receive(SERVER.output('Hello.'));
    h.clock.advance(1_000);
    h.socket().receive(SERVER.audio({ fill: 30 }));
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.range])).toEqual([[1, [0, 6]]]);
    h.clock.advance(500);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
    expect(h.timers()).toBe(0);
  });

  it("cuts the translation where the source was cut, even when the interpreter pauses less than the speaker, and frames each cut (Stage 2 translation cuts, rulings 1, 2; choice 14)", async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.input('第一句'));
    h.clock.advance(1_000);
    h.socket().receive(SERVER.input('话。'));
    h.clock.advance(200);
    h.socket().receive(SERVER.output('The first'));
    h.clock.advance(600);
    h.socket().receive(SERVER.output(' sentence.'));
    // The speaker pauses 2 s, past the source's 1.5 s; the interpreter goes on 1.4 s after its sentence, inside its own 1.5 s.
    h.clock.advance(1_200);
    h.socket().receive(SERVER.input('第二句。'));
    h.clock.advance(200);
    h.socket().receive(SERVER.output(' The second.'));
    h.clock.advance(1_500);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([
      { ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' },
      { ref: 3, side: 'source', origin: 's3' }, { ref: 4, side: 'translation', origin: 's3' },
    ]);
    expect(h.of('segmentText').filter((e) => e.payload.ref === 2).map((e) => e.payload.text)).toEqual(['The first', 'The first sentence.']);
    expect(h.frames('translation.cut')).toEqual([
      { reason: 'sentences', origin: 's1', sentences: 1, owed: 0, dropped: 0 },
      { reason: 'quiet', origin: 's3', sentences: 1, owed: 0, dropped: 0 },
    ]);
  });

  it("closes the source at its .done should one come, owing its cut, settles the translation at its own, and frames what it does not know (choice 18; Stage 2 translation cuts, choices 13, 14)", async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.input('speaking'));
    h.socket().receive(SERVER.output('translating'));
    h.socket().receive(SERVER.bare('session.output_audio.done'));
    // No cut owed and its source still open: the translation waits for that source.
    expect(h.of('segmentClosed')).toEqual([]);
    h.socket().receive(SERVER.bare('session.input_transcript.done'));
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
    h.socket().receive(SERVER.bare('session.output_transcript.done'));
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }, { ref: 2 }]);
    h.socket().receive(SERVER.bare('rate_limits.updated'));
    expect(h.frames('session.output_audio.done')).toHaveLength(1);
    expect(h.frames('session.input_transcript.done')).toHaveLength(1);
    expect(h.frames('translation.cut')).toEqual([{ reason: 'done', origin: 's1', sentences: 0, owed: 0, dropped: 0 }]);
    expect(h.frames('session.unknown')).toEqual([{ type: 'rate_limits.updated' }]);
  });

  it('pairs an exchange through the projection by the origin it states (Stage 2 translation cuts, ruling 2): stated, not inferred', async () => {
    const h = await liveTranslate();
    const conv = new Conversation({ leg: 'speaker', session: 'translate', languages: AUTO_CTX.direction, clock: h.clock });
    let folded = 0;
    /** L1 folds the content as it arrives, so each segment opens at its own time. */
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    h.socket().receive(SERVER.input('今日はいい天気ですね。'));
    fold();
    h.clock.advance(1_200);
    h.socket().receive(SERVER.output("It's nice weather today."));
    fold();
    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
    const exchanges = entries.filter((e) => e.kind === 'exchange');
    expect(exchanges).toHaveLength(1);
    for (const ex of exchanges) { if (ex.kind === 'exchange') expect(ex.pairing).toBe('stated'); }
  });
});

describe('the OpenAI Translate adapter: failures and stop', () => {
  it("frames a mid-session error, degrades nothing and runs on (ruling 3); a close soon after it — the socket's or the server's — is worded as that error, a later one as the lost connection (choice 9)", async () => {
    const keyed = await liveTranslate();
    keyed.socket().receive(SERVER.error({ type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    expect(keyed.frames('session.error')).toEqual([{ type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided.', param: null }]);
    expect(keyed.of('failed')).toEqual([]);
    keyed.socket().receive(SERVER.input('still translating'));
    expect(keyed.of('segmentOpened')).toHaveLength(1);
    keyed.socket().serverClose(1008, '');
    await flush();
    expect(keyed.of('failed').map((e) => e.payload)).toEqual([{ code: 'auth', message: '[OpenAI invalid_api_key] Incorrect API key provided.' }]);

    expect(keyed.of('degraded')).toEqual([]);

    const other = await liveTranslate();
    other.socket().receive(SERVER.error({ code: 'unknown_parameter', message: 'x' }));
    other.socket().serverClose(1006, '');
    await flush();
    expect(other.of('failed').map((e) => e.payload)).toEqual([{ code: 'client', message: '[OpenAI unknown_parameter] x' }]);

    // An error long before an unrelated drop does not word it.
    const stale = await liveTranslate();
    stale.socket().receive(SERVER.error({ code: 'rate_limit_exceeded', message: 'Rate limit reached.' }));
    stale.clock.advance(ERROR_WORDS_MS + 1);
    stale.socket().serverClose(1006, '');
    await flush();
    expect(stale.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1006).' }]);

    // The server's own close right after an error ends the run in that error's words; with none, it is a plain close (ruling 13).
    const quota = await liveTranslate();
    quota.socket().receive(SERVER.error({ code: 'insufficient_quota', message: 'You exceeded your current quota.' }));
    quota.socket().receive(SERVER.closed());
    expect(quota.of('failed').map((e) => e.payload)).toEqual([{ code: 'rate_limit', message: '[OpenAI insufficient_quota] You exceeded your current quota.' }]);
    expect(quota.of('closed')).toEqual([]);
  });

  it('a wall clock stepped backwards after a mid-session error does not revive its words for a later close (ruling 3; choice 9)', async () => {
    const h = await liveTranslate();
    h.socket().receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    // The system clock jumps back an hour: a raw `now() - at` reads negative,
    // which must not make this hour-old error word a close it never caused.
    const realNow = h.clock.now;
    h.clock.now = () => realNow() - 3_600_000;
    h.socket().serverClose(1006, '');
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1006).' }]);
  });

  it('an unexpected close fails with connection_lost, once; a socket error alone is a Logs line (ruling 13)', async () => {
    const h = await liveTranslate();
    h.socket().onerror?.call(h.socket(), new Event('error'));
    expect(h.frames('session.socket_error')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    expect(h.frames('session.connection_lost')).toEqual([{ code: 1011, reason: 'Internal error' }]);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1011 Internal error).' }]);
    expect(h.timers()).toBe(0);
  });

  it("closes on the server's session.closed — an expiry, perhaps — and says nothing after it (ruling 13)", async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.socket().receive(SERVER.input('speaking'));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.socket().receive(SERVER.closed());
    const n = h.log.length;
    expect(h.of('closed').map((e) => e.payload)).toEqual([{ reason: 'session.closed' }]);
    expect(h.frames('session.closed')).toHaveLength(1);
    expect(h.socket().closedByClient).not.toBeNull();
    await flush();
    h.clock.advance(10_000);
    expect(h.timers()).toBe(0);
    expect(h.log.length).toBe(n);
  });

  it('a frame that will not read is said once per episode, in the Logs and as parse_error; an audio delta that will not decode is its own episode', async () => {
    const h = await liveTranslate();
    h.socket().receive('not a frame');
    h.socket().receive('{"no":"type"}');
    h.socket().receive(SERVER.input('Hi'));
    h.socket().receive('again');
    h.socket().receive(JSON.stringify({ type: 'session.output_audio.delta', delta: '!!not base64!!' }));
    h.socket().receive(JSON.stringify({ type: 'session.output_audio.delta', delta: '%%' }));
    expect(h.frames('session.unreadable')).toEqual([{ message: expect.any(String) }, { message: expect.any(String) }, { message: expect.any(String) }]);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error', 'parse_error']);
    expect(h.of('segmentOpened')).toHaveLength(1);
  });

  it('an audio delta with no base64 string is that same audio episode, in words quoting nothing of the frame; audio that decodes ends the episode (choice 17)', async () => {
    const h = await liveTranslate();
    const MARK = 'frame-content-marker';
    const audioDelta = (fields: Record<string, unknown>) => JSON.stringify({ type: 'session.output_audio.delta', elapsed_ms: 0, ...fields });
    h.socket().receive(audioDelta({}));
    expect(h.frames('session.unreadable')).toHaveLength(1);
    // Audio that will not decode, and a delta that is no string, add nothing: one episode.
    h.socket().receive(audioDelta({ delta: '%%' }));
    h.socket().receive(audioDelta({ delta: { text: MARK } }));
    expect(h.frames('session.unreadable')).toEqual([{ message: expect.any(String) }]);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error']);
    h.socket().receive(SERVER.audio());
    h.socket().receive(audioDelta({ delta: 42, note: MARK }));
    expect(h.frames('session.unreadable')).toHaveLength(2);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error']);
    // Only the frame that decoded became audio.
    expect(h.of('audio')).toHaveLength(1);
    expect(JSON.stringify(h.log.filter((e) => e.kind !== 'audio'))).not.toContain(MARK);
  });

  it('never frames, fails or degrades with the key or the subprotocol that carries it', async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.socket().receive(SERVER.input('a'));
    h.socket().receive(SERVER.output('b'));
    h.socket().receive(SERVER.audio());
    h.socket().receive(SERVER.audio({ rate: 8_000 }));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.clock.advance(1_400);
    h.socket().receive('not a frame');
    h.socket().receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    h.socket().onerror?.call(h.socket(), new Event('error'));
    h.socket().serverClose(1008, '');
    await flush();
    const types = new Set(h.of('frame').map((f) => f.payload.type));
    for (const type of ['session.opened', 'session.created', 'session.update', 'session.updated', 'session.input_transcript.delta', 'session.output_transcript.delta',
      'session.output_audio.delta', 'turn.tail', 'turn.tail_end', 'session.unreadable', 'session.error', 'session.socket_error', 'session.connection_lost']) {
      expect(types).toContain(type);
    }
    expect(h.of('failed')).toHaveLength(1);
    // The whole log but its pcm: frames, failures and degradations alike.
    const everything = JSON.stringify(h.log.filter((e) => e.kind !== 'audio'));
    for (const secret of SECRETS) expect(everything).not.toContain(secret);
  });

  it('stop sends session.close, framed, then closes the socket before it returns, cancels every timer — the tail and both sides — and nothing follows (Stage 2 session end, ruling 2 (iii))', async () => {
    const h = await liveTranslate({ context: MANUAL });
    h.socket().receive(SERVER.input('speaking'));
    h.socket().receive(SERVER.output('translating'));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.timers()).toBe(3);
    const n = h.log.length;
    const sentBefore = h.sent().length;
    const stopping = h.session.stop();
    // The graceful end and its Logs line; what it flushes is not waited for.
    expect(h.sent().slice(sentBefore)).toEqual([{ type: 'session.close' }]);
    expect(h.log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'session.close' } }]);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    expect(h.timers()).toBe(0);
    h.clock.advance(10_000);
    await flush();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.log.length).toBe(n + 1);
    expect(h.sent()).toHaveLength(sentBefore + 1);
  });

  it("a stop as the server's close comes in, before its close event lands, sends and frames no session.close: the socket is no longer open (Stage 2 session end, choice 9)", async () => {
    const h = await liveTranslate();
    const sent = h.sent().length;
    h.socket().serverClose(1011, 'Internal error');
    const n = h.log.length;
    await h.session.stop();
    expect(h.sent()).toHaveLength(sent);
    expect(h.log.length).toBe(n);
  });

  it('a stop after the session ended sends no session.close, and says nothing', async () => {
    const h = await liveTranslate();
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    const sent = h.sent().length;
    const n = h.log.length;
    await h.session.stop();
    expect(h.sent()).toHaveLength(sent);
    expect(h.log.length).toBe(n);
  });

  it("leaves no listener behind: the signal's once the start settles, the socket's once the session ends", async () => {
    const h = startTranslate();
    const removed = vi.spyOn(h.controller.signal, 'removeEventListener');
    h.socket().open('realtime');
    h.socket().receive(SERVER.created());
    h.socket().receive(SERVER.updated());
    const session = await h.starting;
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    const socket = h.socket();
    await session.stop();
    expect([socket.onopen, socket.onmessage, socket.onerror, socket.onclose]).toEqual([null, null, null, null]);
  });
});
