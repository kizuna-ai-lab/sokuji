/**
 * Gemini's adapter, one connection: the conformance suite for a dialogue
 * model and for Live Translate, the setup and its refusals in words, the
 * realtime input, server content to segments, the output rate,
 * unreadable frames and stop. On `FakeSocket` and a virtual clock — no
 * network, no fake timers.
 */
import { describe, it, expect } from 'vitest';
import { AdapterStartError } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { eventsFrom, recordEvents } from '../../lib/contract/events';
import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { Conversation } from '../../lib/conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { createGeminiAdapter, SETUP_TIMEOUT_MS } from './adapter';
import type { GeminiConfig } from './config';
import type { GeminiCredentials } from './settings';
import { AUTO_CTX, b64, configFor, DIALOGUE, KEY, liveGemini, SERVER, serverFrame, startGemini, TRANSLATE } from './testing';
import { base64ToPcm, liveUrl, setupFrame } from './wire';

const MANUAL = { ...AUTO_CTX, turns: 'manual' as const };
/** A model audio part named pcm whose data is not base64: `atob` refuses it. */
const BAD_AUDIO = () => serverFrame({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: '%%not base64%%' } }] } } });

/** The conformance harness for one model: its server scripted over the newest `FakeSocket`. */
function harnessFor(model: string): AdapterHarness<GeminiConfig, GeminiCredentials> {
  let sockets = fakeSockets();
  const last = () => sockets.last();
  const reply = (frame: () => ArrayBuffer): ScenarioStep => ({ run: () => last().receive(frame()) });
  /** The ladder's next attempt, dropped before it opens; a socket that is not connecting is left alone. */
  const failAttempt: ScenarioStep = { run: () => { if (last().readyState === FakeSocket.CONNECTING) last().drop(); } };
  const translate = model === TRANSLATE;
  return {
    adapter: createGeminiAdapter({ openSocket: (url) => sockets.create(url) }),
    config: (context) => { sockets = fakeSockets(); return configFor(model, context); },
    credentials: KEY,
    opening: () => [{ run: () => last().open() }, reply(SERVER.setupComplete), { flush: true }],
    exchange: translate
      ? [reply(() => SERVER.input('Hello.')), reply(() => SERVER.output('こんにちは。')), reply(() => SERVER.audio()), { advance: 1_500 }]
      : [reply(() => SERVER.input('Hello.')), reply(() => SERVER.audio()), reply(() => SERVER.output('こんにちは。')), reply(SERVER.turnComplete)],
    serverClose: [
      { run: () => last().serverClose(1011, 'Internal error') }, { flush: true },
      failAttempt, { flush: true }, { advance: 2_000 }, { flush: true },
      failAttempt, { flush: true }, { advance: 3_000 }, { flush: true },
      failAttempt, { flush: true },
    ],
    refuse: [{ run: () => last().open() }, { run: () => last().serverClose(1008, 'API key not valid. Please pass a valid API key.') }, { flush: true }],
    answerText: translate
      ? [reply(() => SERVER.output('入力された言葉')), { advance: 1_500 }]
      : [reply(() => SERVER.output('入力された言葉')), reply(SERVER.turnComplete)],
    reconnect: [
      reply(() => SERVER.handle('handle-1')),
      { run: () => last().serverClose(1011, 'Internal error') },
      { flush: true },
      { run: () => last().open() },
      reply(SERVER.setupComplete),
      { flush: true },
    ],
  };
}

