/**
 * OpenAI Realtime's adapter: the conformance suite, the opening and its
 * refusals in words, the audio, the turns and typed text going up through
 * the queue, items to segments paired exactly, the drift anchor, failures
 * and stop. On `FakeSocket` and a virtual clock — no network, no fake
 * timers.
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
import { ANCHOR_EVERY, createRealtimeAdapter, ERROR_WORDS_MS, NEVER_OPENED, START_TIMEOUT_MS } from './adapter';
import type { RealtimeConfig } from './config';
import type { RealtimeCredentials } from './settings';
import { AUTO_CTX, configFor, exchange, KEY, liveRealtime, MANUAL_CTX, RefusingWebSocket, SERVER, startRealtime } from './testing';
import { anchorResponse, realtimeProtocols, realtimeUrl, sessionUpdate } from './wire';

/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = () => new Int16Array(2_048).fill(1_000);
/** What no frame, failure or refusal may carry: the key, and the subprotocol that holds it. */
const SECRETS = [KEY.apiKey, 'openai-insecure-api-key', 'realtimeKey'];

/** A response to a request the adapter asked for (`eventId`), for its input `previous` (null: its item names none): created naming the request, its item after that input, one delta, done. */
function answer(n: number, eventId: string, previous: string | null, translation = `Answer ${n}.`): string[] {
  const resp = `resp_a${n}`;
  const out = `item_a${n}`;
  return [
    SERVER.responseCreated(resp, { request: eventId }),
    SERVER.outputItemAdded(resp, out),
    SERVER.itemAdded(out, 'assistant', previous),
    SERVER.transcriptDelta(resp, out, translation),
    SERVER.transcriptDone(resp, out, translation),
    SERVER.outputItemDone(resp, out),
    SERVER.responseDone(resp),
  ];
}

function harness(): AdapterHarness<RealtimeConfig, RealtimeCredentials> {
  let sockets = fakeSockets();
  const last = () => sockets.last();
  const reply = (...frames: string[]): ScenarioStep => ({ run: () => { for (const f of frames) last().receive(f); } });
  return {
    adapter: createRealtimeAdapter({ openSocket: (url, protocols) => sockets.create(url, protocols) }),
    config: (context) => { sockets = fakeSockets(); return configFor(context); },
    credentials: KEY,
    opening: () => [{ run: () => last().open('realtime') }, reply(SERVER.created(), SERVER.updated()), { flush: true }],
    exchange: [reply(...exchange(1))],
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ run: () => last().drop() }, { flush: true }],
    // The anchor took `sokuji_1`; the typed item is `sokuji_text_2`, its request `sokuji_3`.
    answerText: [reply(SERVER.itemAdded('sokuji_text_2', 'user'), ...answer(1, 'sokuji_3', 'sokuji_text_2'))],
  };
}

