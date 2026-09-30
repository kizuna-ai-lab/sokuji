/**
 * OpenAI Live's adapter: the conformance suite and the seeded lifecycles,
 * the start over the header seam and its refusals in words, the audio going
 * up, push-to-talk, the messages to segments and frames, the watchdog, the
 * reconnect and the ends, stop. On the header seam's fake, `FakeSocket`s and
 * a virtual clock — no network, no fake timers.
 */
import { describe, it, expect } from 'vitest';
import { AdapterStartError } from '../../lib/contract/adapter';
import type { AdapterEvent } from '../../lib/contract/events';
import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import { fakeHeaderSockets } from '../../lib/contract/testing/headerSocket';
import { runLifecycles, type LifecycleHarness } from '../../lib/contract/testing/lifecycle';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { recordEvents } from '../../lib/contract/events';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import {
  CONNECTION_LOST, createLiveAdapter, ERROR_WORDS_MS, NEVER_OPENED, RECONNECT_GRACE_MS, STALL_VOICED_SAMPLES, START_TIMEOUT_MS,
} from './adapter';
import type { LiveConfig } from './config';
import type { LiveCredentials } from './settings';
import { AUTO_CTX, configFor, KEY, liveSession, MANUAL_CTX, openLive, SERVER, startLive } from './testing';
import { LIVE_WS_URL, sessionStart } from './wire';

/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = (fill = 1_000) => new Int16Array(2_048).fill(fill);
/** What no event, failure or refusal may carry: the key, and the header it rides in. */
const SECRETS = [KEY.apiKey, 'Bearer'];
const noSecret = (value: unknown) => {
  const text = JSON.stringify(value, (_k, v: unknown) => (v instanceof Int16Array ? `pcm(${v.length})` : v instanceof Error ? v.message : v));
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};
const kinds = (log: readonly AdapterEvent[]) => log.filter((e) => e.kind !== 'frame').map((e) => e.kind);

function harness(): AdapterHarness<LiveConfig, LiveCredentials> {
  let seam = fakeHeaderSockets();
  const last = () => seam.sockets.last();
  const reply = (frame: () => string): ScenarioStep => ({ run: () => last().receive(frame()) });
  return {
    adapter: createLiveAdapter({ openHeaderSocket: (url, headers, o) => seam.open(url, headers, o) }),
    config: (context) => { seam = fakeHeaderSockets(); return configFor(context); },
    credentials: KEY,
    // The registration answers first; the socket exists only then.
    opening: () => [{ flush: true }, { run: () => last().open() }, { flush: true }, reply(SERVER.started), { flush: true }],
    exchange: [
      reply(() => SERVER.input('你好', 0, 200)),
      reply(() => SERVER.output('Hello.', 0, 200)),
      reply(() => SERVER.audio()),
      { advance: 5_000 },
    ],
    // The server drops the session; the one attempt's socket drops before it opens: the leg fails.
    serverClose: [
      { run: () => last().serverClose(1011, 'Internal error') }, { flush: true },
      { run: () => { if (last().readyState === FakeSocket.CONNECTING) last().drop(); } }, { flush: true },
    ],
    refuse: [{ flush: true }, { run: () => last().drop() }, { flush: true }],
    reconnect: [
      { run: () => last().serverClose(1011, 'Internal error') }, { flush: true },
      { run: () => last().open() }, { flush: true },
      reply(SERVER.started), { flush: true },
    ],
  };
}