describe.each([['a dialogue model', DIALOGUE], ['Live Translate', TRANSLATE]] as const)('the Gemini adapter: conformance, %s', (_name, model) => {
  const harness = harnessFor(model);

  it('runs every scenario', () => {
    expect(scenarioNames(harness)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'text', 'server-close', 'reconnect']);
  });

  it.each(scenarioNames(harness))('%s', async (name) => {
    const report = await runScenario(harness, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the Gemini adapter: opening', () => {
  it("dials the Live endpoint with the key, reads binary frames as ArrayBuffers, and sends this leg's one setup once the socket opens", () => {
    const h = startGemini();
    expect(h.socket().url).toBe(liveUrl(KEY.apiKey));
    expect(h.socket().binaryType).toBe('arraybuffer');
    h.socket().open();
    expect(h.sent()).toEqual([setupFrame(h.config, null)]);
    expect(h.frames('session.opened')).toEqual([{ model: DIALOGUE, kind: 'dialogue', speaking: true, manual: false, resumed: false }]);
  });

  it('resolves only once the server answers the setup, emitting nothing but its frames, over a websocket', async () => {
    const h = startGemini();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    h.socket().open();
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.setupComplete());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('server.setup_complete')).toEqual([{ sessionId: 'sid-1' }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it.each([
    [1008, 'API key not valid. Please pass a valid API key.', 'auth'],
    [1011, 'You exceeded your current quota.', 'rate_limit'],
    [1007, 'Request contains an invalid argument.', 'client'],
    [1011, 'Internal error', 'server'],
    [1006, '', 'network'],
  ] as const)('a close %i "%s" before the setup is answered rejects the start as %s, in words (choice 12)', async (code, reason, expected) => {
    const h = startGemini();
    h.socket().open();
    h.socket().serverClose(code, reason);
    const error = await h.starting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: expected, message: `[Gemini ${code}] ${reason || 'the connection closed before the setup was answered'}` });
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a socket that never opens rejects as network', async () => {
    const h = startGemini();
    h.socket().drop();
    await expect(h.starting).rejects.toMatchObject({ code: 'network' });
  });

  it('bounds the setup: no answer within 15 s rejects — network when the socket never opened, server when it did — and closes the socket', async () => {
    const never = startGemini();
    never.clock.advance(SETUP_TIMEOUT_MS);
    await expect(never.starting).rejects.toMatchObject({ code: 'network' });
    expect(never.socket().closedByClient).not.toBeNull();
    expect(never.timers()).toBe(0);

    const silent = startGemini();
    let settled = false;
    void silent.starting.catch(() => { settled = true; });
    silent.socket().open();
    silent.clock.advance(SETUP_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    silent.clock.advance(1);
    await expect(silent.starting).rejects.toMatchObject({ code: 'server', message: 'Gemini did not answer the setup within 15 s.' });
    expect(silent.socket().closedByClient).not.toBeNull();
  });

  it('an abort while opening rejects with its reason, closes the socket and emits no content', async () => {
    const h = startGemini();
    h.socket().open();
    const reason = new Error('cancelled');
    h.controller.abort(reason);
    await expect(h.starting).rejects.toBe(reason);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('before the setup is answered, nothing but its answer is heard: content that comes early neither settles the start nor reaches a segment', async () => {
    const h = startGemini();
    let settled = false;
    void h.starting.then(() => { settled = true; }, () => { settled = true; });
    h.socket().open();
    h.socket().receive(SERVER.input('early'));
    await flush();
    expect(settled).toBe(false);
    expect(h.frames('server.setup_complete')).toEqual([]);
    expect(h.content()).toEqual([]);
    h.socket().receive(SERVER.setupComplete());
    await h.starting;
    expect(h.content()).toEqual([]);
  });

  it('a start whose signal already aborted opens no socket', async () => {
    const sockets = fakeSockets();
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    const starting = createGeminiAdapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: configFor(DIALOGUE), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    );
    await expect(starting).rejects.toBe(reason);
    expect(sockets.all).toEqual([]);
  });
});

describe('the Gemini adapter: one session', () => {
  it("sends a view's own samples as 24 kHz pcm realtime input, with no frame per chunk", async () => {
    const h = await liveGemini();
    h.session.appendAudio(new Int16Array([9, 1, 2, 3]).subarray(1));
    const frame = h.sent()[1] as { realtimeInput: { audio: { data: string; mimeType: string } } };
    expect(frame.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=24000');
    expect(Array.from(base64ToPcm(frame.realtimeInput.audio.data))).toEqual([1, 2, 3]);
    expect(h.of('frame').filter((f) => f.payload.direction === 'out').map((f) => f.payload.type)).toEqual(['session.opened']);
  });

  it("a dialogue turn: source and translation share a stated origin, its audio plays under the translation, turnComplete closes both", async () => {
    const h = await liveGemini();
    h.socket().receive(SERVER.input('Hello.'));
    h.socket().receive(SERVER.audio(2400));
    h.socket().receive(SERVER.output('こんにちは。'));
    h.socket().receive(SERVER.turnComplete());
    expect(h.content().map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'segmentOpened', 'audio', 'segmentText', 'segmentClosed', 'segmentClosed']);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 't1' }, { ref: 2, side: 'translation', origin: 't1' }]);
    expect(h.of('audio')[0].payload.ref).toBe(2);
    expect(h.of('audio')[0].payload.pcm).toHaveLength(2400);
  });

  it("folds a message's content before its turnComplete (choice 15)", async () => {
    const h = await liveGemini();
    h.socket().receive(serverFrame({ serverContent: {
      outputTranscription: { text: 'Hi' },
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: b64(480) } }] },
      turnComplete: true,
    } }));
    expect(h.content().map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'audio', 'segmentClosed']);
  });

  it('Live Translate: each side closes on its own pause with no origin; audio outside an open translation plays with no ref (choice 8)', async () => {
    const h = await liveGemini({ model: TRANSLATE });
    h.socket().receive(SERVER.audio(480));
    h.socket().receive(SERVER.input('Hello'));
    h.socket().receive(SERVER.output('こんにちは'));
    h.socket().receive(SERVER.audio(480));
    h.clock.advance(1_500);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'translation' }]);
    expect(h.of('audio').map((e) => e.payload.ref)).toEqual([undefined, 2]);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('a leg that does not speak drops the model audio, and still logs the part', async () => {
    const h = await liveGemini({ context: { ...AUTO_CTX, speech: false } });
    h.socket().receive(SERVER.audio());
    expect(h.of('audio')).toEqual([]);
    expect(h.frames('server_content.model_turn')).toEqual([{ audioBytes: 4800, mimeType: 'audio/pcm;rate=24000' }]);
  });

  it('skips audio at another rate and says tts_degraded once, with the rate as its reason; a silent leg says nothing (choice 18)', async () => {
    const h = await liveGemini();
    h.socket().receive(SERVER.audio(480, 'audio/pcm;rate=16000'));
    h.socket().receive(SERVER.audio(480, 'audio/pcm;rate=16000'));
    expect(h.of('audio')).toEqual([]);
    expect(h.of('degraded').map((e) => ({ code: e.payload.code, reason: e.payload.reason }))).toEqual([{ code: 'tts_degraded', reason: 'audio_rate_16000' }]);
    h.socket().receive(SERVER.audio(480, 'audio/pcm'));
    expect(h.of('audio')).toHaveLength(1);

    const silent = await liveGemini({ context: { ...AUTO_CTX, speech: false } });
    silent.socket().receive(SERVER.audio(480, 'audio/pcm;rate=16000'));
    expect(silent.of('degraded')).toEqual([]);
  });

  it('inline data that is not pcm is not speech: never decoded, played or counted (parity with the old audio/pcm filter)', async () => {
    const h = await liveGemini();
    h.socket().receive(serverFrame({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'image/png', data: b64(480) } }] } } }));
    expect(h.of('audio')).toEqual([]);
    expect(h.frames('server_content.model_turn')).toEqual([{ audioBytes: 0 }]);
    expect(h.of('degraded')).toEqual([]);
    expect(h.frames('server.unreadable')).toEqual([]);
  });

  it('an audio part that will not decode is a Logs line and is skipped; the rest of its message still counts, and nothing escapes the socket', async () => {
    const h = await liveGemini();
    const message = serverFrame({ serverContent: { modelTurn: { parts: [
      { inlineData: { mimeType: 'audio/pcm;rate=24000', data: '%%not base64%%' } },
      { text: 'Bonjour' },
    ] } } });
    expect(() => h.socket().receive(message)).not.toThrow();
    h.socket().receive(SERVER.turnComplete());
    expect(h.frames('server.unreadable')).toHaveLength(1);
    expect(h.frames('server_content.model_turn')).toEqual([{ audioBytes: 0, mimeType: 'audio/pcm;rate=24000', text: 'Bonjour' }]);
    expect(h.of('audio')).toEqual([]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['Bonjour']);
    expect(h.of('failed')).toEqual([]);
  });

  it('audio parts that will not decode are one Logs line however many messages carry them, not one per message (the hot-path rule)', async () => {
    const h = await liveGemini();
    for (let i = 0; i < 5; i++) h.socket().receive(BAD_AUDIO());
    expect(h.frames('server_content.model_turn')).toHaveLength(5);
    expect(h.frames('server.unreadable')).toHaveLength(1);
  });

  it('a part that decodes ends the episode: the next one that will not is said again', async () => {
    const h = await liveGemini();
    h.socket().receive(BAD_AUDIO());
    h.socket().receive(SERVER.audio(480));
    h.socket().receive(BAD_AUDIO());
    expect(h.frames('server.unreadable')).toHaveLength(2);
    expect(h.of('audio')).toHaveLength(1);
  });

  it('an audio part and a whole frame are two episodes: one failing never silences the other, in either order', async () => {
    const part = await liveGemini();
    part.socket().receive(BAD_AUDIO());
    part.socket().receive('{bad');
    expect(part.frames('server.unreadable')).toHaveLength(2);

    const whole = await liveGemini();
    whole.socket().receive('{bad');
    whole.socket().receive(BAD_AUDIO());
    expect(whole.frames('server.unreadable')).toHaveLength(2);
  });

  it("the model's text parts stand in for a transcript that never came; a thought part never does", async () => {
    const h = await liveGemini();
    h.socket().receive(serverFrame({ serverContent: { modelTurn: { parts: [{ text: 'Let me think.', thought: true }, { text: 'Bonjour' }] } } }));
    h.socket().receive(SERVER.turnComplete());
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['Bonjour']);
    expect(h.frames('server_content.model_turn')).toEqual([{ audioBytes: 0, text: 'Bonjour' }]);
  });

  it('frames what the server says under domain.event names — never the audio, the key or a handle — and keeps a transcript language in the Logs (choices 13, 19)', async () => {
    const h = await liveGemini();
    h.socket().receive(serverFrame({ usageMetadata: { totalTokenCount: 12 } }));
    h.socket().receive(serverFrame({ toolCall: { functionCalls: [] } }));
    h.socket().receive(SERVER.handle('secret-handle-1'));
    h.socket().receive(serverFrame({ serverContent: { inputTranscription: { text: 'Hi', finished: true, languageCode: 'en-US' } } }));
    h.socket().receive(serverFrame({ serverContent: { generationComplete: true } }));
    h.socket().receive(SERVER.interrupted());
    h.socket().receive(serverFrame({ serverContent: { turnComplete: true, turnCompleteReason: 'NEED_MORE_INPUT' } }));
    expect(h.of('frame').map((f) => `${f.payload.direction} ${f.payload.type}`)).toEqual([
      'out session.opened',
      'in server.setup_complete',
      'in server.usage_metadata',
      'in server.tool_call',
      'in server.session_resumption_update',
      'in server_content.input_transcription',
      'in server_content.generation_complete',
      'in server_content.interrupted',
      'in server_content.turn_complete',
    ]);
    expect(h.frames('server.session_resumption_update')).toEqual([{ resumable: true, hasHandle: true }]);
    expect(h.frames('server_content.input_transcription')).toEqual([{ text: 'Hi', finished: true, languageCode: 'en-US' }]);
    expect(h.frames('server_content.turn_complete')).toEqual([{ reason: 'NEED_MORE_INPUT' }]);
    expect(h.of('segmentText')[0].payload).not.toHaveProperty('language');
    const everything = JSON.stringify(h.of('frame'));
    expect(everything).not.toContain('secret-handle-1');
    expect(everything).not.toContain(KEY.apiKey);
  });

  it('a transcription with no text still reaches the Logs, and opens no segment (choice 19)', async () => {
    const h = await liveGemini();
    h.socket().receive(serverFrame({ serverContent: { inputTranscription: { finished: true } } }));
    h.socket().receive(serverFrame({ serverContent: { outputTranscription: { languageCode: 'ja-JP' } } }));
    expect(h.frames('server_content.input_transcription')).toEqual([{ finished: true }]);
    expect(h.frames('server_content.output_transcription')).toEqual([{ languageCode: 'ja-JP' }]);
    expect(h.content()).toEqual([]);
  });

  it('a frame that will not parse is a Logs line once per episode, and the stream goes on', async () => {
    const h = await liveGemini();
    h.socket().receive('{bad');
    h.socket().receive('[1]');
    h.socket().receive(SERVER.input('Hi'));
    h.socket().receive('{bad');
    expect(h.frames('server.unreadable')).toHaveLength(2);
    expect(h.of('segmentOpened')).toHaveLength(1);
    expect(h.of('degraded')).toEqual([]);
    expect(h.of('failed')).toEqual([]);
  });

  it('a socket error is a Logs line, never a failure (survey §1.16.7)', async () => {
    const h = await liveGemini();
    h.socket().onerror?.call(h.socket(), new Event('error'));
    expect(h.frames('session.error')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
  });
});