describe('the OpenAI Realtime adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but reconnecting, which OpenAI Realtime does not do (ruling 14)', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'text', 'server-close']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the OpenAI Realtime adapter: opening', () => {
  it('dials the GA endpoint with the model in its query and the key in a subprotocol, reads binary frames as ArrayBuffers, and sends nothing until the session exists (choice 7)', () => {
    const h = startRealtime();
    expect(h.socket().url).toBe(realtimeUrl(h.config));
    expect(h.socket().protocols).toEqual(realtimeProtocols(KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    h.socket().open('realtime');
    expect(h.sent()).toEqual([]);
    expect(h.frames('session.opened')).toEqual([{ model: 'gpt-realtime-2.1-mini', modalities: ['audio'], voice: 'alloy', turnDetection: 'server_vad', manual: false }]);
  });

  it("configures the session once the server's session exists, framing what the server started with and what it was sent", () => {
    const h = startRealtime({ patch: { noiseReduction: 'Far field' } });
    h.socket().open('realtime');
    h.receive(SERVER.created());
    expect(h.sent()).toEqual([sessionUpdate(h.config)]);
    expect(h.frames('session.created')).toEqual([{ id: 'sess_1', model: 'gpt-realtime-2.1-mini', expiresAt: 1_790_000_000 }]);
    expect(h.frames('session.update')).toEqual([JSON.parse(JSON.stringify(sessionUpdate(h.config).session))]);
  });

  it('resolves only once the server confirms the configuration, over a websocket, emitting nothing but frames, with no timer left — and sends the first anchor (ruling 22; ruling 2)', async () => {
    const h = startRealtime();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    h.socket().open('realtime');
    h.receive(SERVER.created());
    await flush();
    expect(resolved).toBe(false);
    h.receive(SERVER.updated());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.updated')).toEqual([{
      outputModalities: ['audio'], reasoning: { effort: 'low' }, maxOutputTokens: null,
      audio: { input: { noise_reduction: null, transcription: { model: 'gpt-4o-mini-transcribe', language: 'ja' }, turn_detection: { type: 'server_vad', threshold: 0.5 } }, output: { voice: 'alloy' } },
    }]);
    expect(h.sent()[1]).toEqual(anchorResponse('sokuji_1', h.config.instructions));
    expect(h.frames('response.anchor')).toEqual([{ eventId: 'sokuji_1', translations: 0 }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it.each([
    ['invalid_api_key', 'invalid_request_error', 'auth'],
    ['rate_limit_exceeded', 'invalid_request_error', 'rate_limit'],
    ['invalid_value', 'invalid_request_error', 'client'],
    [null, 'server_error', 'server'],
  ] as const)("an error (%s) before the configuration is confirmed rejects the start in OpenAI's words, as %s", async (code, type, expected) => {
    const h = startRealtime();
    h.socket().open('realtime');
    h.receive(SERVER.created(), SERVER.error({ type, code, message: 'The request was refused.' }));
    const error = await h.starting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterStartError);
    expect(error).toMatchObject({ code: expected, message: `[OpenAI ${code ?? type}] The request was refused.` });
    expect(h.frames('session.error')).toEqual([{ type, code, message: 'The request was refused.', param: null, eventId: null }]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a socket that fails before it opens rejects as the network, in words naming the network and the key — never the key itself (choice 6)', async () => {
    const h = startRealtime();
    h.socket().drop();
    await expect(h.starting).rejects.toMatchObject({ code: 'network', message: NEVER_OPENED });
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a close after the socket opened, before the start, rejects as the service\'s at once', async () => {
    const h = startRealtime();
    h.socket().open('realtime');
    h.socket().serverClose(1008, 'policy');
    await expect(h.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the connection before the session started (1008 policy).' });
    expect(h.frames('session.connection_lost')).toEqual([{ code: 1008, reason: 'policy' }]);
  });

  it('bounds the start: no confirmation within 30 s rejects — network when the socket never opened, server when it did — and closes the socket (ruling 22)', async () => {
    const never = startRealtime();
    never.clock.advance(START_TIMEOUT_MS);
    await expect(never.starting).rejects.toMatchObject({ code: 'network', message: 'OpenAI did not open the connection within 30 s.' });
    expect(never.socket().closedByClient).not.toBeNull();
    expect(never.timers()).toBe(0);

    const silent = startRealtime();
    let settled = false;
    void silent.starting.catch(() => { settled = true; });
    silent.socket().open('realtime');
    silent.receive(SERVER.created());
    silent.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    silent.clock.advance(1);
    await expect(silent.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI did not start the session within 30 s.' });
    expect(silent.socket().closedByClient).not.toBeNull();
    expect(silent.timers()).toBe(0);
  });

  it('an abort while opening rejects with its reason, closes the socket and emits nothing; a start already aborted opens no socket', async () => {
    const h = startRealtime();
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
    const starting = createRealtimeAdapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    );
    await expect(starting).rejects.toBe(reason);
    expect(sockets.all).toEqual([]);
  });

  it('a browser that will not open the socket rejects the start in fixed words, never its own, which quote the key — injected or through the app\'s own seam (choice 7)', async () => {
    const openSocket = (_url: string, protocols: string[]): WebSocket => { throw new DOMException(`Failed to construct 'WebSocket': The subprotocol '${protocols[1]}' is invalid.`, 'SyntaxError'); };
    const run = async (adapter: ReturnType<typeof createRealtimeAdapter>) => {
      const { events, log } = recordEvents();
      const error = await adapter.start(
        { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: new AbortController().signal },
        events,
      ).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterStartError);
      expect(error).toMatchObject({ code: 'network', message: 'The browser would not open the socket (SyntaxError).' });
      expect((error as AdapterStartError).cause).toBeUndefined();
      for (const secret of SECRETS) expect((error as Error).message).not.toContain(secret);
      expect(log).toEqual([]);
    };
    await run(createRealtimeAdapter({ openSocket }));
    vi.stubGlobal('WebSocket', RefusingWebSocket);
    try {
      await run(createRealtimeAdapter());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a start that fails before the socket is asked for rejects with that failure as it was thrown, never in the browser's words (choice 7)", async () => {
    const sockets = fakeSockets();
    const { events, log } = recordEvents();
    // A lone surrogate: `encodeURIComponent` refuses it, so the URL cannot be built.
    const error = await createRealtimeAdapter({ openSocket: sockets.create }).start(
      { context: AUTO_CTX, config: { ...configFor(), model: '\uD800' }, credentials: KEY, clock: createVirtualClock(0), signal: new AbortController().signal },
      events,
    ).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(URIError);
    expect(error).not.toBeInstanceOf(AdapterStartError);
    expect(sockets.all).toEqual([]);
    expect(log).toEqual([]);
  });
});

describe('the OpenAI Realtime adapter: audio, turns and typed text going up', () => {
  it('sends each chunk as it came, one append each, and frames none of them (the hot-path rule)', async () => {
    const h = await liveRealtime();
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk());
    expect(h.appended().map((p) => [p.length, p[0]])).toEqual([[2_048, 1_000], [2_048, 1_000], [2_048, 1_000]]);
    expect(h.of('frame').filter((f) => f.payload.direction === 'out').map((f) => f.payload.type)).toEqual(['session.opened', 'session.update', 'response.anchor']);
  });

  it('under manual turns a release with speech commits the press and asks its response at once; one without speech clears the buffer; a press sends nothing (choice 12)', async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    expect(h.sent()[0]).toMatchObject({ session: { audio: { input: { turn_detection: null } } } });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.said().slice(2)).toEqual([{ type: 'input_audio_buffer.commit' }, { type: 'response.create', event_id: 'sokuji_2', response: { metadata: { request: 'sokuji_2' } } }]);
    expect(h.frames('response.create')).toEqual([{ eventId: 'sokuji_2', for: 'turn', waitedMs: 0 }]);
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.cancelTurn();
    expect(h.said().slice(4)).toEqual([{ type: 'input_audio_buffer.clear' }]);
    expect(h.frames('input_audio_buffer.commit')).toHaveLength(1);
    expect(h.frames('input_audio_buffer.clear')).toHaveLength(1);
  });

  it('under automatic turns the turn keys send nothing', async () => {
    const h = await liveRealtime();
    h.session.beginTurn();
    h.session.endTurn();
    h.session.cancelTurn();
    expect(h.said().map((m) => m.type)).toEqual(['session.update', 'response.create']);
  });

  it("a release while a translation streams commits at once, and its response waits for that one's end: no request into an active response (ruling 8)", async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    h.receive(SERVER.responseCreated('resp_1'));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.said().slice(2).map((m) => m.type)).toEqual(['input_audio_buffer.commit']);
    expect(h.frames('response.queued')).toEqual([{ for: 'turn', waiting: 1 }]);
    h.clock.advance(1_200);
    h.receive(SERVER.responseDone('resp_1'));
    expect(h.said().slice(3)).toEqual([{ type: 'response.create', event_id: 'sokuji_2', response: { metadata: { request: 'sokuji_2' } } }]);
    expect(h.frames('response.create')).toEqual([{ eventId: 'sokuji_2', for: 'turn', waitedMs: 1_200 }]);
  });

  it("two releases while a translation streams ask one response when it ends, the second framed as merged into it: both commits are in the conversation, and its translation pairs with the later one (ruling 8)", async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    const release = () => {
      h.session.beginTurn();
      h.session.appendAudio(chunk());
      h.session.endTurn();
    };
    h.receive(SERVER.responseCreated('resp_1'));
    release();
    h.receive(SERVER.committed('item_in_1'));
    release();
    h.receive(SERVER.committed('item_in_2', 'item_in_1'));
    expect(h.said().slice(2).map((m) => m.type)).toEqual(['input_audio_buffer.commit', 'input_audio_buffer.commit']);
    expect(h.frames('response.queued')).toEqual([{ for: 'turn', waiting: 1 }, { for: 'turn', waiting: 2 }]);
    h.clock.advance(900);
    h.receive(SERVER.responseDone('resp_1'));
    expect(h.said().slice(4)).toEqual([{ type: 'response.create', event_id: 'sokuji_2', response: { metadata: { request: 'sokuji_2' } } }]);
    expect(h.frames('response.create')).toEqual([{ eventId: 'sokuji_2', for: 'turn', waitedMs: 900, merged: 1 }]);
    // The server answers the conversation as it stands: both inputs, its item after the later one.
    h.receive(...answer(1, 'sokuji_2', 'item_in_2'));
    expect(h.frames('response.create')).toHaveLength(1);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([
      { ref: 1, side: 'source', origin: 'item_in_1' }, { ref: 2, side: 'source', origin: 'item_in_2' }, { ref: 3, side: 'translation', origin: 'item_in_2' },
    ]);
  });

  it("a typed text, then a release, both waiting: the text's item goes up after the release's commit, and its one response answers both, its translation under the text; a release, then a text: each asks its own (ruling 8)", async () => {
    const textFirst = await liveRealtime({ context: MANUAL_CTX });
    textFirst.receive(SERVER.responseCreated('resp_1'));
    textFirst.session.appendText('typed');
    textFirst.session.beginTurn();
    textFirst.session.appendAudio(chunk());
    textFirst.session.endTurn();
    textFirst.receive(SERVER.committed('item_in_1'));
    expect(textFirst.frames('response.queued')).toEqual([{ for: 'text', waiting: 1 }, { for: 'turn', waiting: 2 }]);
    textFirst.receive(SERVER.responseDone('resp_1'));
    expect(textFirst.said().slice(2).map((m) => m.type)).toEqual(['input_audio_buffer.commit', 'conversation.item.create', 'response.create']);
    expect(textFirst.frames('response.create')).toEqual([{ eventId: 'sokuji_3', for: 'text', waitedMs: 0, merged: 1 }]);
    textFirst.receive(SERVER.itemAdded('sokuji_text_2', 'user', 'item_in_1'), ...answer(1, 'sokuji_3', 'sokuji_text_2'));
    expect(textFirst.frames('response.create')).toHaveLength(1);
    expect(textFirst.of('segmentOpened').map((e) => e.payload).filter((p) => p.side === 'translation')).toEqual([{ ref: 3, side: 'translation', origin: 'sokuji_text_2' }]);

    const releaseFirst = await liveRealtime({ context: MANUAL_CTX });
    releaseFirst.receive(SERVER.responseCreated('resp_1'));
    releaseFirst.session.beginTurn();
    releaseFirst.session.appendAudio(chunk());
    releaseFirst.session.endTurn();
    releaseFirst.session.appendText('typed');
    releaseFirst.receive(SERVER.responseDone('resp_1'));
    expect(releaseFirst.frames('response.create')).toEqual([{ eventId: 'sokuji_3', for: 'turn', waitedMs: 0 }]);
    releaseFirst.receive(...answer(1, 'sokuji_3', 'item_in_1'));
    expect(releaseFirst.said().slice(3).map((m) => m.type)).toEqual(['response.create', 'conversation.item.create', 'response.create']);
    expect(releaseFirst.frames('response.create').map((f) => (f as { for: string }).for)).toEqual(['turn', 'text']);
  });

  it('a request refused for a reason other than an active response, with releases merged into it, asks again for them: one release re-queued (ruling 8; choice 10)', async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    h.receive(SERVER.responseCreated('resp_1'));
    for (let i = 0; i < 2; i++) {
      h.session.beginTurn();
      h.session.appendAudio(chunk());
      h.session.endTurn();
    }
    h.receive(SERVER.responseDone('resp_1'));
    h.receive(SERVER.error({ code: 'invalid_value', message: 'The request was refused.', event_id: 'sokuji_2' }));
    expect(h.frames('response.create')).toEqual([{ eventId: 'sokuji_2', for: 'turn', waitedMs: 0, merged: 1 }, { eventId: 'sokuji_3', for: 'turn', waitedMs: 0 }]);
    expect(h.of('failed')).toEqual([]);
  });

  it('shows typed text at once as its own source, sends its item and asks its response; its translation pairs with it (ruling 8; choice 8)', async () => {
    const h = await liveRealtime();
    h.session.appendText('  Hello there  ');
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 'sokuji_text_2' }]);
    expect(h.of('segmentText').map((e) => e.payload)).toEqual([{ ref: 1, text: 'Hello there' }]);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
    expect(h.said().slice(2)).toEqual([
      { type: 'conversation.item.create', item: { id: 'sokuji_text_2', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello there' }] } },
      { type: 'response.create', event_id: 'sokuji_3', response: { metadata: { request: 'sokuji_3' } } },
    ]);
    expect(h.frames('conversation.item.create')).toEqual([{ itemId: 'sokuji_text_2', length: 11 }]);
    h.receive(SERVER.itemAdded('sokuji_text_2', 'user'), ...answer(1, 'sokuji_3', 'sokuji_text_2', 'こんにちは。'));
    expect(h.of('segmentOpened').map((e) => e.payload)[1]).toEqual({ ref: 2, side: 'translation', origin: 'sokuji_text_2' });
    // Blank text is nothing.
    h.session.appendText('   ');
    expect(h.said()).toHaveLength(4);
  });

  it('holds every typed text made while a response is in progress, each shown at once, and sends them first in first out, one per response: nothing is overwritten (ruling 8)', async () => {
    const h = await liveRealtime();
    h.receive(...exchange(1).slice(0, 5));
    h.session.appendText('first');
    h.session.appendText('second');
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['first', 'second']);
    expect(h.frames('response.queued')).toEqual([{ for: 'text', waiting: 1 }, { for: 'text', waiting: 2 }]);
    expect(h.said().filter((m) => m.type === 'conversation.item.create')).toEqual([]);
    h.receive(...exchange(1).slice(5));
    expect(h.said().filter((m) => m.type === 'conversation.item.create').map((m) => (m.item as { id: string }).id)).toEqual(['sokuji_text_2']);
    h.receive(SERVER.itemAdded('sokuji_text_2', 'user', 'item_out_1'), ...answer(1, 'sokuji_4', 'sokuji_text_2'));
    expect(h.said().filter((m) => m.type === 'conversation.item.create').map((m) => (m.item as { id: string }).id)).toEqual(['sokuji_text_2', 'sokuji_text_3']);
    expect(h.frames('response.create').map((f) => (f as { eventId: string }).eventId)).toEqual(['sokuji_4', 'sokuji_5']);
  });

  it("asks again, when that response ends, a request refused because the server's own response was active (choice 10)", async () => {
    const h = await liveRealtime();
    h.session.appendText('typed');
    // The server's detection answered first: its response is created, and ours refused, naming it.
    h.receive(SERVER.responseCreated('resp_vad'), SERVER.error({ code: 'conversation_already_has_active_response', message: 'Conversation already has an active response.', event_id: 'sokuji_3' }));
    expect(h.of('failed')).toEqual([]);
    expect(h.frames('response.create')).toHaveLength(1);
    h.receive(SERVER.responseDone('resp_vad'));
    expect(h.frames('response.create').map((f) => (f as { eventId: string }).eventId)).toEqual(['sokuji_3', 'sokuji_4']);
    // The item went up once; only its response is asked again.
    expect(h.said().filter((m) => m.type === 'conversation.item.create')).toHaveLength(1);
    // A routine refusal is not the words of a close that follows it (ruling 13): the drop reads as the lost connection.
    h.socket().serverClose(1006, '');
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1006).' }]);
  });

  it('drops a request refused for any other reason, so the next goes up at once: nothing waits behind a refusal (choice 10)', async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    h.session.appendText('first');
    h.receive(SERVER.error({ code: 'invalid_value', message: 'The request was refused.', event_id: 'sokuji_3' }));
    expect(h.of('failed')).toEqual([]);
    h.session.appendText('second');
    expect(h.frames('response.queued')).toEqual([]);
    expect(h.said().filter((m) => m.type === 'conversation.item.create').map((m) => (m.item as { id: string }).id)).toEqual(['sokuji_text_2', 'sokuji_text_4']);
    expect(h.frames('response.create').map((f) => (f as { eventId: string }).eventId)).toEqual(['sokuji_3', 'sokuji_5']);
  });

  it('frames only what went up: a release, a cancel or a typed text on a socket already closing sends and frames nothing', async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    const sent = h.sent().length;
    const framed = h.of('frame').length;
    h.session.beginTurn();
    // The server closes: the socket is closing, its close event not yet delivered, so the leg is still live.
    h.socket().serverClose(1011, 'Internal error');
    h.session.endTurn();
    h.session.cancelTurn();
    h.session.appendText('typed');
    expect(h.sent()).toHaveLength(sent);
    expect(h.of('frame').slice(framed).map((f) => f.payload.type)).toEqual([]);
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1011 Internal error).' }]);
  });
});