describe('the OpenAI Live adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but typed text, which Live takes none of', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close', 'reconnect']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the OpenAI Live adapter: the seeded lifecycles', () => {
  const lifecycles: LifecycleHarness<LiveConfig, LiveCredentials> = {
    adapter: (run) => createLiveAdapter({ openHeaderSocket: fakeHeaderSockets(run.sockets).open }),
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
      if (r < 0.1) { run.count('harness.forbidden'); return socket.receive(SERVER.forbidden()); }
      if (r < 0.12) { run.count('harness.closed'); return socket.receive(SERVER.closed('remote_hangup')); }
      if (r < 0.14) { run.count('harness.close_1011'); return socket.serverClose(1011); }
      // Opened, and no answer yet: the kit may abort mid-handshake, else the start's bound runs out.
      if (r < 0.3) { run.count('harness.unanswered'); return; }
      socket.receive(SERVER.started());
    },
    server: async (run) => {
      const socket = run.sockets.all[run.sockets.all.length - 1];
      if (!socket) return;
      // A reconnect's attempt: its registration answered, its socket connecting.
      if (socket.readyState === FakeSocket.CONNECTING) {
        if (run.rand() < 0.8) {
          socket.open();
          await flush();
          if (run.rand() < 0.9) { run.count('harness.reconnected'); socket.receive(SERVER.started(`live_${run.index}`)); }
          else socket.receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
        } else socket.drop();
        return;
      }
      if (socket.readyState !== FakeSocket.OPEN) return;
      const r = run.rand();
      const at = Math.floor(run.rand() * 60) * 200;
      if (r < 0.15) socket.receive(SERVER.input(run.pick(['你好', ',老板', '好', '。']), at, at + 200));
      else if (r < 0.3) socket.receive(SERVER.output(run.pick(['Hello', ' there.', '.', 'The', ' owner,']), at, at + 200));
      else if (r < 0.5) socket.receive(SERVER.audio({ fill: run.pick([900, 20, 0]) }));
      else if (r < 0.6) socket.receive(SERVER.usage(run.pick([0, 15, 15, 30])));
      else if (r < 0.63) socket.receive(SERVER.closed(run.pick(['expired', 'content', 'remote_hangup', 'connection_lost'])));
      else if (r < 0.66) socket.receive(SERVER.error({ code: run.pick(['invalid_audio', 'invalid_api_key', 'rate_limit_exceeded']) }));
      else if (r < 0.68) socket.receive('not json');
      else if (r < 0.7) socket.receive(JSON.stringify({ type: 'session.output_audio.delta', delta: 7 }));
      else if (r < 0.74) socket.receive(run.pick([SERVER.muted(), SERVER.unmuted(), SERVER.bare('session.delegation.created'), SERVER.bare('info'), SERVER.bare('something.new')]));
      else if (r < 0.78) socket.serverClose(run.pick([1000, 1011]));
      else run.clock.advance(run.pick([200, 1_600, 16_000, RECONNECT_GRACE_MS]));
    },
  };

  // 300 lives, about a second alone: the bound is for a loaded machine.
  it('every life settles, ends clean, and leaves no timer, socket or send behind', async () => {
    const report = await runLifecycles(lifecycles, { seed: 20260930, runs: 300 });
    expect(report.failures).toEqual([]);
    for (const key of [
      'refused', 'live', 'stopped', 'end.failed.connection_lost', 'end.failed.auth', 'end.failed.rate_limit', 'end.closed', 'opening.bound', 'opening.abort', 'opening.abort.late',
      'harness.drop', 'harness.silent', 'harness.forbidden', 'harness.closed', 'harness.close_1011', 'harness.unanswered', 'harness.reconnected',
    ]) expect(report.stats[key] ?? 0, key).toBeGreaterThan(0);
  }, 20_000);
});