describe('the Gemini adapter: turns and typed text', () => {
  it("a press sends activityStart, a release activityEnd; a cancel sends activityEnd and drops that turn's answer (ruling 8)", async () => {
    const h = await liveGemini({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(new Int16Array(480));
    h.session.endTurn();
    // The voiced press's answer ends before the voiceless press: an answer still owed would be kept (the next case).
    h.socket().receive(SERVER.output('the answer'));
    h.socket().receive(SERVER.turnComplete());
    h.session.beginTurn();
    h.session.cancelTurn();
    expect(h.sent().slice(1).map((m) => Object.keys(m.realtimeInput as object)[0])).toEqual(['activityStart', 'audio', 'activityEnd', 'activityStart', 'activityEnd']);
    expect(h.frames('realtime_input.activity_end')).toEqual([undefined, { cancelled: true }]);
    h.socket().receive(SERVER.output('an answer to a cough'));
    expect(h.of('segmentOpened')).toHaveLength(1);
    h.socket().receive(SERVER.turnComplete());
    h.session.beginTurn();
    h.socket().receive(SERVER.output('the next answer'));
    expect(h.of('segmentOpened')).toHaveLength(2);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['the answer', 'the next answer']);
  });

  it("a voiceless press released before the previous press's answer streams drops only its own answer: the owed one still reaches its segments (ruling 8)", async () => {
    const h = await liveGemini({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(new Int16Array(480));
    h.session.endTurn();
    h.session.beginTurn();
    h.session.cancelTurn();
    h.socket().receive(SERVER.output('The answer.'));
    h.socket().receive(SERVER.audio());
    h.socket().receive(SERVER.turnComplete());
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'translation', origin: 't1' }]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['The answer.']);
    expect(h.of('audio').map((e) => e.payload.ref)).toEqual([1]);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1, origin: 't1' }]);
    h.socket().receive(SERVER.output('an answer to the cancelled press'));
    h.socket().receive(SERVER.audio());
    h.socket().receive(SERVER.turnComplete());
    expect(h.of('segmentOpened')).toHaveLength(1);
    expect(h.of('audio')).toHaveLength(1);
  });

  it("a cancelled press the server never answers: the next press ends the drop, and its answer is shown (choice 16)", async () => {
    const h = await liveGemini({ context: MANUAL });
    h.session.beginTurn();
    h.session.cancelTurn();
    h.session.beginTurn();
    h.session.appendAudio(new Int16Array(480));
    h.session.endTurn();
    h.socket().receive(SERVER.output('the real answer'));
    h.socket().receive(SERVER.turnComplete());
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['the real answer']);
  });

  it('under manual turns a release or a cancel with no press held sends nothing', async () => {
    const h = await liveGemini({ context: MANUAL });
    h.session.endTurn();
    h.session.cancelTurn();
    expect(h.sent()).toHaveLength(1);
    expect(h.frames('realtime_input.activity_end')).toEqual([]);
    // The control: a held press's release is sent.
    h.session.beginTurn();
    h.session.endTurn();
    expect(h.frames('realtime_input.activity_end')).toEqual([undefined]);
  });

  it('under automatic detection the turn keys send nothing', async () => {
    const h = await liveGemini();
    h.session.beginTurn();
    h.session.endTurn();
    h.session.cancelTurn();
    expect(h.sent()).toHaveLength(1);
  });

  it("a voiceless press while the previous answer still streams cuts nothing: that answer plays and shows to its end, and the cancelled press's own answer is dropped (ruling 8, NO_INTERRUPTION)", async () => {
    const h = await liveGemini({ context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(new Int16Array(480));
    h.session.endTurn();
    h.socket().receive(SERVER.output('The answer'));
    h.socket().receive(SERVER.audio());
    h.session.beginTurn();
    h.session.cancelTurn();
    h.socket().receive(SERVER.output(' goes on.'));
    h.socket().receive(SERVER.audio());
    expect(h.frames('realtime_input.activity_end')).toEqual([undefined, { cancelled: true }]);
    expect(h.of('segmentClosed')).toEqual([]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['The answer', 'The answer goes on.']);
    expect(h.of('audio').map((e) => e.payload.ref)).toEqual([1, 1]);
    h.socket().receive(SERVER.turnComplete());
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1, origin: 't1' }]);
    h.socket().receive(SERVER.output('an answer to the cancelled press'));
    h.socket().receive(SERVER.turnComplete());
    expect(h.of('segmentOpened')).toHaveLength(1);
  });

  it('on Live Translate a cancel is activityEnd alone: the streaming translation goes on in its segment (choice 16)', async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.socket().receive(SERVER.output('streaming'));
    h.session.cancelTurn();
    h.socket().receive(SERVER.output(' on'));
    expect(h.sent().slice(1)).toEqual([{ realtimeInput: { activityStart: {} } }, { realtimeInput: { activityEnd: {} } }]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['streaming', 'streaming on']);
    expect(h.of('segmentClosed')).toEqual([]);
  });

  it('typed text: trimmed, its own source segment, sent as realtime text; under manual turns with no press held, wrapped in activity marks (choice 17)', async () => {
    const h = await liveGemini();
    h.session.appendText('  hello  ');
    expect(h.sent().slice(1)).toEqual([{ realtimeInput: { text: 'hello' } }]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['hello']);
    expect(h.frames('realtime_input.text')).toEqual([{ length: 5 }]);
    h.session.appendText('   ');
    expect(h.sent()).toHaveLength(2);

    const m = await liveGemini({ context: MANUAL });
    m.session.appendText('hi');
    expect(m.sent().slice(1)).toEqual([{ realtimeInput: { activityStart: {} } }, { realtimeInput: { text: 'hi' } }, { realtimeInput: { activityEnd: {} } }]);
    m.session.beginTurn();
    m.session.appendText('held');
    expect(m.sent().slice(4)).toEqual([{ realtimeInput: { activityStart: {} } }, { realtimeInput: { text: 'held' } }]);
  });

  it('stop closes the socket before it returns, cancels every timer, and nothing follows', async () => {
    const h = await liveGemini({ model: TRANSLATE });
    h.socket().receive(SERVER.input('Hello'));
    const n = h.log.length;
    const stopping = h.session.stop();
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    expect(h.timers()).toBe(0);
    h.clock.advance(10_000);
    await flush();
    h.session.appendAudio(new Int16Array(10));
    h.session.appendText('late');
    expect(h.log.length).toBe(n);
    expect(h.sent()).toHaveLength(1);
  });
});

