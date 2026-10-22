/**
 * Qwen LiveTranslate's adapter: the conformance suite and the seeded
 * lifecycles, the start over the header seam and its refusals in words, the
 * storefront fallback, the audio going up, push-to-talk, the events to
 * segments and frames, the ends, stop. On the header seam's fake,
 * `FakeSocket`s and a virtual clock — no network, no fake timers.
 */
import { describe, it, expect } from 'vitest';
import { AdapterStartError, SAMPLE_RATE, type FrameReason, type FrameSource } from '../../lib/contract/adapter';
import type { AdapterEvent } from '../../lib/contract/events';
import { HeaderSocketError } from '../../lib/contract/headerSocket';
import { driveAdapter, flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { fakeFrameSource, JPEG_A, JPEG_B } from '../../lib/contract/testing/fakeFrames';
import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import { fakeHeaderSockets } from '../../lib/contract/testing/headerSocket';
import { runLifecycles, type LifecycleHarness } from '../../lib/contract/testing/lifecycle';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { recordEvents } from '../../lib/contract/events';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { CONNECTION_LOST, createQwenAdapter, ERROR_WORDS_MS, KEEPALIVE_CHECK_MS, KEEPALIVE_IDLE_MS, NEVER_OPENED, PRE_ROLL_MS, QUIET_KEEP_MS, START_TIMEOUT_MS, TURN_DONE_MS } from './adapter';
import type { DetectEndpoint } from './check';
import type { QwenConfig } from './config';
import type { QwenCredentials } from './settings';
import { AUTO_CTX, configFor, KEY, MANUAL_CTX, openQwen, PARTICIPANT_CTX, qwenSession, SERVER, SHARED, startQwen, TEXT_CTX, turn } from './testing';
import { sessionUpdate } from './wire';

/** What no event, failure or refusal may carry: the key, and the header it rides in. */
const SECRETS = [KEY.apiKey, 'st-token', 'Bearer'];
const noSecret = (value: unknown) => {
  const text = JSON.stringify(value, (_k, v: unknown) => (v instanceof Int16Array ? `pcm(${v.length})` : v instanceof Error ? v.message : v));
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};
const chunk = (fill = 1_000) => new Int16Array(2_048).fill(fill);
/** What a socket has sent so far, by type, in order. */
const types = (s: FakeSocket) => s.sentJson<{ type: string }>().map((m) => m.type);
/** Content events as `[kind, payload]`, audio by its ref. */
const content = (log: readonly AdapterEvent[]) =>
  log.filter((e) => e.kind !== 'frame').map((e) => (e.kind === 'audio' ? ['audio', { ref: e.payload.ref, samples: e.payload.pcm.length }] : [e.kind, e.payload]));
const intl: DetectEndpoint = async () => ({ endpoint: 'intl' });

function harness(): AdapterHarness<QwenConfig, QwenCredentials> {
  let seam = fakeHeaderSockets();
  const last = () => seam.sockets.last();
  const reply = (frame: string): ScenarioStep => ({ run: () => last().receive(frame) });
  return {
    adapter: createQwenAdapter({ openHeaderSocket: (url, headers, o) => seam.open(url, headers, o), detect: intl }),
    config: (context) => { seam = fakeHeaderSockets(); return configFor(context); },
    credentials: KEY,
    // The registration answers first; the socket exists only then.
    opening: () => [{ flush: true }, { run: () => last().open() }, { flush: true }, reply(SERVER.created()), reply(SERVER.updated()), { flush: true }],
    exchange: turn(1, { source: '你好', translation: 'Hello.' }).map(reply),
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ flush: true }, { run: () => last().drop() }, { flush: true }],
  };
}

describe('the Qwen LiveTranslate adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but typed text and reconnecting, which it has neither of (D8)', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the Qwen LiveTranslate adapter: the seeded lifecycles', () => {
  const lifecycles: LifecycleHarness<QwenConfig, QwenCredentials> = {
    adapter: (run) => createQwenAdapter({ openHeaderSocket: fakeHeaderSockets(run.sockets).open, detect: intl }),
    config: (context) => configFor(context),
    credentials: KEY,
    secrets: SECRETS,
    textInput: false,
    startBoundMs: START_TIMEOUT_MS,
    opening: async (run) => {
      // The registration answers first: the socket exists only after it.
      await flush();
      const socket = run.sockets.all[run.sockets.all.length - 1];
      if (!socket) return;
      const r = run.rand();
      if (r < 0.04) { run.count('harness.drop'); return socket.drop(); }
      if (r < 0.07) { run.count('harness.silent'); return; }
      socket.open();
      await flush();
      if (r < 0.1) { run.count('harness.refused'); socket.receive(SERVER.created()); return socket.receive(SERVER.error()); }
      if (r < 0.13) { run.count('harness.close_1007'); return socket.serverClose(1007, 'Invalid translation parameter.'); }
      // Opened, and no answer yet: the kit may abort mid-handshake, else the start's bound runs out.
      if (r < 0.28) { run.count('harness.unanswered'); return; }
      socket.receive(SERVER.created());
      if (r < 0.33) { run.count('harness.created_only'); return; }
      socket.receive(SERVER.updated());
    },
    server: async (run) => {
      const socket = run.sockets.all[run.sockets.all.length - 1];
      if (!socket || socket.readyState !== FakeSocket.OPEN) return;
      const r = run.rand();
      const n = Math.floor(run.rand() * 4);
      const heard = `item_h${n}`;
      const answer = `item_t${n}`;
      if (r < 0.1) socket.receive(SERVER.speechStarted(heard, 1 + (n % 2)));
      else if (r < 0.18) socket.receive(SERVER.heardItem(heard));
      else if (r < 0.26) socket.receive(SERVER.answerItem(answer, heard));
      else if (r < 0.3) socket.receive(SERVER.outputItem(answer));
      else if (r < 0.4) socket.receive(SERVER.sourceDelta(heard, run.pick(['你好', '，', '老板'])));
      else if (r < 0.45) socket.receive(SERVER.sourceDone(heard, run.pick(['你好', ''])));
      else if (r < 0.55) socket.receive(run.pick([SERVER.transcriptDelta(answer, 'Hello'), SERVER.textDelta(answer, ' there.')]));
      else if (r < 0.6) socket.receive(run.pick([SERVER.transcriptDone(answer, 'Hello there.'), SERVER.textDone(answer, '')]));
      else if (r < 0.68) socket.receive(SERVER.audio(answer));
      else if (r < 0.71) socket.receive(SERVER.error(run.pick(['COMMON_ERROR', 'Throttling']), run.pick(["<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported.", 'Requests rate limit exceeded.'])));
      else if (r < 0.73) socket.receive('not json');
      else if (r < 0.75) socket.receive(JSON.stringify({ type: 'response.audio.delta', item_id: answer, delta: 7 }));
      else if (r < 0.79) socket.receive(run.pick([SERVER.responseDone(), SERVER.bare('input_audio_buffer.committed'), SERVER.bare('input_audio_buffer.cleared'), SERVER.bare('session.finished'), SERVER.bare('something.new')]));
      else if (r < 0.84) socket.serverClose(run.pick([1000, 1007, 1011]), run.pick(['', 'Internal error', "Voice 'X' is not supported."]));
      else run.clock.advance(run.pick([200, 2_500, ERROR_WORDS_MS + 1_000]));
    },
  };

  // 300 lives, about a second alone: the bound is for a loaded machine.
  it('every life settles, ends clean, and leaves no timer, socket or send behind', async () => {
    const report = await runLifecycles(lifecycles, { seed: 20261013, runs: 300 });
    expect(report.failures).toEqual([]);
    // If one key stays at 0 with this seed, raise its draw's share rather than dropping the key.
    for (const key of [
      'refused', 'live', 'stopped', 'end.failed.connection_lost', 'end.failed.client', 'end.failed.server', 'opening.bound', 'opening.abort',
      'harness.drop', 'harness.silent', 'harness.refused', 'harness.close_1007', 'harness.unanswered', 'harness.created_only',
    ]) expect(report.stats[key] ?? 0, key).toBeGreaterThan(0);
  }, 20_000);
});