describe('the OpenAI Live adapter: the start over the header seam (ruling 7; choice 12)', () => {
  it('registers the rule first — a Bearer key, Origin removed, under /v1/live/ — then dials the bare URL, framing the header names alone', async () => {
    const h = startLive();
    expect(h.seam.sockets.all).toEqual([]);
    await flush();
    expect(h.seam.registrations).toEqual([{ host: 'api.openai.com', path: '/v1/live/', set: { Authorization: `Bearer ${KEY.apiKey}` }, remove: ['Origin'], cleared: false }]);
    expect(h.socket().url).toBe(LIVE_WS_URL);
    expect(h.socket().protocols).toBeUndefined();
    expect(h.frames('session.headers')).toEqual([{ host: 'api.openai.com', path: '/v1/live/', set: ['Authorization'], remove: ['Origin'] }]);
    noSecret(h.log);
  });

  it('sends session.start once the socket opens, and clears the rule then: the upgrade has been made', async () => {
    const h = await openLive();
    expect(h.socket().binaryType).toBe('arraybuffer');
    expect(h.sent()).toEqual([sessionStart(h.config, 'start_1')]);
    expect(h.sent()[0]).toMatchObject({ session: { model: 'gpt-live-1', audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } }, delegation: { type: 'client' } } });
    expect(h.frames('session.start')).toEqual([{ model: 'gpt-live-1', voice: 'marin', delegation: 'client', instructions: h.config.instructions }]);
    expect(h.seam.registrations[0].cleared).toBe(true);
  });

  it('resolves on session.started, emitting nothing but frames, over a websocket, its bound cancelled', async () => {
    const h = await openLive();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.started('live_abc'));
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.started')).toEqual([{ id: 'live_abc', expiresAt: 1_790_713_967 }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it("refuses an invalid voice in OpenAI's words before the session starts (U10), closing the socket, saying nothing but frames", async () => {
    const h = await openLive();
    h.socket().receive(SERVER.forbidden());
    await expect(h.starting).rejects.toEqual(new AdapterStartError('[OpenAI forbidden] Voice session access denied.', 'client'));
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    expect(h.frames('session.error')).toEqual([{ type: 'invalid_request_error', code: 'forbidden', message: 'Voice session access denied.', param: null }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a socket that fails before it opens reads as the network with the key named — a refused key is a 401 a browser cannot read (ruling 9)', async () => {
    const h = startLive();
    await flush();
    h.socket().drop();
    await expect(h.starting).rejects.toMatchObject({ code: 'network', message: NEVER_OPENED });
    expect(NEVER_OPENED).toBe("OpenAI's socket did not open (check the network, and that the API key is still valid).");
    expect(h.seam.registrations[0].cleared).toBe(true);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a registration the platform refuses opens nothing, in fixed words', async () => {
    const seam = fakeHeaderSockets();
    seam.refuseNext(`refused with ${KEY.apiKey}`);
    const { clock } = trackedClock();
    const { events, log } = recordEvents();
    const starting = createLiveAdapter({ openHeaderSocket: seam.open }).start({ context: AUTO_CTX, config: configFor(), credentials: KEY, clock, signal: new AbortController().signal }, events);
    await expect(starting).rejects.toMatchObject({ code: 'client', message: 'The app could not prepare the connection to OpenAI: restart it and try again.' });
    expect(seam.sockets.all).toEqual([]);
    noSecret(log);
  });

  it('a stop while the rule is being registered rejects at once and opens nothing; the rule is cleared at once, and its late answer changes nothing', async () => {
    const h = startLive();
    // The registration goes out a hop after the start: this holds it in flight.
    const land = h.seam.holdNext();
    await flush();
    h.controller.abort(new Error('stopped'));
    await expect(h.starting).rejects.toThrow('stopped');
    await flush();
    expect(h.seam.registrations.map((r) => r.cleared)).toEqual([true]);
    expect(h.seam.sockets.all).toEqual([]);
    land();
    await flush();
    expect(h.seam.registrations).toHaveLength(1);
    expect(h.seam.registrations[0].cleared).toBe(true);
    expect(h.seam.sockets.all).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it(`no answer within ${START_TIMEOUT_MS / 1000} s rejects, closing the socket`, async () => {
    const h = await openLive();
    h.clock.advance(START_TIMEOUT_MS);
    await expect(h.starting).rejects.toMatchObject({ code: 'server', message: `OpenAI did not start the session within ${START_TIMEOUT_MS / 1000} s.` });
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
  });

  it('a session.closed or a close before the start is a refusal', async () => {
    const a = await openLive();
    a.socket().receive(SERVER.closed('remote_hangup'));
    await expect(a.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the session before it started.' });
    const b = await openLive();
    b.socket().serverClose(1011, 'Internal error');
    await expect(b.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the connection before the session started (1011 Internal error).' });
  });

  it('the web build has no platform to set the header: the default seam refuses in words', async () => {
    const { clock } = trackedClock();
    const { events } = recordEvents();
    const starting = createLiveAdapter().start({ context: AUTO_CTX, config: configFor(), credentials: KEY, clock, signal: new AbortController().signal }, events);
    await expect(starting).rejects.toMatchObject({ code: 'client', message: 'OpenAI Live needs the desktop app or the browser extension.' });
  });
});

describe('the OpenAI Live adapter: audio up, and push-to-talk (ruling 5)', () => {
  it('sends each chunk as it came, base64, with no frame per chunk; nothing before the start or after a stop', async () => {
    const h = await liveSession();
    const n = h.log.length;
    h.session.appendAudio(chunk(1_000));
    h.session.appendAudio(chunk(-3));
    expect(h.appended()).toEqual([chunk(1_000), chunk(-3)]);
    expect(h.log.length).toBe(n);
    await h.session.stop();
    h.session.appendAudio(chunk());
    expect(h.appended()).toHaveLength(2);
  });

  it('a release mutes the session once, framed, and drops what follows; a press unmutes it; a cancel is a release', async () => {
    const h = await liveSession({ context: MANUAL_CTX });
    // The first press: the session was never muted.
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.session.endTurn();
    h.session.appendAudio(chunk());
    expect(h.sent().map((m) => m.type)).toEqual(['session.start', 'session.input_audio.append', 'session.input_audio.mute']);
    expect(h.sent()[2]).toEqual({ type: 'session.input_audio.mute', event_id: 'mute_2' });
    expect(h.frames('session.input_audio.mute')).toEqual([{ eventId: 'mute_2' }]);
    h.socket().receive(SERVER.muted());
    expect(h.frames('session.input_audio.muted')).toEqual([undefined]);
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.cancelTurn();
    expect(h.sent().slice(3).map((m) => m.type)).toEqual(['session.input_audio.unmute', 'session.input_audio.append', 'session.input_audio.mute']);
    expect(h.frames('session.input_audio.unmute')).toEqual([{ eventId: 'unmute_3' }]);
  });

  it('automatic turns never mute', async () => {
    const h = await liveSession();
    h.session.beginTurn();
    h.session.endTurn();
    h.session.cancelTurn();
    expect(h.sent().map((m) => m.type)).toEqual(['session.start']);
  });
});

describe('the OpenAI Live adapter: messages to segments and frames', () => {
  it('frames each delta with its stamps and cuts it into segments; frames voiced audio, never the floor', async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.input('你好', 0, 200));
    h.socket().receive(SERVER.output('Hello.', 0, 200));
    h.socket().receive(SERVER.floor());
    h.socket().receive(SERVER.audio());
    expect(h.frames('session.input_transcript.delta')).toEqual([{ delta: '你好', startMs: 0, endMs: 200 }]);
    expect(h.frames('session.output_transcript.delta')).toEqual([{ delta: 'Hello.', startMs: 0, endMs: 200 }]);
    expect(h.frames('session.output_audio.delta')).toEqual([{ samples: 2_400, rms: 0.0275 }]);
    // The floor's frame counted on the clock: the voiced one is [100, 200) ms, the second half of "Hello." [0, 200).
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.range])).toEqual([[2, [3, 6]]]);
  });

  it('a leg that does not speak plays nothing, yet its voiced audio opens and holds the translation', async () => {
    const h = await liveSession({ context: { ...AUTO_CTX, speech: false } });
    h.socket().receive(SERVER.audio());
    expect(h.of('audio')).toEqual([]);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'translation' }]);
  });

  it("a mid-session error that does not end it — invalid audio (U10) — is a Logs line, and the session goes on", async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.error({ code: 'invalid_audio', param: 'audio', message: 'PCM16 audio must contain an even number of bytes' }));
    expect(h.frames('session.error')).toEqual([{ type: 'invalid_request_error', code: 'invalid_audio', message: 'PCM16 audio must contain an even number of bytes', param: 'audio' }]);
    h.socket().receive(SERVER.input('还在', 0, 200));
    expect(kinds(h.log)).toEqual(['segmentOpened', 'segmentText']);
  });

  it('a frame that will not read says so once, a Logs line and a degraded, until one reads again', async () => {
    const h = await liveSession();
    h.socket().receive('not json');
    h.socket().receive('still not json');
    expect(h.frames('session.unreadable')).toHaveLength(1);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error']);
    h.socket().receive(SERVER.usage(0));
    h.socket().receive('not json again');
    expect(h.of('degraded')).toHaveLength(2);
  });

  it('frames what it reads and names what it does not', async () => {
    const h = await liveSession();
    for (const type of ['session.delegation.created', 'session.updated', 'info', 'something.new']) h.socket().receive(SERVER.bare(type));
    expect(h.of('frame').slice(-4).map((e) => [e.payload.type, e.payload.payload])).toEqual([
      ['session.delegation.created', undefined], ['session.updated', undefined], ['session.info', undefined], ['session.unknown', { type: 'something.new' }],
    ]);
  });
});