describe('the Gemini adapter: through L1 and L2', () => {
  it("Live Translate's segments pair by inference: two exchanges, each its own source and translation (ruling 1, F16)", async () => {
    // The adapter's events feed L1 as the runner's do, on the adapter's own clock (as `localInference/adapter.test.ts`'s u9 → u10 case).
    const clock = createVirtualClock(0);
    const conversation = new Conversation({ leg: 'speaker', session: 's', languages: AUTO_CTX.direction, clock });
    const sockets = fakeSockets();
    const starting = createGeminiAdapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: configFor(TRANSLATE), credentials: KEY, clock, signal: new AbortController().signal },
      eventsFrom((e) => conversation.apply(e)),
    );
    sockets.last().open();
    sockets.last().receive(SERVER.setupComplete());
    await starting;
    const socket = sockets.last();
    // Each translation opens a second after its source, inside the 4 s proximity window; the second pair comes after a pause.
    socket.receive(SERVER.input('Hello.'));
    clock.advance(1_000);
    socket.receive(SERVER.output('こんにちは。'));
    clock.advance(11_500);
    socket.receive(SERVER.input('Goodbye.'));
    clock.advance(1_000);
    socket.receive(SERVER.output('さようなら。'));
    clock.advance(1_500);
    const exchanges = createProjector().project([conversation.snapshot()], DEFAULT_PROJECTION).flatMap((e) => (e.kind === 'exchange' ? [e] : []));
    expect(exchanges.map((e) => [e.pairing, e.source.map((r) => r.text).join(''), e.translation.map((r) => r.text).join('')])).toEqual([
      ['inferred', 'Hello.', 'こんにちは。'],
      ['inferred', 'Goodbye.', 'さようなら。'],
    ]);
  });
});