describe('the Qwen LiveTranslate adapter: the start (spec §6)', () => {
  it('registers a Bearer rule on the storefront the check found, then dials the model URL, framing header names alone', async () => {
    const h = startQwen();
    expect(h.seam.sockets.all).toEqual([]);
    await flush();
    expect(h.seam.registrations).toEqual([{ host: 'maas.qwencloudapi.com', path: '/api-ws/v1/', set: { Authorization: `Bearer ${KEY.apiKey}` }, remove: [], cleared: false }]);
    expect(h.socket().url).toBe('wss://maas.qwencloudapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
    expect(h.frames('session.headers')).toEqual([{ endpoint: 'intl', host: 'maas.qwencloudapi.com', path: '/api-ws/v1/', set: ['Authorization'] }]);
    expect(h.detected).toEqual([]);
    noSecret(h.log);
  });

  it('dials 千问云 for a mainland key', async () => {
    const h = startQwen({ shared: { ...SHARED, models: [{ id: 'cn' }] } });
    await flush();
    expect(h.socket().url).toBe('wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
  });

  it("sends nothing until session.created, then its one update; resolves on session.updated with nothing but frames and no timer but the keepalive's", async () => {
    const h = await openQwen();
    expect(h.sent()).toEqual([]);
    h.socket().receive(SERVER.created());
    expect(h.sent()).toEqual([sessionUpdate(h.config, { video: false })]);
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.updated());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.update')).toEqual([sessionUpdate(h.config, { video: false }).session]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(1);
  });

  it("refuses in Qwen's words an error before the update is confirmed, closing the socket", async () => {
    const h = await openQwen();
    h.socket().receive(SERVER.created());
    h.socket().receive(SERVER.error('invalid_value', 'Invalid translation parameter.'));
    await expect(h.starting).rejects.toEqual(new AdapterStartError('[Qwen invalid_value] Invalid translation parameter.', 'client'));
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a close before the update is confirmed refuses the start, in the words the close gave', async () => {
    const h = await openQwen();
    h.socket().receive(SERVER.created());
    h.socket().serverClose(1007, 'Invalid translation parameter.');
    await expect(h.starting).rejects.toEqual(new AdapterStartError('Qwen closed the connection before the session started (1007 Invalid translation parameter.).', 'client'));
  });

  it(`no answer within ${START_TIMEOUT_MS / 1000} s refuses — the server's fault once the socket opened — and closes the socket`, async () => {
    const h = await openQwen();
    h.clock.advance(START_TIMEOUT_MS);
    await expect(h.starting).rejects.toEqual(new AdapterStartError(`Qwen did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server'));
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    expect(h.timers()).toBe(0);
  });

  it('a socket that fails before it opens reads as the network, the rule cleared', async () => {
    const h = startQwen();
    await flush();
    h.socket().drop();
    await expect(h.starting).rejects.toMatchObject({ code: 'network', message: NEVER_OPENED });
    expect(h.seam.registrations[0].cleared).toBe(true);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a build that cannot set headers — the web — refuses in fixed words', async () => {
    const { clock } = trackedClock();
    const { events } = recordEvents();
    const unsupported = () => Promise.reject(new HeaderSocketError('unsupported', 'no platform'));
    const starting = createQwenAdapter({ openHeaderSocket: unsupported, detect: intl }).start({ context: AUTO_CTX, config: configFor(), credentials: KEY, clock, signal: new AbortController().signal }, events);
    await expect(starting).rejects.toEqual(new AdapterStartError('Qwen LiveTranslate needs the desktop app or the browser extension.', 'client'));
  });

  it('with no storefront from a check, finds it first — with the key, the clock and the signal — and dials it', async () => {
    let seen: Parameters<DetectEndpoint> | null = null;
    const h = startQwen({ shared: { ...SHARED, models: [] }, detect: async (...args) => { seen = args; return { endpoint: 'cn' }; } });
    await flush();
    expect(seen).not.toBeNull();
    const [apiKey, o] = seen as unknown as Parameters<DetectEndpoint>;
    expect(apiKey).toBe(KEY.apiKey);
    expect(o.signal).toBe(h.controller.signal);
    expect(o.clock).toBe(h.clock);
    expect(h.frames('session.detected')).toEqual([{ endpoint: 'cn' }]);
    expect(h.socket().url).toBe('wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
    noSecret(h.log);
  });

  it("a key neither storefront takes refuses the start in the check's words; a check that cannot tell refuses as the network", async () => {
    const refused = startQwen({ shared: { ...SHARED, models: [] }, detect: async () => ({ refused: 'Neither QwenCloud nor 千问云 accepted this key (HTTP 401).', code: 'auth' }) });
    await expect(refused.starting).rejects.toEqual(new AdapterStartError('Neither QwenCloud nor 千问云 accepted this key (HTTP 401).', 'auth'));
    expect(refused.seam.registrations).toEqual([]);
    const offline = startQwen({ shared: { ...SHARED, models: [] }, detect: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(offline.starting).rejects.toMatchObject({ code: 'network', message: 'Qwen did not answer the key check (check the network).' });
    expect(offline.seam.registrations).toEqual([]);
  });

  it('a stop while the storefront is still being found rejects with its reason: no rule, no socket, no timer', async () => {
    const h = startQwen({
      shared: { ...SHARED, models: [] },
      detect: (_apiKey, o) => new Promise((_resolve, reject) => { o.signal?.addEventListener('abort', () => reject(o.signal?.reason)); }),
    });
    await flush();
    h.controller.abort(new Error('stopped'));
    await expect(h.starting).rejects.toThrow('stopped');
    await flush();
    expect(h.seam.registrations).toEqual([]);
    expect(h.seam.sockets.all).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a found storefront that lands after a stop opens nothing', async () => {
    let land!: () => void;
    const h = startQwen({ shared: { ...SHARED, models: [] }, detect: () => new Promise((resolve) => { land = () => resolve({ endpoint: 'intl' }); }) });
    await flush();
    h.controller.abort(new Error('stopped'));
    land();
    await expect(h.starting).rejects.toThrow('stopped');
    await flush();
    expect(h.seam.registrations).toEqual([]);
    expect(h.seam.sockets.all).toEqual([]);
  });
});

describe('the Qwen LiveTranslate adapter: the session (spec §6)', () => {
  it('sends audio up as it came, with no frame per chunk', async () => {
    const h = await qwenSession();
    const before = h.of('frame').length;
    h.session.appendAudio(chunk(1_000));
    h.session.appendAudio(chunk(-3));
    expect(h.appended().map((p) => p[0])).toEqual([1_000, -3]);
    expect(h.of('frame').length).toBe(before);
  });

  it("turns one recorded turn into a source and its translation, stating their origin, the speech on the translation, its range once the speech is done; no person on my leg", async () => {
    const h = await qwenSession();
    for (const frame of turn(1, { source: '你好 ', translation: 'Hello. ' })) h.socket().receive(frame);
    expect(content(h.log)).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'item_h1' }],
      ['segmentText', { ref: 1, text: '你好' }],
      ['segmentOpened', { ref: 2, side: 'translation', origin: 'item_h1' }],
      ['segmentText', { ref: 2, text: 'Hello.' }],
      ['audio', { ref: 2, samples: 2_400 }],
      ['segmentClosed', { ref: 1 }],
      ['segmentClosed', { ref: 2 }],
      ['speechRanges', { ref: 2, ranges: [{ index: 0, range: [0, 6] }] }],
    ]);
    expect(h.frames('response.done')).toEqual([{ status: 'completed', usage: { total_tokens: 197, input_tokens: 96, output_tokens: 101 } }]);
  });

  it('labels both sides with the speaker on the participant leg (D7)', async () => {
    const h = await qwenSession({ context: PARTICIPANT_CTX });
    for (const frame of turn(1, { source: 'Hello', translation: '你好', speaker: 2 })) h.socket().receive(frame);
    const persons = h.content().filter((e) => e.kind === 'segmentOpened').map((e) => (e.payload as { person?: string }).person);
    expect(persons).toEqual(['2', '2']);
  });

  it('a leg that does not speak takes the text events and plays nothing', async () => {
    const h = await qwenSession({ context: TEXT_CTX });
    for (const frame of turn(1, { source: '你好', translation: 'Hello.', text: true })) h.socket().receive(frame);
    h.socket().receive(SERVER.audio('item_t1'));
    expect(h.of('audio')).toEqual([]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['你好', 'Hello.']);
  });

  it('push-to-talk: a release commits, and so does a cancel, never a clear — a short word the voice gate calls a cancel still shows (live test 2026-10-14: 对不对); automatic turns send neither', async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(types(h.socket()).slice(-1)).toEqual(['input_audio_buffer.commit']);
    h.socket().receive(SERVER.responseDone());
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.cancelTurn();
    expect(types(h.socket()).slice(-1)).toEqual(['input_audio_buffer.commit']);
    h.socket().receive(SERVER.heardItem('item_h2'));
    h.socket().receive(SERVER.answerItem('item_t2', 'item_h2'));
    h.socket().receive(SERVER.bare('input_audio_buffer.committed'));
    h.socket().receive(SERVER.sourceDone('item_h2', '对不对'));
    h.socket().receive(SERVER.transcriptDone('item_t2', 'そうですよね？'));
    h.socket().receive(SERVER.audio('item_t2'));
    h.socket().receive(SERVER.audioDone('item_t2'));
    h.socket().receive(SERVER.responseDone());
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['对不对', 'そうですよね？']);
    expect(h.of('audio')).toHaveLength(1);
    expect(types(h.socket())).not.toContain('input_audio_buffer.clear');

    const auto = await qwenSession();
    auto.session.endTurn();
    auto.session.cancelTurn();
    expect(types(auto.socket())).toEqual(['session.update']);
  });

  it('push-to-talk: a press while the turn before is still being finished is held, and goes up once its response is done, its release after it', async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk(1));
    h.session.endTurn();
    // Pressed again at once: the server would refuse this audio (probe 2026-10-14).
    h.session.beginTurn();
    h.session.appendAudio(chunk(2));
    h.session.appendAudio(chunk(3));
    h.session.endTurn();
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_audio_buffer.commit']);
    h.socket().receive(SERVER.responseDone());
    expect(types(h.socket()).slice(1)).toEqual([
      'input_audio_buffer.append', 'input_audio_buffer.commit',
      'input_audio_buffer.append', 'input_audio_buffer.append', 'input_audio_buffer.commit',
    ]);
    expect(h.appended().map((pcm) => pcm[0])).toEqual([1, 2, 3]);
    // A press during the held one's own turn waits again; once that is done, audio goes up as it comes.
    h.session.beginTurn();
    h.session.appendAudio(chunk(4));
    expect(h.appended()).toHaveLength(3);
    h.socket().receive(SERVER.responseDone());
    h.session.appendAudio(chunk(5));
    expect(h.appended().map((pcm) => pcm[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it('push-to-talk: a cancel of a press held behind the turn ahead is a release too: the press goes up once that turn is done, its commit after it, and the turn ahead still lands whole', async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    h.socket().receive(SERVER.heardItem('item_h1'));
    h.socket().receive(SERVER.sourceDelta('item_h1', 'first'));
    h.session.beginTurn();
    h.session.appendAudio(chunk(1));
    h.session.endTurn();
    h.session.beginTurn();
    h.session.appendAudio(chunk(2));
    h.session.cancelTurn();
    h.socket().receive(SERVER.answerItem('item_t1', 'item_h1'));
    h.socket().receive(SERVER.transcriptDone('item_t1', 'First.'));
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_audio_buffer.commit']);
    h.socket().receive(SERVER.responseDone());
    expect(types(h.socket()).slice(1)).toEqual([
      'input_audio_buffer.append', 'input_audio_buffer.commit', 'input_audio_buffer.append', 'input_audio_buffer.commit',
    ]);
    expect(h.appended().map((pcm) => pcm[0])).toEqual([1, 2]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['first', 'First.']);
  });

  it('push-to-talk: no commit for a release or a cancel with nothing appended since the last commit — the server would refuse every later append', async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.endTurn();
    h.session.beginTurn();
    h.session.cancelTurn();
    expect(types(h.socket())).toEqual(['session.update']);
  });

  it(`push-to-talk: a turn whose response never ends is let go after ${TURN_DONE_MS / 1000} s, and the held press goes up; stop leaves no timer`, async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk(1));
    h.session.endTurn();
    h.session.beginTurn();
    h.session.appendAudio(chunk(2));
    h.clock.advance(TURN_DONE_MS - 1);
    expect(h.appended()).toHaveLength(1);
    h.clock.advance(1);
    expect(h.appended().map((pcm) => pcm[0])).toEqual([1, 2]);
    expect(h.frames('session.turn_timeout')).toHaveLength(1);
    h.session.endTurn();
    await h.session.stop();
    expect(h.timers()).toBe(0);
  });

  it(`a quiet leg under automatic turns — a muted source sends nothing — appends 100 ms of silence once nothing has gone up for ${KEEPALIVE_IDLE_MS / 1000} s, framed; audio going up keeps it quiet, and stop leaves no timer`, async () => {
    const h = await qwenSession();
    for (let i = 0; i < 4; i++) {
      h.clock.advance(60_000);
      h.session.appendAudio(chunk(1));
    }
    expect(h.appended()).toHaveLength(4);
    expect(h.frames('session.keepalive')).toEqual([]);
    // Muted from here: the look after the threshold sends the keepalive, at most a look late.
    h.clock.advance(KEEPALIVE_IDLE_MS - KEEPALIVE_CHECK_MS);
    expect(h.appended()).toHaveLength(4);
    h.clock.advance(KEEPALIVE_CHECK_MS);
    expect(h.appended()).toHaveLength(5);
    expect(h.appended()[4]).toEqual(new Int16Array(SAMPLE_RATE / 10));
    expect(types(h.socket())).not.toContain('input_audio_buffer.commit');
    expect(h.frames('session.keepalive')).toEqual([{ idleMs: KEEPALIVE_IDLE_MS }]);
    // Still quiet: another one a threshold later, and nothing reaches the segments.
    h.clock.advance(KEEPALIVE_IDLE_MS);
    expect(h.appended()).toHaveLength(6);
    expect(h.content()).toEqual([]);
    await h.session.stop();
    expect(h.timers()).toBe(0);
  });

  it(`push-to-talk: a quiet leg commits a turn of 100 ms of silence — an append alone is closed 60 s later (probe 2026-10-16) — and a press during it waits for its response`, async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    h.clock.advance(KEEPALIVE_IDLE_MS);
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_audio_buffer.commit']);
    expect(h.appended()).toEqual([new Int16Array(SAMPLE_RATE / 10)]);
    expect(h.frames('session.keepalive')).toEqual([{ idleMs: KEEPALIVE_IDLE_MS }]);
    h.session.beginTurn();
    h.session.appendAudio(chunk(7));
    h.session.endTurn();
    expect(h.appended()).toHaveLength(1);
    h.socket().receive(SERVER.responseDone());
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_audio_buffer.commit', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
    expect(h.appended().map((pcm) => pcm[0])).toEqual([0, 7]);
  });

  it('push-to-talk: a press held with nothing left to send — its quiet allowance spent, or a muted source — still gets the keepalive, or Qwen would close the session; voice after it waits for that turn', async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    const kept = Math.floor((SAMPLE_RATE * QUIET_KEEP_MS) / 1000 / 2_048);
    h.session.beginTurn();
    for (let i = 1; i <= kept + 1; i++) h.session.appendAudio(chunk(i));
    h.socket().receive(SERVER.responseDone());
    // Still held, in silence: every chunk is kept back, so nothing goes up.
    for (let s = 0; s < KEEPALIVE_IDLE_MS / 10_000; s++) {
      h.clock.advance(10_000);
      h.session.appendAudio(chunk(7));
    }
    expect(h.frames('session.keepalive')).toEqual([{ idleMs: KEEPALIVE_IDLE_MS }]);
    expect(h.appended()[kept]).toEqual(new Int16Array(SAMPLE_RATE / 10));
    h.session.appendAudio(chunk(1_000));
    expect(h.appended()).toHaveLength(kept + 1);
    h.socket().receive(SERVER.responseDone());
    expect(h.appended().slice(kept).map((pcm) => pcm[0])).toEqual([0, 7, 7, 7, 7, 1_000]);
    h.session.endTurn();
    expect(types(h.socket()).filter((t) => t === 'input_audio_buffer.commit')).toHaveLength(3);
  });

  it('push-to-talk: no keepalive cuts into a press with audio waiting to be committed; its release restarts the wait', async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk(1));
    h.clock.advance(KEEPALIVE_IDLE_MS);
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append']);
    h.session.endTurn();
    h.socket().receive(SERVER.responseDone());
    h.clock.advance(KEEPALIVE_IDLE_MS - KEEPALIVE_CHECK_MS);
    expect(h.frames('session.keepalive')).toEqual([]);
    h.clock.advance(KEEPALIVE_CHECK_MS);
    expect(h.frames('session.keepalive')).toEqual([{ idleMs: KEEPALIVE_IDLE_MS }]);
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_audio_buffer.commit', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
  });

  it("push-to-talk: a commit the leg did not send is the server cutting a long press (every ~30 s of audio, probe 2026-10-16): the press waits for that turn's response and goes on, and a release meanwhile commits after it", async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk(1_001));
    h.socket().receive(SERVER.committed('item_h1'));
    expect(h.frames('session.server_cut')).toHaveLength(1);
    // The server refuses audio until the cut turn is done: it waits here instead.
    h.session.appendAudio(chunk(1_002));
    expect(h.appended().map((pcm) => pcm[0])).toEqual([1_001]);
    h.socket().receive(SERVER.responseDone());
    expect(h.appended().map((pcm) => pcm[0])).toEqual([1_001, 1_002]);
    expect(types(h.socket())).not.toContain('input_audio_buffer.commit');
    // A second cut, and the key let go while its turn is finishing: the release commits once what waited has gone up.
    h.socket().receive(SERVER.committed('item_h2'));
    h.session.appendAudio(chunk(1_003));
    h.session.endTurn();
    expect(types(h.socket())).not.toContain('input_audio_buffer.commit');
    h.socket().receive(SERVER.responseDone());
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_audio_buffer.append', 'input_audio_buffer.append', 'input_audio_buffer.commit']);
    // The acknowledgement of the leg's own commit is no cut.
    h.socket().receive(SERVER.committed('item_h3'));
    expect(h.frames('session.server_cut')).toHaveLength(2);
  });

  it(`push-to-talk: a quiet stretch inside a press goes up for ${QUIET_KEEP_MS / 1000} s, then its turn is committed and nothing more is sent — the server closes a session past ~30 s of audio with no speech (probe 2026-10-16) — until voice comes back, ${PRE_ROLL_MS} ms of the quiet ahead of it`, async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    const quiet = (n: number) => chunk(n);
    const kept = Math.floor((SAMPLE_RATE * QUIET_KEEP_MS) / 1000 / 2_048);
    h.session.beginTurn();
    h.session.appendAudio(chunk(1_000));
    for (let i = 1; i <= kept + 20; i++) h.session.appendAudio(quiet(i));
    expect(h.appended().map((pcm) => pcm[0])).toEqual([1_000, ...Array.from({ length: kept }, (_, i) => i + 1)]);
    expect(types(h.socket()).slice(1).filter((t) => t === 'input_audio_buffer.commit')).toHaveLength(1);
    h.socket().receive(SERVER.responseDone());
    h.session.appendAudio(chunk(1_500));
    const preRoll = Math.ceil((SAMPLE_RATE * PRE_ROLL_MS) / 1000 / 2_048);
    expect(h.appended().slice(kept + 1).map((pcm) => pcm[0])).toEqual([...Array.from({ length: preRoll }, (_, i) => kept + 20 - preRoll + 1 + i), 1_500]);
    h.session.endTurn();
    expect(types(h.socket()).slice(1).filter((t) => t === 'input_audio_buffer.commit')).toHaveLength(2);
  });

  it(`push-to-talk: a press held in silence sends ${QUIET_KEEP_MS / 1000} s of it and one commit, however long it is held; its release commits nothing more`, async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    const kept = Math.floor((SAMPLE_RATE * QUIET_KEEP_MS) / 1000 / 2_048);
    h.session.beginTurn();
    for (let i = 1; i <= kept * 10; i++) h.session.appendAudio(chunk(i % 300));
    h.socket().receive(SERVER.responseDone());
    h.session.endTurn();
    expect(h.appended()).toHaveLength(kept);
    expect(types(h.socket()).slice(1).filter((t) => t === 'input_audio_buffer.commit')).toHaveLength(1);
  });

  it(`push-to-talk: the ${QUIET_KEEP_MS / 1000} s of quiet are counted across presses until voice — the server's count runs on across turns — so more silent presses send nothing, and voice starts the count afresh`, async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    const kept = Math.floor((SAMPLE_RATE * QUIET_KEEP_MS) / 1000 / 2_048);
    const commits = () => types(h.socket()).filter((t) => t === 'input_audio_buffer.commit');
    const press = (fills: number[]) => {
      h.session.beginTurn();
      for (const fill of fills) h.session.appendAudio(chunk(fill));
      h.session.endTurn();
      h.socket().receive(SERVER.responseDone());
    };
    press(Array.from({ length: kept + 5 }, (_, i) => i % 300));
    expect(h.appended()).toHaveLength(kept);
    expect(commits()).toHaveLength(1);
    for (let n = 0; n < 15; n++) press([1, 2, 3, 4, 5]);
    expect(h.appended()).toHaveLength(kept);
    expect(commits()).toHaveLength(1);
    // Voice: only this press's own quiet goes ahead of it.
    press([11, 1_000]);
    expect(h.appended().slice(kept).map((pcm) => pcm[0])).toEqual([11, 1_000]);
    expect(commits()).toHaveLength(2);
    press(Array.from({ length: kept + 5 }, (_, i) => i % 300));
    expect(h.appended()).toHaveLength(kept + 2 + kept);
    expect(commits()).toHaveLength(3);
  });

  it('push-to-talk: a quiet stretch that runs past the threshold while the turn before is still finishing commits once what waits behind that turn has gone up', async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    const kept = Math.floor((SAMPLE_RATE * QUIET_KEEP_MS) / 1000 / 2_048);
    h.session.beginTurn();
    h.session.appendAudio(chunk(1_000));
    h.session.endTurn();
    h.session.beginTurn();
    h.session.appendAudio(chunk(1_001));
    for (let i = 1; i <= kept + 5; i++) h.session.appendAudio(chunk(i));
    expect(types(h.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_audio_buffer.commit']);
    h.socket().receive(SERVER.responseDone());
    expect(h.appended().map((pcm) => pcm[0])).toEqual([1_000, 1_001, ...Array.from({ length: kept }, (_, i) => i + 1)]);
    expect(types(h.socket()).slice(-1)).toEqual(['input_audio_buffer.commit']);
    expect(types(h.socket()).filter((t) => t === 'input_audio_buffer.commit')).toHaveLength(2);
  });

  it('push-to-talk: a heard item its content does not mark is told by what it follows — nothing, or the last translation — so its words still show', async () => {
    const h = await qwenSession({ context: MANUAL_CTX });
    // No speech start under push-to-talk, and no recording confirms the heard item's content entry: here it has none.
    const item = (id: string, previous?: string) => JSON.stringify({ type: 'conversation.item.created', ...(previous ? { previous_item_id: previous } : {}), item: { id, type: 'message', role: 'assistant', content: [] } });
    h.socket().receive(item('item_h1'));
    h.socket().receive(SERVER.sourceDelta('item_h1', 'first'));
    h.socket().receive(SERVER.answerItem('item_t1', 'item_h1'));
    h.socket().receive(SERVER.transcriptDelta('item_t1', 'First.'));
    h.socket().receive(item('item_h2', 'item_t1'));
    h.socket().receive(SERVER.sourceDelta('item_h2', 'second'));
    h.socket().receive(SERVER.answerItem('item_t2', 'item_h2'));
    h.socket().receive(SERVER.transcriptDelta('item_t2', 'Second.'));
    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([
      ['source', 'item_h1'], ['translation', 'item_h1'], ['source', 'item_h2'], ['translation', 'item_h2'],
    ]);
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['first', 'First.', 'second', 'Second.']);
  });

  it("a mid-session error words the close that follows it, once; the leg fails and says nothing after", async () => {
    const h = await qwenSession();
    h.socket().receive(SERVER.error('COMMON_ERROR', "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported."));
    expect(h.of('failed')).toEqual([]);
    h.socket().serverClose(1007, "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported.");
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'client', message: "[Qwen COMMON_ERROR] <400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported." }]);
    expect(h.timers()).toBe(0);
    noSecret(h.log);
  });

  it('a close with words and no error fails in its words; a close with none is the lost connection (D8); an old error words neither', async () => {
    const worded = await qwenSession();
    worded.socket().serverClose(1011, 'Internal error');
    await flush();
    expect(worded.of('failed').map((e) => e.payload)).toEqual([{ code: 'server', message: '[Qwen] Internal error' }]);

    const bare = await qwenSession();
    bare.socket().serverClose(1000);
    await flush();
    expect(bare.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: CONNECTION_LOST }]);

    const stale = await qwenSession();
    stale.socket().receive(SERVER.error('Throttling', 'Requests rate limit exceeded.'));
    stale.clock.advance(ERROR_WORDS_MS + 1);
    stale.socket().serverClose(1000);
    await flush();
    expect(stale.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: CONNECTION_LOST }]);
  });

  it('a frame that will not read is degraded once until one reads again; an audio delta with no base64 is its own episode', async () => {
    const h = await qwenSession();
    h.socket().receive('not json');
    h.socket().receive('still not json');
    h.socket().receive(SERVER.bare('response.created'));
    h.socket().receive('not json again');
    h.socket().receive(JSON.stringify({ type: 'response.audio.delta', item_id: 'item_t1', delta: 7 }));
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error', 'parse_error']);
    expect(h.of('failed')).toEqual([]);
  });

  it('stop sends session.finish and closes before it awaits anything; nothing follows, and a second stop is harmless', async () => {
    const h = await qwenSession();
    const stopping = h.session.stop();
    expect(types(h.socket())).toEqual(['session.update', 'session.finish']);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    await h.session.stop();
    expect(types(h.socket())).toEqual(['session.update', 'session.finish']);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });
});