describe('the OpenAI Live adapter: the watchdog, the reconnect and the ends (ruling 6; choices 13, 14)', () => {
  /** A reconnect's attempt, answered: its registration, its socket open, its session started. */
  async function answerAttempt(h: Awaited<ReturnType<typeof liveSession>>, id = 'live_2') {
    await flush();
    h.socket().open();
    await flush();
    h.socket().receive(SERVER.started(id));
    await flush();
  }

  it('a close with no session.closed is tried again once — the header registered again — and the leg carries on, its refs counting on', async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.input('你好', 0, 200));
    const first = h.socket();
    first.serverClose(1011, 'Internal error');
    await flush();
    expect(h.frames('session.connection_lost')).toEqual([{ cause: 'socket_closed', code: 1011, reason: 'Internal error' }]);
    expect(kinds(h.log)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed', 'reconnecting']);
    // Audio in the gap is dropped.
    h.session.appendAudio(chunk());
    await answerAttempt(h);
    expect(h.seam.registrations).toHaveLength(2);
    expect(h.socket()).not.toBe(first);
    expect(kinds(h.log).slice(-1)).toEqual(['reconnected']);
    expect(h.frames('session.reconnected')).toEqual([undefined]);
    h.socket().receive(SERVER.input('再见', 0, 200));
    expect(h.of('segmentOpened').map((e) => e.payload.ref)).toEqual([1, 2]);
    expect(h.appended()).toEqual([]);
  });

  it(`a second loss within ${RECONNECT_GRACE_MS / 1000} s of the reconnect fails the leg; one after it is tried again`, async () => {
    const h = await liveSession();
    h.socket().serverClose(1011);
    await answerAttempt(h);
    h.clock.advance(RECONNECT_GRACE_MS - 1);
    h.socket().serverClose(1011);
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: CONNECTION_LOST }]);
    expect(h.seam.registrations).toHaveLength(2);

    const g = await liveSession();
    g.socket().serverClose(1011);
    await answerAttempt(g);
    g.clock.advance(RECONNECT_GRACE_MS);
    g.socket().serverClose(1011);
    await flush();
    expect(g.of('failed')).toEqual([]);
    expect(g.seam.registrations).toHaveLength(3);
  });

  it('an attempt that fails ends the leg as the lost connection; one refused for the key, in its words', async () => {
    const h = await liveSession();
    h.socket().serverClose(1011);
    await flush();
    h.socket().drop();
    await flush();
    expect(h.frames('session.reconnect_failed')).toEqual([{ message: NEVER_OPENED }]);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: CONNECTION_LOST }]);
    expect(h.timers()).toBe(0);

    const g = await liveSession();
    g.socket().serverClose(1011);
    await flush();
    g.socket().open();
    await flush();
    g.socket().receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    await flush();
    expect(g.of('failed').map((e) => e.payload)).toEqual([{ code: 'auth', message: '[OpenAI invalid_api_key] Incorrect API key provided.' }]);
  });

  it(`an end within ${ERROR_WORDS_MS / 1000} s of an actionable error fails in its words, with no attempt; later, the connection is tried again`, async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.error({ type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota.' }));
    h.clock.advance(ERROR_WORDS_MS);
    h.socket().serverClose(1011);
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'rate_limit', message: '[OpenAI insufficient_quota] You exceeded your current quota.' }]);
    expect(h.seam.registrations).toHaveLength(1);

    const g = await liveSession();
    g.socket().receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    g.clock.advance(ERROR_WORDS_MS + 1);
    g.socket().serverClose(1011);
    await flush();
    expect(g.of('failed')).toEqual([]);
    expect(kinds(g.log)).toContain('reconnecting');
  });

  it("the session's expiry ends the run (ruling 8); any other session.closed unrequested is a lost connection", async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.closed('expired', 7_199));
    expect(h.frames('session.closed')).toEqual([{ reason: 'expired', seconds: 7_199 }]);
    expect(h.of('closed').map((e) => e.payload)).toEqual([{ reason: 'expired' }]);
    expect(h.socket().closedByClient).not.toBeNull();

    const g = await liveSession();
    g.socket().receive(SERVER.closed('remote_hangup', 12));
    await flush();
    expect(g.frames('session.connection_lost')).toEqual([{ cause: 'session_closed', reason: 'remote_hangup' }]);
    expect(kinds(g.log)).toEqual(['reconnecting']);
  });

  it(`two equal usage reports with ${STALL_VOICED_SAMPLES / 24_000} s of voiced audio sent between them are a stall, tried again; with none sent, silence (U3)`, async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.usage(14));
    h.socket().receive(SERVER.usage(14));
    expect(h.frames('session.stalled')).toEqual([]);
    for (let i = 0; i < 30; i++) h.session.appendAudio(chunk(0));
    h.socket().receive(SERVER.usage(14));
    expect(h.frames('session.stalled')).toEqual([]);
    // 24 chunks of 2 048 samples: 49 152, just past 2 s.
    for (let i = 0; i < 24; i++) h.session.appendAudio(chunk(5));
    h.socket().receive(SERVER.usage(14));
    expect(h.frames('session.usage.updated')).toEqual([{ seconds: 14 }, { seconds: 14 }, { seconds: 14 }, { seconds: 14 }]);
    expect(h.frames('session.stalled')).toEqual([{ seconds: 14 }]);
    expect(h.frames('session.connection_lost')).toEqual([{ cause: 'stalled', seconds: 14 }]);
    expect(kinds(h.log)).toEqual(['reconnecting']);
  });

  it('a push-to-talk tap between two equal reports is no stall: billing counts whole seconds, and 0.17 s has not moved it', async () => {
    const h = await liveSession({ context: MANUAL_CTX });
    h.socket().receive(SERVER.usage(26));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.socket().receive(SERVER.usage(26));
    await flush();
    expect(h.frames('session.stalled')).toEqual([]);
    // Taps the same minute: none reconnects, and none fails the leg.
    for (let tap = 0; tap < 3; tap++) {
      h.session.beginTurn();
      h.session.appendAudio(chunk());
      h.session.endTurn();
      h.socket().receive(SERVER.usage(26));
      await flush();
    }
    expect(kinds(h.log)).toEqual([]);
    // A long press, just short of 2 s between each two reports: still none, the count starting again at each report.
    h.session.beginTurn();
    for (let i = 0; i < 23; i++) h.session.appendAudio(chunk());
    h.socket().receive(SERVER.usage(26));
    for (let i = 0; i < 23; i++) h.session.appendAudio(chunk());
    h.socket().receive(SERVER.usage(26));
    h.session.endTurn();
    await flush();
    expect(h.frames('session.stalled')).toEqual([]);
    expect(kinds(h.log)).toEqual([]);
  });
});