describe('the OpenAI Realtime adapter: what comes down', () => {
  it('makes each input a source under its item id, streaming its transcript, and each translation a segment paired with the input it follows (rulings 11; choice 8)', async () => {
    const h = await liveRealtime();
    h.receive(SERVER.committed('item_in_1'), SERVER.itemAdded('item_in_1', 'user'), SERVER.inputDelta('item_in_1', 'こんにち'), SERVER.inputDelta('item_in_1', 'は'));
    h.receive(SERVER.responseCreated('resp_1'), SERVER.outputItemAdded('resp_1', 'item_out_1'), SERVER.itemAdded('item_out_1', 'assistant', 'item_in_1'));
    h.receive(SERVER.transcriptDelta('resp_1', 'item_out_1', 'Hello'), SERVER.audio('resp_1', 'item_out_1'), SERVER.transcriptDelta('resp_1', 'item_out_1', ' there.'), SERVER.audio('resp_1', 'item_out_1'));
    h.receive(SERVER.inputDone('item_in_1', 'こんにちは。'), SERVER.transcriptDone('resp_1', 'item_out_1', 'Hello there.'), SERVER.outputItemDone('resp_1', 'item_out_1'), SERVER.responseDone('resp_1'));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 'item_in_1' }, { ref: 2, side: 'translation', origin: 'item_in_1' }]);
    expect(h.of('segmentText').map((e) => e.payload)).toEqual([
      { ref: 1, text: 'こんにち' }, { ref: 1, text: 'こんにちは' }, { ref: 2, text: 'Hello' }, { ref: 2, text: 'Hello there.' }, { ref: 1, text: 'こんにちは。' },
    ]);
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.range, e.payload.pcm.length])).toEqual([[2, [0, 5], 2_400], [2, [5, 12], 2_400]]);
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(h.frames('response.output_audio.delta')).toEqual([{ responseId: 'resp_1', itemId: 'item_out_1', samples: 2_400 }, { responseId: 'resp_1', itemId: 'item_out_1', samples: 2_400 }]);
    expect(h.frames('response.done')).toEqual([{ responseId: 'resp_1', status: 'completed', statusDetails: null, outOfBand: false, usage: expect.objectContaining({ total_tokens: 1_200 }) }]);
  });

  it('pairs each exchange as stated through the projection; an utterance spoken over a playing translation that no response answers stays a row of its own (choice 8)', async () => {
    const h = await liveRealtime();
    const conv = new Conversation({ leg: 'speaker', session: 'realtime', languages: AUTO_CTX.direction, clock: h.clock });
    let folded = 0;
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    const first = exchange(1, { source: '一つ目。', translation: 'The first.' });
    h.receive(...first.slice(0, 9));
    fold();
    // Spoken while the first translation plays: committed and transcribed, never answered.
    h.receive(SERVER.committed('item_in_x', 'item_out_1'), SERVER.inputDone('item_in_x', '聞き逃し。'));
    fold();
    h.receive(...first.slice(9));
    fold();
    h.clock.advance(1_000);
    h.receive(...exchange(2, { source: '二つ目。', translation: 'The second.', previous: 'item_in_x' }));
    fold();
    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
    const exchanges = entries.filter((e) => e.kind === 'exchange');
    const text = (rows: ReadonlyArray<{ text: string }>) => rows.map((r) => r.text).join('');
    const read = exchanges.map((e) => (e.kind === 'exchange' ? [e.pairing, text(e.source), text(e.translation)] : null));
    expect(read).toEqual([
      ['stated', '一つ目。', 'The first.'],
      ['stated', '聞き逃し。', ''],
      ['stated', '二つ目。', 'The second.'],
    ]);
  });

  it("pairs a typed text's translation whose item names no input with the typed item, once the server holds it (choice 8)", async () => {
    const h = await liveRealtime();
    h.session.appendText('Hello there');
    h.receive(SERVER.itemAdded('sokuji_text_2', 'user'), ...answer(1, 'sokuji_3', null));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 'sokuji_text_2' }, { ref: 2, side: 'translation', origin: 'sokuji_text_2' }]);
  });

  it('pairs a translation with the input its item names, even when a newer input waits unanswered (choice 8)', async () => {
    const h = await liveRealtime();
    h.receive(SERVER.committed('item_in_1'), SERVER.committed('item_in_2', 'item_in_1'));
    h.receive(SERVER.responseCreated('resp_1'), SERVER.outputItemAdded('resp_1', 'item_out_1'), SERVER.itemAdded('item_out_1', 'assistant', 'item_in_1'));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([
      { ref: 1, side: 'source', origin: 'item_in_1' }, { ref: 2, side: 'source', origin: 'item_in_2' }, { ref: 3, side: 'translation', origin: 'item_in_1' },
    ]);
  });

  it("is busy while an in-band response is in progress, and not for the anchor's (choice 10)", async () => {
    const h = await liveRealtime();
    h.receive(SERVER.responseCreated('resp_anchor', { outOfBand: true }), SERVER.responseDone('resp_anchor', { outOfBand: true }));
    expect(h.of('busy')).toEqual([]);
    h.receive(...exchange(1));
    expect(h.of('busy').map((e) => e.payload)).toEqual([true, false]);
  });

  it("re-sends the instructions out of band after every fifth completed translation, once per count — a failed or cancelled response does not count — and its response makes no segment (ruling 2; choice 11)", async () => {
    const h = await liveRealtime();
    expect(ANCHOR_EVERY).toBe(5);
    for (let n = 1; n <= 4; n++) h.receive(...exchange(n));
    h.receive(SERVER.responseCreated('resp_x'), SERVER.responseDone('resp_x', { status: 'cancelled' }));
    expect(h.frames('response.anchor')).toHaveLength(1);
    h.receive(...exchange(5));
    expect(h.frames('response.anchor')).toEqual([{ eventId: 'sokuji_1', translations: 0 }, { eventId: 'sokuji_2', translations: 5 }]);
    const creates = h.said().filter((m) => m.type === 'response.create');
    expect(creates[creates.length - 1]).toEqual(anchorResponse('sokuji_2', h.config.instructions));
    // The anchor's own response: framed with its cost, no segment, no busy; nothing waits for it, even while it runs (ruling 2).
    const before = h.content().length;
    h.receive(
      SERVER.responseCreated('resp_anchor', { outOfBand: true }), SERVER.outputItemAdded('resp_anchor', 'item_anchor'),
      SERVER.textDelta('resp_anchor', 'item_anchor', 'Understood.'), SERVER.textDone('resp_anchor', 'item_anchor', 'Understood.'),
    );
    h.session.appendText('typed');
    expect(h.frames('response.queued')).toEqual([]);
    expect(h.frames('response.create').map((f) => (f as { eventId: string }).eventId)).toEqual(['sokuji_4']);
    h.receive(SERVER.responseDone('resp_anchor', { outOfBand: true }));
    // The typed text's own source is all that was added: the anchor made no segment and said no busy.
    expect(h.content().slice(before).map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed']);
    const dones = h.frames('response.done');
    expect(dones[dones.length - 1]).toMatchObject({ responseId: 'resp_anchor', outOfBand: true, usage: { total_tokens: 1_200 } });
    // Once per count: a response that ends short of completed while the count is five sends no second anchor.
    h.receive(SERVER.responseCreated('resp_y', { request: 'sokuji_4' }), SERVER.responseDone('resp_y', { status: 'cancelled' }));
    expect(h.frames('response.anchor')).toHaveLength(2);
    for (let n = 6; n <= 9; n++) h.receive(...exchange(n));
    expect(h.frames('response.anchor')).toHaveLength(2);
  });

  it('asks text alone of a leg that does not speak, plays no audio it gets anyway, and makes the text its translation', async () => {
    const h = await liveRealtime({ context: { ...AUTO_CTX, speech: false } });
    expect(h.sent()[0]).toMatchObject({ session: { output_modalities: ['text'] } });
    h.receive(SERVER.committed('item_in_1'), SERVER.responseCreated('resp_1'), SERVER.outputItemAdded('resp_1', 'item_out_1'), SERVER.itemAdded('item_out_1', 'assistant', 'item_in_1'));
    h.receive(SERVER.textDelta('resp_1', 'item_out_1', '{"final_text": "Hi.'), SERVER.audio('resp_1', 'item_out_1'), SERVER.textDelta('resp_1', 'item_out_1', '"}'), SERVER.textDone('resp_1', 'item_out_1', '{"final_text": "Hi."}'));
    expect(h.of('audio')).toEqual([]);
    expect(h.of('segmentText').map((e) => e.payload)).toEqual([{ ref: 2, text: '{"final_text": "Hi.' }, { ref: 2, text: '{"final_text": "Hi."}' }, { ref: 2, text: 'Hi.' }]);
  });

  it('transcription only: the session asks for no response, text alone, and a manual commit and typed text ask none either', async () => {
    const h = await liveRealtime({ context: { ...MANUAL_CTX, translate: false } });
    expect(h.sent()[0]).toMatchObject({ session: { output_modalities: ['text'], audio: { input: { turn_detection: null } } } });
    expect(sessionUpdate(configFor({ ...AUTO_CTX, translate: false })).session.audio.input.turn_detection).toMatchObject({ create_response: false });
    expect(sessionUpdate(configFor()).session.audio.input.turn_detection).toMatchObject({ create_response: true });
    h.session.endTurn();
    h.session.appendText('typed');
    const types = h.said().map((m) => m.type);
    expect(types).toContain('input_audio_buffer.commit');
    expect(types).not.toContain('response.create');
    expect(types).not.toContain('conversation.item.create');
  });

  it("settles a translation's final text unwrapped and trimmed, stating its ranges again within it (choice 9)", async () => {
    const h = await liveRealtime();
    h.receive(SERVER.responseCreated('resp_1'), SERVER.outputItemAdded('resp_1', 'item_out_1'), SERVER.itemAdded('item_out_1', 'assistant', null));
    h.receive(SERVER.transcriptDelta('resp_1', 'item_out_1', 'Hello. \n'), SERVER.audio('resp_1', 'item_out_1'), SERVER.transcriptDone('resp_1', 'item_out_1', 'Hello. \n'));
    expect(h.of('speechRanges').map((e) => e.payload)).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 6] }] }]);
  });

  it("closes a failed response's translation and frames why; frames what it does not act on under its own name, and anything else as unknown", async () => {
    const h = await liveRealtime();
    h.receive(SERVER.responseCreated('resp_1'), SERVER.transcriptDelta('resp_1', 'item_out_1', 'Half'));
    h.receive(SERVER.responseDone('resp_1', { status: 'failed', statusDetails: { type: 'failed', error: { type: 'server_error', code: 'internal' } } }));
    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
    expect(h.frames('response.done')[0]).toMatchObject({ status: 'failed', statusDetails: { type: 'failed', error: { type: 'server_error', code: 'internal' } } });
    expect(h.of('failed')).toEqual([]);
    h.receive(SERVER.bare('response.content_part.added'), SERVER.bare('conversation.item.done'), SERVER.rateLimits(), SERVER.bare('output_audio_buffer.started'));
    expect(h.frames('response.content_part.added')).toHaveLength(1);
    expect(h.frames('conversation.item.done')).toHaveLength(1);
    expect(h.frames('rate_limits.updated')).toEqual([{ rateLimits: [{ name: 'tokens', limit: 40_000, remaining: 39_000, reset_seconds: 1.5 }] }]);
    expect(h.frames('session.unknown')).toEqual([{ type: 'output_audio_buffer.started' }]);
  });
});