describe('the Qwen LiveTranslate adapter: a managed leg (spec §4)', () => {
  const SESSION = 'sess_DQE8tkefuVBLmm4BCkinn';
  const REQUEST = '6c862ba2-2beb-9263-b94a-e6789bdd25bf';
  // No storefront from a check: the grant's is the only one to dial.
  const NO_STOREFRONT = { ...SHARED, models: [] };
  const managed = () => {
    const calls: [string, string | undefined][] = [];
    const credentials: QwenCredentials = { apiKey: 'st-token', endpoint: 'intl', lease: { sessionCreated: (id, requestId) => { calls.push([id, requestId]); } } };
    return { calls, credentials };
  };

  it("a managed leg dials the grant's storefront without detecting", async () => {
    const { credentials } = managed();
    const h = startQwen({ credentials, shared: NO_STOREFRONT });
    await flush();
    expect(h.detected).toEqual([]);
    expect(h.socket().url).toBe('wss://maas.qwencloudapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
  });

  it("reports the session id and the handshake's request id, once", async () => {
    const { calls, credentials } = managed();
    const h = await openQwen({ credentials, shared: NO_STOREFRONT, requestIds: [REQUEST] });
    h.socket().receive(SERVER.created(SESSION));
    await flush();
    h.socket().receive(SERVER.updated());
    await h.starting;
    expect(calls).toEqual([[SESSION, REQUEST]]);
  });

  it('reports without a request id when the seam has none', async () => {
    const { calls, credentials } = managed();
    const h = await openQwen({ credentials, shared: NO_STOREFRONT });
    h.socket().receive(SERVER.created(SESSION));
    await flush();
    expect(calls).toEqual([[SESSION, undefined]]);
  });

  it('waits for the request id when session.created comes first, and still reports once', async () => {
    const { calls, credentials } = managed();
    const h = startQwen({ credentials, shared: NO_STOREFRONT, requestIds: [REQUEST], holdClear: true });
    await flush();
    h.socket().open();
    await flush();
    h.socket().receive(SERVER.created(SESSION));
    await flush();
    expect(calls).toEqual([]);
    h.releaseClear();
    await flush();
    expect(calls).toEqual([[SESSION, REQUEST]]);
    h.socket().receive(SERVER.created(SESSION));
    h.socket().receive(SERVER.updated());
    await h.starting;
    expect(calls).toHaveLength(1);
  });

  it('reports nothing for a socket that closes before session.created', async () => {
    const { calls, credentials } = managed();
    const h = await openQwen({ credentials, shared: NO_STOREFRONT, requestIds: [REQUEST] });
    h.socket().serverClose(1011, 'Internal error');
    await expect(h.starting).rejects.toBeInstanceOf(AdapterStartError);
    await flush();
    expect(calls).toEqual([]);
  });

  it('reports nothing when the leg stops after session.created and before the request id lands', async () => {
    const { calls, credentials } = managed();
    const h = startQwen({ credentials, shared: NO_STOREFRONT, requestIds: [REQUEST], holdClear: true });
    await flush();
    h.socket().open();
    await flush();
    h.socket().receive(SERVER.created(SESSION));
    h.socket().receive(SERVER.updated());
    const session = await h.starting;
    await session.stop();
    h.releaseClear();
    await flush();
    expect(calls).toEqual([]);
  });

  it("two legs through one seam each report their own session and request id, never the other's", async () => {
    const A = '11111111-2222-3333-4444-555555555555';
    const B = '66666666-7777-8888-9999-000000000000';
    const seam = fakeHeaderSockets(undefined, { requestIds: [A, B] });
    const calls: [string, string, string | undefined][] = [];
    const leg = (name: string) => {
      const credentials: QwenCredentials = { apiKey: 'st-token', endpoint: 'intl', lease: { sessionCreated: (id, requestId) => { calls.push([name, id, requestId]); } } };
      const { clock } = trackedClock();
      const { events } = recordEvents();
      const config = configFor(AUTO_CTX, undefined, NO_STOREFRONT);
      return createQwenAdapter({ openHeaderSocket: seam.open, detect: async () => ({ endpoint: 'intl' }) })
        .start({ context: AUTO_CTX, config, credentials, clock, signal: new AbortController().signal }, events);
    };
    void leg('speaker');
    await flush();
    seam.sockets.last().open();
    await flush();
    void leg('participant');
    await flush();
    seam.sockets.last().open();
    await flush();
    const [first, second] = seam.sockets.all;
    first.receive(SERVER.created('sess_AAAAAAAAAA'));
    second.receive(SERVER.created('sess_BBBBBBBBBB'));
    await flush();
    expect(calls).toEqual([['speaker', 'sess_AAAAAAAAAA', A], ['participant', 'sess_BBBBBBBBBB', B]]);
  });

  it("words a managed leg's socket that never opened without an API key", async () => {
    const { credentials } = managed();
    const h = startQwen({ credentials, shared: NO_STOREFRONT });
    await flush();
    h.socket().drop();
    const error = await h.starting.then(() => null, (e: unknown) => e as Error);
    expect(error).toMatchObject({ code: 'network' });
    expect(error!.message).not.toMatch(/API key/);
    expect(error!.message).toMatch(/session token/);
  });

  it('is not broken by a lease that throws', async () => {
    const credentials: QwenCredentials = { apiKey: 'st-token', endpoint: 'intl', lease: { sessionCreated: () => { throw new Error('lease down'); } } };
    const h = await openQwen({ credentials, shared: NO_STOREFRONT, requestIds: [REQUEST] });
    h.socket().receive(SERVER.created(SESSION));
    h.socket().receive(SERVER.updated());
    await h.starting;
    expect(h.of('failed')).toEqual([]);
  });

  it('an own key runs as today: detection, and no lease to tell', async () => {
    const h = await qwenSession({ shared: NO_STOREFRONT, requestIds: [REQUEST] });
    expect(h.detected).toEqual([KEY.apiKey]);
  });
});


describe('the Qwen LiveTranslate adapter: screen context (spec 2026-10-22)', () => {
  it('without a source never declares video and never sends an image, however much audio goes up', async () => {
    const h = await qwenSession();
    expect(h.sent().find((m) => m.type === 'session.update')!.session).not.toHaveProperty('input_modalities');
    h.session.appendAudio(chunk()); h.session.appendAudio(chunk());
    expect(types(h.socket())).not.toContain('input_image_buffer.append');
  });

  it('with a source declares video, and sends the frame in hand right after the first audio chunk, once, framed with its size and reason', async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const h = await qwenSession({ frames: src });
    expect(h.sent().find((m) => m.type === 'session.update')!.session).toHaveProperty('input_modalities', ['audio', 'video']);
    expect(types(h.socket())).not.toContain('input_image_buffer.append'); // nothing before audio
    h.session.appendAudio(chunk());
    expect(types(h.socket()).slice(-2)).toEqual(['input_audio_buffer.append', 'input_image_buffer.append']);
    h.session.appendAudio(chunk());
    expect(types(h.socket()).filter((t) => t === 'input_image_buffer.append')).toHaveLength(1);
    expect(h.frames('input_image_buffer.append')).toEqual([{ bytes: 3, reason: 'first' }]);
    noSecret(h.log);
  });

  it('puts the frame on the wire as base64 of its bytes, and the image itself in no frame of the log', async () => {
    const h = await qwenSession({ frames: fakeFrameSource({ inHand: JPEG_A }) });
    h.session.appendAudio(chunk());
    const image = h.sent().find((m) => m.type === 'input_image_buffer.append')!;
    expect(Array.from(Uint8Array.from(atob(image.image as string), (c) => c.charCodeAt(0)))).toEqual(Array.from(JPEG_A));
    expect(JSON.stringify(h.of('frame').map((e) => e.payload))).not.toContain(image.image as string);
  });

  it('a frame that arrives after the first audio went is sent at once; one that arrives before it waits for that audio', async () => {
    const src = fakeFrameSource({ inHand: null });
    const h = await qwenSession({ frames: src });
    src.emit(JPEG_A, 'first');
    expect(types(h.socket())).not.toContain('input_image_buffer.append');
    h.session.appendAudio(chunk());
    expect(types(h.socket()).slice(-1)).toEqual(['input_image_buffer.append']);
    src.emit(JPEG_B);
    expect(h.frames('input_image_buffer.append')).toEqual([{ bytes: 3, reason: 'first' }, { bytes: 3, reason: 'changed' }]);
  });

  it('of several frames that arrive before the audio, only the newest goes, after it', async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const h = await qwenSession({ frames: src });
    src.emit(JPEG_B, 'changed');
    h.session.appendAudio(chunk());
    expect(h.frames('input_image_buffer.append')).toEqual([{ bytes: 3, reason: 'changed' }]);
    const image = h.sent().find((m) => m.type === 'input_image_buffer.append')!;
    expect(atob(image.image as string).charCodeAt(2)).toBe(JPEG_B[2]);
  });

  it('a frame that arrives while the leg is still opening waits for the audio too', async () => {
    const src = fakeFrameSource({ inHand: null });
    const h = await openQwen({ frames: src });
    src.emit(JPEG_A, 'first');
    h.socket().receive(SERVER.created());
    src.emit(JPEG_B);
    h.socket().receive(SERVER.updated());
    const session = await h.starting;
    expect(types(h.socket())).toEqual(['session.update']);
    session.appendAudio(chunk());
    expect(types(h.socket())).toEqual(['session.update', 'input_audio_buffer.append', 'input_image_buffer.append']);
    expect(h.frames('input_image_buffer.append')).toEqual([{ bytes: 3, reason: 'changed' }]);
  });

  it("push-to-talk: the first press's first chunk is the audio the first frame follows", async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const h = await qwenSession({ context: MANUAL_CTX, frames: src });
    h.session.beginTurn(); h.session.appendAudio(chunk());
    expect(types(h.socket()).slice(-2)).toEqual(['input_audio_buffer.append', 'input_image_buffer.append']);
  });

  it('push-to-talk: a press held behind a turn the server cut goes up with the frame after it, ahead of its release', async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const h = await qwenSession({ context: MANUAL_CTX, frames: src });
    // The server closes a turn the leg sent no audio to: the press waits for its `response.done`, and its audio is the first to go.
    h.socket().receive(SERVER.committed('item_h0'));
    h.session.beginTurn(); h.session.appendAudio(chunk(7)); h.session.endTurn();
    expect(types(h.socket())).toEqual(['session.update']);
    h.socket().receive(SERVER.responseDone());
    expect(types(h.socket())).toEqual(['session.update', 'input_audio_buffer.append', 'input_image_buffer.append', 'input_audio_buffer.commit']);
    expect(h.frames('input_image_buffer.append')).toEqual([{ bytes: 3, reason: 'first' }]);
  });

  it("a leg whose first audio is the keepalive's sends the frame in hand after it, once — ahead of the keepalive turn's commit under push-to-talk", async () => {
    const auto = await qwenSession({ frames: fakeFrameSource({ inHand: JPEG_A }) });
    auto.clock.advance(KEEPALIVE_IDLE_MS);
    expect(types(auto.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_image_buffer.append']);
    auto.session.appendAudio(chunk());
    expect(auto.frames('input_image_buffer.append')).toHaveLength(1);
    const manual = await qwenSession({ context: MANUAL_CTX, frames: fakeFrameSource({ inHand: JPEG_A }) });
    manual.clock.advance(KEEPALIVE_IDLE_MS);
    expect(types(manual.socket()).slice(1)).toEqual(['input_audio_buffer.append', 'input_image_buffer.append', 'input_audio_buffer.commit']);
  });

  it('a lost source degrades the leg once with screen_context_lost, its return is framed, and a second loss degrades again', async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const h = await qwenSession({ frames: src });
    src.lose(); src.lose();
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['screen_context_lost']);
    expect(h.of('degraded')[0].payload.message).toBe('The chosen screen is no longer available; translation continues on audio alone.');
    src.back();
    expect(h.of('frame').map((e) => e.payload.type)).toContain('session.screen_context_back');
    src.lose();
    expect(h.of('degraded')).toHaveLength(2);
  });

  it("never puts the source's name into an event of the log", async () => {
    const src = fakeFrameSource({ name: 'Quarterly results — Confidential.xlsx', inHand: JPEG_A });
    const h = await qwenSession({ frames: src });
    h.session.appendAudio(chunk());
    src.lose(); src.back();
    expect(JSON.stringify(h.log, (_k, v: unknown) => (v instanceof Int16Array ? 'pcm' : v))).not.toContain('Confidential');
  });

  it('stop unsubscribes: a frame after stop sends nothing and says nothing; a start that fails unsubscribes too', async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const h = await qwenSession({ frames: src });
    await h.session.stop();
    expect(src.subscribers).toBe(0);
    const before = h.log.length; src.emit(JPEG_B);
    expect(h.log).toHaveLength(before);
    const failing = fakeFrameSource();
    const f = await openQwen({ frames: failing });
    expect(failing.subscribers).toBe(1);
    f.socket().receive(SERVER.created());
    f.socket().receive(SERVER.error('invalid_value', 'Invalid translation parameter.'));
    await expect(f.starting).rejects.toBeInstanceOf(AdapterStartError);
    expect(failing.subscribers).toBe(0);
  });

  it('an aborted start unsubscribes', async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const h = await openQwen({ frames: src });
    expect(src.subscribers).toBe(1);
    h.controller.abort(new Error('stopped'));
    await expect(h.starting).rejects.toThrow('stopped');
    expect(src.subscribers).toBe(0);
  });

  it('a source that ignores its unsubscribe is still heard by nobody once the leg has ended', async () => {
    type OnFrame = (jpeg: Uint8Array, reason: FrameReason) => void;
    let handlers: { onFrame: OnFrame; onLost: () => void; onBack: () => void } | null = null;
    const stubborn: FrameSource = {
      name: 'Stubborn',
      kind: 'window',
      subscribe: (onFrame, onLost, onBack) => { handlers = { onFrame, onLost, onBack }; return () => {}; },
    };
    const h = await qwenSession({ frames: stubborn });
    h.session.appendAudio(chunk());
    await h.session.stop();
    const before = { log: h.log.length, sent: h.sent().length };
    handlers!.onFrame(JPEG_B, 'changed'); handlers!.onLost(); handlers!.onBack();
    expect(h.log).toHaveLength(before.log);
    expect(h.sent()).toHaveLength(before.sent);
  });

  it('runs every conformance scenario with a source that keeps emitting, and leaves no subscriber behind', async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const base = harness();
    const emit: ScenarioStep = { run: () => src.emit(JPEG_B) };
    const withFrames: AdapterHarness<QwenConfig, QwenCredentials> = {
      ...base,
      frames: src,
      // A frame while the session is still opening, then audio around the exchange with a frame before and after it.
      opening: (name) => [...base.opening(name).slice(0, 2), emit, ...base.opening(name).slice(2)],
      exchange: [{ audio: 100 }, emit, ...base.exchange, emit],
    };
    for (const name of scenarioNames(withFrames)) {
      const report = await runScenario(withFrames, name);
      expect(report.violations, name).toEqual([]);
      expect(report.problems, name).toEqual([]);
    }
    expect(src.subscribers).toBe(0);
  });

  it('a frame, a loss and a return after the driver has stopped the session add nothing to its log', async () => {
    const src = fakeFrameSource({ inHand: JPEG_A });
    const base = harness();
    const r = await driveAdapter(base.adapter, {
      context: AUTO_CTX, config: base.config(AUTO_CTX, 'open-stop'), credentials: KEY, frames: src,
      opening: base.opening('open-stop'),
      steps: [{ audio: 100 }, { stop: true }, { run: () => { src.emit(JPEG_B); src.lose(); src.back(); } }, { flush: true }],
    });
    expect(r.violations).toEqual([]);
    expect(src.subscribers).toBe(0);
    const images = r.log.filter((e) => e.kind === 'frame' && e.payload.type === 'input_image_buffer.append');
    expect(images.map((e) => e.kind === 'frame' && e.payload.payload)).toEqual([{ bytes: 3, reason: 'first' }]);
    const stopped = r.log.findIndex((e) => e.kind === 'marker' && e.payload === 'stopped');
    expect(stopped).toBeGreaterThan(-1);
    expect(r.log.slice(stopped + 1)).toEqual([]);
  });
});