describe('the OpenAI Live adapter: stop (ruling 8)', () => {
  it('sends session.close, framed, closes the socket before it returns, leaves no timer, and says nothing after', async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.input('你好', 0, 200));
    h.socket().receive(SERVER.output('Hi', 0, 200));
    const n = h.log.length;
    const stopping = h.session.stop();
    expect(h.sent().slice(-1)).toEqual([{ type: 'session.close' }]);
    expect(h.log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'session.close' } }]);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    expect(h.timers()).toBe(0);
    h.clock.advance(60_000);
    await flush();
    expect(h.log.length).toBe(n + 1);
  });

  it('a stop while reconnecting ends the attempt: its rule cleared, its socket closed, nothing said after', async () => {
    const h = await liveSession();
    h.socket().serverClose(1011);
    await flush();
    const attempt = h.socket();
    const n = h.log.length;
    await h.session.stop();
    await flush();
    expect(attempt.readyState).toBe(FakeSocket.CLOSED);
    expect(h.seam.registrations.every((r) => r.cleared)).toBe(true);
    expect(h.log.length).toBe(n);
    expect(h.timers()).toBe(0);
  });

  it('no event carries the key', async () => {
    const h = await liveSession({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    // OpenAI masks the key it quotes (U9): "sk-bogus************0000".
    h.socket().receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided: sk-proj-************6789.' }));
    h.socket().serverClose(1011);
    await flush();
    noSecret(h.log);
  });
});