describe('the OpenAI Realtime adapter: failures and stop', () => {
  it('frames a mid-session error and runs on (ruling 13); a close within 10 s of it is worded as that error, a later one as the lost connection (choice 14)', async () => {
    expect(ERROR_WORDS_MS).toBe(10_000);
    const keyed = await liveRealtime();
    keyed.receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    expect(keyed.frames('session.error')).toEqual([{ type: 'invalid_request_error', code: 'invalid_api_key', message: 'Incorrect API key provided.', param: null, eventId: null }]);
    expect(keyed.of('failed')).toEqual([]);
    keyed.receive(SERVER.committed('item_in_1'));
    expect(keyed.of('segmentOpened')).toHaveLength(1);
    // The window's last instant: a close exactly 10 s after the error still reads as it.
    keyed.clock.advance(ERROR_WORDS_MS);
    keyed.socket().serverClose(1008, '');
    await flush();
    expect(keyed.of('failed').map((e) => e.payload)).toEqual([{ code: 'auth', message: '[OpenAI invalid_api_key] Incorrect API key provided.' }]);
    expect(keyed.of('degraded')).toEqual([]);

    const stale = await liveRealtime();
    stale.receive(SERVER.error({ code: 'rate_limit_exceeded', message: 'Rate limit reached.' }));
    stale.clock.advance(ERROR_WORDS_MS + 1);
    stale.socket().serverClose(1006, '');
    await flush();
    expect(stale.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1006).' }]);
  });

  it("ends the run at the 60-minute cap's error itself, in its words, whether or not a close follows (ruling 14; choice 14)", async () => {
    const h = await liveRealtime();
    h.receive(SERVER.error({ code: 'session_expired', message: 'Your session hit the maximum duration of 60 minutes.' }));
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'segment_ended', message: '[OpenAI session_expired] Your session hit the maximum duration of 60 minutes.' }]);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
    // A close that follows changes nothing: the run has ended.
    h.socket().serverClose(1000, '');
    await flush();
    expect(h.of('failed')).toHaveLength(1);
  });

  it('a wall clock stepped backwards after a mid-session error does not revive its words for a later close (ruling 13)', async () => {
    const h = await liveRealtime();
    h.receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    const realNow = h.clock.now;
    h.clock.now = () => realNow() - 3_600_000;
    h.socket().serverClose(1006, '');
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1006).' }]);
  });

  it('an unexpected close fails with connection_lost, once, and nothing reconnects; a socket error alone is a Logs line (ruling 14)', async () => {
    const h = await liveRealtime();
    h.socket().onerror?.call(h.socket(), new Event('error'));
    expect(h.frames('session.socket_error')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    expect(h.frames('session.connection_lost')).toEqual([{ code: 1011, reason: 'Internal error' }]);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to OpenAI closed (1011 Internal error).' }]);
    expect(h.sockets.all).toHaveLength(1);
    expect(h.timers()).toBe(0);
  });

  it('a frame that will not read is said once per episode, in the Logs and as parse_error; an audio delta that will not decode, or carries no base64, is its own episode (choice 15)', async () => {
    const h = await liveRealtime();
    h.receive('not a frame', '{"no":"type"}', SERVER.committed('item_in_1'), 'again');
    h.receive(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'resp_1', item_id: 'item_out_1', delta: '!!not base64!!' }));
    h.receive(JSON.stringify({ type: 'response.output_audio.delta', response_id: 'resp_1', item_id: 'item_out_1' }));
    expect(h.frames('session.unreadable')).toEqual([{ message: expect.any(String) }, { message: expect.any(String) }, { message: expect.any(String) }]);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error', 'parse_error']);
    h.receive(SERVER.audio('resp_1', 'item_out_1'), JSON.stringify({ type: 'response.output_audio.delta', response_id: 'resp_1', item_id: 'item_out_1', delta: 42 }));
    expect(h.frames('session.unreadable')).toHaveLength(4);
  });

  it('never frames, fails or degrades with the key or the subprotocol that carries it', async () => {
    const h = await liveRealtime({ context: MANUAL_CTX });
    h.receive(...exchange(1));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.session.appendText('typed');
    h.receive('not a frame', SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    h.socket().onerror?.call(h.socket(), new Event('error'));
    h.socket().serverClose(1008, '');
    await flush();
    const types = new Set(h.of('frame').map((f) => f.payload.type));
    for (const type of ['session.opened', 'session.created', 'session.update', 'session.updated', 'response.anchor', 'input_audio_buffer.committed', 'conversation.item.added',
      'conversation.item.input_audio_transcription.completed', 'response.created', 'response.output_audio_transcript.delta', 'response.output_audio.delta', 'response.done',
      'input_audio_buffer.commit', 'response.create', 'response.queued', 'session.unreadable', 'session.error', 'session.socket_error', 'session.connection_lost']) {
      expect(types).toContain(type);
    }
    expect(h.of('failed')).toHaveLength(1);
    const everything = JSON.stringify(h.log.filter((e) => e.kind !== 'audio'));
    for (const secret of SECRETS) expect(everything).not.toContain(secret);
  });

  it('stop closes the socket before it returns; nothing waits, goes up or follows, and no timer or listener is left', async () => {
    const h = startRealtime({ context: MANUAL_CTX });
    const removed = vi.spyOn(h.controller.signal, 'removeEventListener');
    h.socket().open('realtime');
    h.receive(SERVER.created(), SERVER.updated());
    const session = await h.starting;
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    h.receive(SERVER.responseCreated('resp_1'));
    session.appendText('waiting');
    const n = h.log.length;
    const sentBefore = h.sent().length;
    const socket = h.socket();
    const stopping = session.stop();
    expect(socket.closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    expect([socket.onopen, socket.onmessage, socket.onerror, socket.onclose]).toEqual([null, null, null, null]);
    h.clock.advance(10_000);
    await flush();
    session.appendAudio(chunk());
    session.appendText('late');
    session.endTurn();
    expect(h.log.length).toBe(n);
    expect(h.sent()).toHaveLength(sentBefore);
    expect(h.timers()).toBe(0);
  });
});
