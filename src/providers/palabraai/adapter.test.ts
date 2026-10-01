/**
 * Palabra AI's adapter: the conformance suite and the seeded lifecycles in
 * both credential modes, the two ways in and the start's refusals in
 * words, the audio going up and the idle rule, the messages to segments,
 * failures, and stop with a REST session's delete. On `FakeSocket`, a fake
 * REST server and a virtual clock — no network, no fake timers.
 */
import { describe, it, expect, vi } from 'vitest';
import { AdapterStartError, SAMPLE_RATE, type AdapterEvents } from '../../lib/contract/adapter';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { WS_OPEN } from '../../lib/contract/socket';
import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { runLifecycles, type LifecycleHarness } from '../../lib/contract/testing/lifecycle';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import {
  createPalabraAdapter, ERROR_WORDS_MS, NEVER_OPENED, OFFLINE, POLL_MS, RATE_LIMITED, REFUSED_UPGRADE, RELEASE_TIMEOUT_MS, START_TIMEOUT_MS,
} from './adapter';
import { CHUNK_MS, CHUNK_SAMPLES, IDLE_MS } from './audioIn';
import type { PalabraConfig } from './config';
import type { PalabraCredentials } from './settings';
import {
  APP, AUTO_CTX, configFor, CREATED_BODY, EN, fakeRest, JA, KEY, livePalabra, MANUAL_CTX, PUBLISHER, SENTENCE, SERVER, SESSION_ID, SESSION_WS_URL, startPalabra,
} from './testing';
import { directUrl, sessionDeleteUrl, setTask } from './wire';

/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = (fill = 1_000) => new Int16Array(2_048).fill(fill);
const isSilent = (pcm: Int16Array) => pcm.every((s) => s === 0);
/** What no frame, failure or refusal may carry: the key, the app pair, and a REST session's tokens. */
const SECRETS = [KEY.apiKey, APP.clientId, APP.clientSecret, PUBLISHER, SESSION_ID, 'token='];
const noSecret = (value: unknown) => {
  const text = JSON.stringify(value, (_k, v: unknown) => (v instanceof Int16Array ? `pcm(${v.length})` : v instanceof Error ? v.message : v));
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};
/** The app pair's REST headers as the fake server records them: a browser's `Headers`, lowercase names. */
const APP_HEADERS = { clientid: APP.clientId, clientsecret: APP.clientSecret };
/** A stretch of the log as the Logs read it: each frame's type and payload, each other event's kind. */
const lines = (log: readonly AdapterEvent[]) => log.map((e) => (e.kind !== 'frame' ? [e.kind] : e.payload.payload === undefined ? [e.payload.type] : [e.payload.type, e.payload.payload]));

function harness(credentials: PalabraCredentials): AdapterHarness<PalabraConfig, PalabraCredentials> {
  let sockets = fakeSockets();
  let rest = fakeRest();
  const last = () => sockets.last();
  const reply = (frame: () => string): ScenarioStep => ({ run: () => last().receive(frame()) });
  return {
    adapter: createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: (input, init) => rest.fetch(input, init), newId: () => 'test-hash', online: () => true }),
    config: (context) => { sockets = fakeSockets(); rest = fakeRest(); return configFor(context); },
    credentials,
    // The app pair's socket waits for its create's answer: the first flush lets it land.
    opening: () => [{ flush: true }, { run: () => last().open() }, { advance: POLL_MS }, reply(() => SERVER.currentTask()), { flush: true }],
    exchange: [
      reply(() => SERVER.partial('リアルタイム')),
      reply(() => SERVER.validated()),
      reply(() => SERVER.translated()),
      reply(() => SERVER.audio()),
      reply(() => SERVER.audio({ last: true })),
    ],
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ flush: true }, { run: () => last().drop() }, { flush: true }],
  };
}

describe('the Palabra AI adapter: conformance', () => {
  for (const [mode, credentials] of [['the platform key', KEY], ['the app pair', APP]] as const) {
    const h = harness(credentials);

    it(`runs every scenario but typed text and reconnecting, which Palabra has neither of (${mode})`, () => {
      expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close']);
    });

    it.each(scenarioNames(h))(`%s (${mode})`, async (name) => {
      const report = await runScenario(h, name);
      expect(report.violations).toEqual([]);
      expect(report.problems).toEqual([]);
    });
  }
});

describe('the Palabra AI adapter: the seeded lifecycles (ruling 15)', () => {
  /** The adapter's lives as the kit plays them, over a REST server that may refuse the create; the app pair's sessions are checked deleted, each once. */
  function lifecycles(credentials: PalabraCredentials): LifecycleHarness<PalabraConfig, PalabraCredentials> {
    let rest = fakeRest();
    let created = false;
    return {
      adapter: (run) => {
        const create = run.rand() < 0.1 ? run.pick([401, 429, 500, 'offline'] as const) : 'ok';
        created = create === 'ok';
        rest = fakeRest({ create });
        return createPalabraAdapter({ openSocket: (url) => run.sockets.create(url), fetch: rest.fetch, newId: () => `run-${run.index}`, online: () => true });
      },
      config: (context) => configFor(context),
      credentials,
      secrets: SECRETS,
      textInput: false,
      startBoundMs: START_TIMEOUT_MS,
      opening: async (run) => {
        // The app pair's socket waits for its create's answer.
        await flush();
        const socket = run.sockets.all[run.sockets.all.length - 1];
        if (!socket) return;
        const r = run.rand();
        // Each of the harness's own ways is counted: the app pair's socket exists only once its create is answered, so the kit's own drop before the opening never reaches it, and these are what reach its opening.
        // A refused upgrade; or nothing at all, and the kit runs the start's bound out.
        if (r < 0.04) { run.count('harness.drop'); return socket.drop(); }
        if (r < 0.07) { run.count('harness.silent'); return; }
        socket.open();
        if (r < 0.1) { run.count('harness.refused_task'); return socket.receive(SERVER.thresholdRefused()); }
        if (r < 0.12) { run.count('harness.close_1008'); return socket.serverClose(1008); }
        run.clock.advance(POLL_MS);
        if (r < 0.2) {
          socket.receive(SERVER.notFound());
          run.clock.advance(POLL_MS);
        }
        if (r < 0.22) run.count('harness.paused');
        socket.receive(SERVER.currentTask(r < 0.22 ? 'paused' : 'running'));
      },
      server: (run) => {
        const socket = run.sockets.all[run.sockets.all.length - 1];
        if (!socket || socket.readyState !== 1) return;
        const r = run.rand();
        const id = run.pick(['s1', 's2', 's3']);
        if (r < 0.2) socket.receive(SERVER.partial(run.pick(['リ', 'リアル', 'リアルタイム']), id));
        else if (r < 0.35) socket.receive(SERVER.validated(JA, id));
        else if (r < 0.5) socket.receive(SERVER.translated(run.pick([EN, 'Hi.', '']), id, run.pick([0, 1])));
        else if (r < 0.72) socket.receive(SERVER.audio({ id, part: run.pick(['0', '1']), last: run.rand() < 0.3, samples: run.pick([0, 2_400, 4_800]) }));
        else if (r < 0.76) socket.receive(SERVER.voiceNotFound());
        else if (r < 0.79) socket.receive(SERVER.warning('AUDIO_STREAM_STALLED', 'The stream stalled.'));
        else if (r < 0.82) socket.receive(SERVER.serviceTimeout());
        else if (r < 0.84) socket.receive('not json');
        else if (r < 0.86) socket.receive(JSON.stringify({ message_type: 'output_audio_data', data: { transcription_id: id, data: 7 } }));
        else if (r < 0.88) socket.receive(SERVER.bare('session_heartbeat'));
        else if (r < 0.9) socket.receive(SERVER.endOfStream());
        else if (r < 0.93) socket.receive(SERVER.notFound());
        else socket.serverClose(run.pick([1000, 1008, 1011]));
      },
      after: () => {
        if (credentials.kind === 'apiKey') return rest.calls.length > 0 ? ['the platform key made a REST call'] : [];
        const problems: string[] = [];
        const deletes = rest.of('DELETE');
        if (deletes.length !== (created ? 1 : 0)) problems.push(`${deletes.length} session delete(s) where ${created ? 1 : 0} was due`);
        for (const d of deletes) {
          if (d.url !== sessionDeleteUrl(SESSION_ID) || d.keepalive !== true || d.headers.clientid !== APP.clientId) problems.push('a delete that was not our own session\'s, with its credentials and keepalive');
        }
        return problems;
      },
    };
  }

  // 300 lives each, about a second alone: the bound is for a loaded machine.
  it('the platform key: every life settles, ends clean, and leaves no timer, socket or REST call behind', async () => {
    const report = await runLifecycles(lifecycles(KEY), { seed: 20260929, runs: 300 });
    expect(report.failures).toEqual([]);
    for (const key of ['refused', 'live', 'stopped', 'end.failed.connection_lost', 'end.failed.rate_limit', 'end.failed.server', 'opening.bound', 'opening.abort.early']) expect(report.stats[key] ?? 0, key).toBeGreaterThan(0);
  }, 20_000);

  it("the app pair: the same, and every REST session created is deleted, once", async () => {
    const report = await runLifecycles(lifecycles(APP), { seed: 20260930, runs: 300 });
    expect(report.failures).toEqual([]);
    for (const key of [
      'refused', 'live', 'stopped', 'end.failed.connection_lost', 'opening.bound', 'opening.abort.early',
      // The harness's own ways into the session's socket, which the kit's own drop cannot reach.
      'harness.drop', 'harness.silent', 'harness.refused_task', 'harness.close_1008', 'harness.paused',
    ]) expect(report.stats[key] ?? 0, key).toBeGreaterThan(0);
  }, 20_000);
});

describe('the Palabra AI adapter: the platform key goes straight in (ruling 1)', () => {
  it('dials the streaming endpoint with the key in its query, reads binary frames as ArrayBuffers, and makes no REST call', async () => {
    const h = startPalabra();
    expect(h.socket().url).toBe(directUrl('test-hash', KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    expect(h.rest.calls).toEqual([]);
    h.socket().open();
    expect(h.frames('session.opened')).toEqual([{ path: 'key' }]);
    // The task goes up at once, framed as sent; the URL, the key, never.
    expect(h.sent()).toEqual([setTask(h.config)]);
    expect(h.frames('task.set')).toEqual([setTask(h.config).data]);
    noSecret(h.log);
  });

  it('a socket that fails before it opens reads as the key, online — a wrong key is a bare 403 on the upgrade — and as the network offline', async () => {
    const online = startPalabra();
    online.socket().drop();
    await expect(online.starting).rejects.toMatchObject({ code: 'auth', message: REFUSED_UPGRADE });
    expect(REFUSED_UPGRADE).toBe('Palabra refused the connection before it opened: check the API key.');
    expect(online.content()).toEqual([]);
    expect(online.timers()).toBe(0);
    const offline = startPalabra({ online: false });
    offline.socket().drop();
    await expect(offline.starting).rejects.toMatchObject({ code: 'network', message: OFFLINE });
  });
});

describe('the Palabra AI adapter: the app pair goes through a REST session of its own (ruling 1)', () => {
  it("creates a session with the pair's headers, dials its address with the publisher token, and frames neither token", async () => {
    const h = startPalabra({ credentials: APP });
    expect(h.sockets.all).toEqual([]);
    expect(h.rest.calls).toMatchObject([{ method: 'POST', url: 'https://api.palabra.ai/session-storage/session', body: '{"data":{"intent":"api"}}' }]);
    expect(h.rest.calls[0].headers).toEqual({ 'content-type': 'application/json', accept: 'application/json', ...APP_HEADERS });
    await flush();
    expect(h.socket().url).toBe(`${SESSION_WS_URL}?token=${PUBLISHER}`);
    h.socket().open();
    expect(h.frames('session.create')).toEqual([undefined]);
    expect(h.frames('session.created')).toEqual([{ status: 201 }]);
    expect(h.frames('session.opened')).toEqual([{ path: 'session' }]);
    noSecret(h.log);
  });

  it.each([
    [401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [500, 'server'], [400, 'client'],
  ] as const)("a create refused with %i rejects the start in Palabra's words, as %s, and opens nothing", async (status, code) => {
    const h = startPalabra({ credentials: APP, rest: { create: status } });
    await expect(h.starting).rejects.toMatchObject({ code, message: `HTTP ${status}: Refused with ${status}.` });
    expect(h.sockets.all).toEqual([]);
    expect(h.frames('session.create_failed')).toEqual([{ status, message: `HTTP ${status}: Refused with ${status}.` }]);
    expect(h.rest.of('DELETE')).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a create that never reached Palabra reads as the network, offline or not', async () => {
    const online = startPalabra({ credentials: APP, rest: { create: 'offline' } });
    await expect(online.starting).rejects.toMatchObject({ code: 'network', message: "Palabra's session service could not be reached." });
    const offline = startPalabra({ credentials: APP, rest: { create: 'offline' }, online: false });
    await expect(offline.starting).rejects.toMatchObject({ code: 'network', message: OFFLINE });
  });

  it("the session's socket failing before it opens reads as the network — its token is fresh — and the session is deleted", async () => {
    const h = startPalabra({ credentials: APP });
    await flush();
    h.socket().drop();
    await expect(h.starting).rejects.toMatchObject({ code: 'network', message: NEVER_OPENED });
    await flush();
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: APP_HEADERS }]);
  });

  it('a create the leg outlives still lands, and the session it made is deleted, never dialled — its answer in or still out when the start is cancelled (choice 9)', async () => {
    const reason = new Error('cancelled');
    // The answer in, its body unread: the body is read on the create's own signal, which the leg's end does not abort.
    const read = startPalabra({ credentials: APP });
    // One hop: the fake server's answer has settled, and the leg has not yet read it.
    await Promise.resolve();
    read.controller.abort(reason);
    await expect(read.starting).rejects.toBe(reason);
    await flush();
    expect(read.sockets.all).toEqual([]);
    expect(read.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: APP_HEADERS }]);
    expect(read.timers()).toBe(0);

    // The answer still out: the create is not aborted, its own bound the one timer left; it lands later, and its session goes.
    const out = startPalabra({ credentials: APP, rest: { create: 'later' } });
    out.controller.abort(reason);
    await expect(out.starting).rejects.toBe(reason);
    expect(out.rest.calls[0].signal?.aborted).toBe(false);
    expect(out.timers()).toBe(1);
    out.rest.answer();
    await flush();
    expect(out.sockets.all).toEqual([]);
    expect(out.rest.of('DELETE')).toHaveLength(1);
    expect(out.frames('session.created')).toEqual([]);
    expect(out.timers()).toBe(0);
  });

  /** An app-pair leg whose create answers with the session's id and nothing else; the delete goes to a fake server that records it. */
  function idOnly() {
    const rest = fakeRest();
    const fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> =>
      init.method === 'POST' ? Promise.resolve(new Response(JSON.stringify({ ok: true, data: { id: SESSION_ID } }), { status: 201 })) : rest.fetch(input, init);
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const controller = new AbortController();
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch }).start(
      { context: AUTO_CTX, config: configFor(), credentials: APP, clock, signal: controller.signal },
      recordEvents().events,
    );
    return { rest, sockets, clock, controller, starting };
  }

  it('a late create is deleted by its id alone: an answer that names no publisher or socket address is still deleted, exactly once (choice 9)', async () => {
    const h = idOnly();
    h.controller.abort(new Error('cancelled'));
    await expect(h.starting).rejects.toThrow('cancelled');
    await flush();
    expect(h.sockets.all).toEqual([]);
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: APP_HEADERS }]);
    h.clock.advance(RELEASE_TIMEOUT_MS * 2);
    await flush();
    expect(h.rest.of('DELETE')).toHaveLength(1);
  });

  it('an answer in time that names its id but no socket to reach is refused, and the session it names deleted, exactly once (choice 9)', async () => {
    const h = idOnly();
    await expect(h.starting).rejects.toMatchObject({ code: 'server', message: 'Palabra answered the session request without a socket to reach.' });
    await flush();
    expect(h.sockets.all).toEqual([]);
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true }]);
    h.clock.advance(RELEASE_TIMEOUT_MS * 2);
    await flush();
    expect(h.rest.of('DELETE')).toHaveLength(1);
  });

  it("a start that fails after its session was made rejects only once the delete has settled, its outcome framed first — within the delete's bound (Stage 2 session end, choice 5)", async () => {
    const answered = startPalabra({ credentials: APP });
    let seenAt = -1;
    void answered.starting.catch(() => { seenAt = answered.log.length; });
    await flush();
    answered.socket().drop();
    await expect(answered.starting).rejects.toMatchObject({ code: 'network', message: NEVER_OPENED });
    expect(lines(answered.log.slice(0, seenAt))).toEqual([
      ['session.create'], ['session.created', { status: 201 }], ['session.socket_error'], ['session.connection_lost', { code: 1006, reason: '' }],
      ['session.delete'], ['session.deleted', { status: 204 }],
    ]);

    const hung = startPalabra({ credentials: APP, rest: { remove: 'hang' } });
    let rejected = false;
    void hung.starting.catch(() => { rejected = true; });
    await flush();
    hung.socket().drop();
    await flush();
    expect(rejected).toBe(false);
    hung.clock.advance(RELEASE_TIMEOUT_MS);
    await flush();
    expect(rejected).toBe(true);
    expect(hung.frames('session.delete_warning')).toEqual([{ timeoutMs: RELEASE_TIMEOUT_MS }]);
    expect(hung.timers()).toBe(0);
  });

  it('an answer in time whose socket address is no URL is refused as the service\'s, opens nothing, and the session it made is deleted, exactly once (choice 8)', async () => {
    const rest = fakeRest();
    const fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> =>
      init.method === 'POST'
        ? Promise.resolve(new Response(JSON.stringify({ ...CREATED_BODY, data: { ...CREATED_BODY.data, ws_url: 'not a url' } }), { status: 201 }))
        : rest.fetch(input, init);
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const { events, log } = recordEvents();
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch }).start(
      { context: AUTO_CTX, config: configFor(), credentials: APP, clock, signal: new AbortController().signal },
      events,
    );
    await expect(starting).rejects.toMatchObject({ code: 'server', message: 'Palabra answered the session request with an address that is no URL.' });
    await flush();
    expect(sockets.all).toEqual([]);
    expect(rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: APP_HEADERS }]);
    clock.advance(RELEASE_TIMEOUT_MS * 2);
    await flush();
    expect(rest.of('DELETE')).toHaveLength(1);
    noSecret(log);
  });

  it("two legs of one adapter — Both's — each delete their own session and no other: stopping one leaves the other's socket open (ruling 1)", async () => {
    let made = 0;
    const rest = fakeRest();
    // Each create answers a session of its own.
    const fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      if (init.method !== 'POST') return rest.fetch(input, init);
      made += 1;
      return Promise.resolve(new Response(JSON.stringify({ ...CREATED_BODY, data: { ...CREATED_BODY.data, id: `${SESSION_ID}-${made}` } }), { status: 201 }));
    };
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const adapter = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch, newId: () => 'test-hash', online: () => true });
    const start = () => adapter.start({ context: AUTO_CTX, config: configFor(), credentials: APP, clock, signal: new AbortController().signal }, recordEvents().events);
    const first = start();
    const second = start();
    await flush();
    const [a, b] = sockets.all;
    a.open();
    b.open();
    clock.advance(POLL_MS);
    a.receive(SERVER.currentTask());
    b.receive(SERVER.currentTask());
    const [one, two] = await Promise.all([first, second]);
    await one.stop();
    expect(rest.of('DELETE').map((d) => d.url)).toEqual([sessionDeleteUrl(`${SESSION_ID}-1`)]);
    expect(a.closedByClient).not.toBeNull();
    expect(b.closedByClient).toBeNull();
    expect(b.readyState).toBe(WS_OPEN);
    await two.stop();
    expect(rest.of('DELETE').map((d) => d.url)).toEqual([sessionDeleteUrl(`${SESSION_ID}-1`), sessionDeleteUrl(`${SESSION_ID}-2`)]);
  });

  it("a create that never answers is given the start's bound from its send, then abandoned: nothing opens, nothing is left to delete", async () => {
    const h = startPalabra({ credentials: APP, rest: { create: 'hang' } });
    h.controller.abort(new Error('cancelled'));
    await expect(h.starting).rejects.toThrow('cancelled');
    h.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(h.rest.calls[0].signal?.aborted).toBe(false);
    h.clock.advance(1);
    await flush();
    expect(h.rest.calls[0].signal?.aborted).toBe(true);
    expect(h.sockets.all).toEqual([]);
    expect(h.rest.of('DELETE')).toEqual([]);
    expect(h.timers()).toBe(0);
  });
});

describe('the Palabra AI adapter: the start resolves when the task runs (ruling 4)', () => {
  it('asks 2.1 s after the task went up and every 2.1 s after, never sooner, through NOT_FOUND — framed as the expected answer it is, not red (choice 8) — and resolves on running with no content and one timer: the beat', async () => {
    const h = startPalabra();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    h.socket().open();
    const asks = () => h.sent().filter((m) => m.message_type === 'get_task').length;
    h.clock.advance(POLL_MS - 1);
    expect(asks()).toBe(0);
    h.clock.advance(1);
    expect(asks()).toBe(1);
    expect(h.sent()[1]).toEqual({ message_type: 'get_task', data: { exclude_hidden: true } });
    h.socket().receive(SERVER.notFound());
    h.clock.advance(POLL_MS - 1);
    expect(asks()).toBe(1);
    h.clock.advance(1);
    expect(asks()).toBe(2);
    h.socket().receive(SERVER.currentTask('paused'));
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.currentTask());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('task.get')).toEqual([undefined, undefined]);
    expect(h.frames('task.current')).toEqual([{ status: 'paused' }, { status: 'running' }]);
    expect(h.frames('task.not_found')).toEqual([undefined]);
    expect(h.frames('session.error')).toEqual([]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(1);
    h.clock.advance(POLL_MS * 3);
    expect(asks()).toBe(2);
  });

  it("a task Palabra refuses rejects the start in its words, as the request's, and closes the socket", async () => {
    const h = startPalabra({ credentials: APP });
    await flush();
    h.socket().open();
    h.socket().receive(SERVER.thresholdRefused());
    await expect(h.starting).rejects.toMatchObject({
      code: 'client',
      message: '[Palabra VALIDATION_ERROR] segment_confirmation_silence_threshold: ensure this value is greater than or equal to 0.3',
    });
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    await flush();
    // The session made for it is deleted, and the delete's bound goes with its answer.
    expect(h.rest.of('DELETE')).toHaveLength(1);
    expect(h.timers()).toBe(0);
  });

  it('bounds the start at 20 s on the request\'s clock: the network when the socket never opened, the service when it did', async () => {
    const never = startPalabra();
    never.clock.advance(START_TIMEOUT_MS);
    await expect(never.starting).rejects.toMatchObject({ code: 'network', message: 'Palabra did not open the connection within 20 s.' });
    expect(never.socket().closedByClient).not.toBeNull();
    expect(never.timers()).toBe(0);

    const silent = startPalabra();
    let settled = false;
    void silent.starting.catch(() => { settled = true; });
    silent.socket().open();
    silent.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    silent.clock.advance(1);
    await expect(silent.starting).rejects.toMatchObject({ code: 'server', message: 'Palabra did not start the task within 20 s.' });
    expect(silent.timers()).toBe(0);
  });

  it('a close after the socket opened, before the task runs: 1008 is the connection limit, anything else the service', async () => {
    const limited = startPalabra();
    limited.socket().open();
    limited.socket().serverClose(1008);
    await expect(limited.starting).rejects.toMatchObject({ code: 'rate_limit', message: RATE_LIMITED });
    const closed = startPalabra();
    closed.socket().open();
    closed.socket().serverClose(1011, 'boom');
    await expect(closed.starting).rejects.toMatchObject({ code: 'server', message: 'Palabra closed the connection before the task started (1011 boom).' });
    expect(closed.frames('session.connection_lost')).toEqual([{ code: 1011, reason: 'boom' }]);
  });

  it('an abort while opening rejects with its reason and closes the socket; a start already aborted opens nothing', async () => {
    const h = startPalabra();
    h.socket().open();
    const reason = new Error('cancelled');
    h.controller.abort(reason);
    await expect(h.starting).rejects.toBe(reason);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);

    const sockets = fakeSockets();
    const rest = fakeRest();
    const controller = new AbortController();
    controller.abort(reason);
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: rest.fetch }).start(
      { context: AUTO_CTX, config: configFor(), credentials: APP, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    );
    await expect(starting).rejects.toBe(reason);
    expect(sockets.all).toEqual([]);
    expect(rest.calls).toEqual([]);
  });

  it("a browser that will not open the socket rejects in fixed words, never its own, which quote the key — and the app pair's session is deleted", async () => {
    const refusing = (url: string): WebSocket => { throw new DOMException(`Failed to construct 'WebSocket': The URL '${url}' is invalid.`, 'SyntaxError'); };
    for (const credentials of [KEY, APP]) {
      const rest = fakeRest();
      const { events, log } = recordEvents();
      const starting = createPalabraAdapter({ openSocket: refusing, fetch: rest.fetch }).start(
        { context: AUTO_CTX, config: configFor(), credentials, clock: createVirtualClock(0), signal: new AbortController().signal },
        events,
      );
      const error = await starting.then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterStartError);
      expect(error).toMatchObject({ code: 'network', message: 'The browser would not open the socket (SyntaxError).' });
      expect((error as AdapterStartError).cause).toBeUndefined();
      noSecret([error, log]);
      await flush();
      expect(rest.of('DELETE')).toHaveLength(credentials === APP ? 1 : 0);
    }
  });
});

describe('the Palabra AI adapter: audio up (rulings 3, 5)', () => {
  it('sends 320 ms chunks, each as it fills, and frames none of them (the hot-path rule)', async () => {
    const h = await livePalabra();
    for (let i = 0; i < 4; i++) h.session.appendAudio(chunk(i + 1));
    // 8 192 samples: one chunk of 7 680, 512 waiting.
    expect(h.appended().map((p) => p.length)).toEqual([CHUNK_SAMPLES]);
    expect(Array.from(h.appended()[0].subarray(2_046, 2_050))).toEqual([1, 1, 2, 2]);
    expect(h.of('frame').filter((f) => f.payload.direction === 'out').map((f) => f.payload.type)).toEqual(['task.set', 'task.get']);
  });

  it(`carries real-time silence once no audio has come for IDLE_MS (${IDLE_MS} ms): what waits first, padded, then one chunk a beat — never ahead of the clock`, async () => {
    const h = await livePalabra();
    const liveAt = h.clock.now();
    h.session.appendAudio(chunk());
    // The beat runs every 320 ms from the start; the idle begins at the first beat IDLE_MS after the last audio, and not a beat before.
    const idleBeat = Math.ceil(IDLE_MS / CHUNK_MS) * CHUNK_MS;
    h.clock.advance(idleBeat - CHUNK_MS);
    expect(h.appended()).toEqual([]);
    h.clock.advance(CHUNK_MS);
    expect(h.appended().map((p) => [p.length, isSilent(p)])).toEqual([[CHUNK_SAMPLES, false]]);
    expect(Array.from(h.appended()[0].subarray(2_046, 2_050))).toEqual([1_000, 1_000, 0, 0]);
    expect(h.frames('audio.idle')).toEqual([{ sinceMs: idleBeat }]);
    h.clock.advance(CHUNK_MS);
    expect(h.appended().slice(1).map((p) => [p.length, isSilent(p)])).toEqual([[CHUNK_SAMPLES, true]]);
    // A minute of idle: one chunk a beat, never more than the time allows.
    h.clock.advance(60_000);
    const sentMs = h.appended().length * CHUNK_MS;
    expect(sentMs).toBeLessThanOrEqual(h.clock.now() - liveAt);
    expect(h.frames('audio.idle')).toHaveLength(1);
  });

  it('resumed audio starts a chunk of its own, framed once; the beats then send nothing while audio keeps coming — no silence spliced into speech', async () => {
    const h = await livePalabra();
    h.clock.advance(IDLE_MS + CHUNK_MS);
    const idleChunks = h.appended().length;
    expect(idleChunks).toBeGreaterThan(0);
    // Speech again, one worklet chunk every 85 ms, for 2 s.
    for (let t = 0; t < 2_000; t += 85) {
      h.session.appendAudio(chunk(7));
      h.clock.advance(85);
    }
    const speech = h.appended().slice(idleChunks);
    expect(speech.length).toBe(Math.floor((24 * 2_048) / CHUNK_SAMPLES));
    for (const p of speech) expect(p.every((s) => s === 7)).toBe(true);
    expect(h.frames('audio.resumed')).toHaveLength(1);
  });

  it("waits past the ScriptProcessor fallback's 341 ms chunks: its gaps are no idle", async () => {
    const h = await livePalabra();
    for (let i = 0; i < 20; i++) {
      h.session.appendAudio(new Int16Array(8_192).fill(3));
      h.clock.advance(341);
    }
    expect(h.frames('audio.idle')).toEqual([]);
    for (const p of h.appended()) expect(p.every((s) => s === 3)).toBe(true);
  });

  it("waits past the participant fallback's 683 ms chunks too — the slowest capture cadence, and why IDLE_MS is 800: its gaps are no idle", async () => {
    const h = await livePalabra();
    // 16 384 samples at 24 kHz, 682.7 ms: forty of them sweep the chunk's phase against the 320 ms beat.
    for (let i = 0; i < 40; i++) {
      h.session.appendAudio(new Int16Array(16_384).fill(3));
      h.clock.advance(683);
    }
    expect(h.frames('audio.idle')).toEqual([]);
    for (const p of h.appended()) expect(p.every((s) => s === 3)).toBe(true);
  });

  it('under push-to-talk a release sends what waits at once, padded to a chunk; an empty press too; the idle silence follows', async () => {
    const h = await livePalabra({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.appended().map((p) => [p.length, p[0], p[CHUNK_SAMPLES - 1]])).toEqual([[CHUNK_SAMPLES, 1_000, 0]]);
    expect(h.frames('turn.flush')).toEqual([{ ms: Math.round((2_048 * 1000) / SAMPLE_RATE) }]);
    h.session.beginTurn();
    h.session.cancelTurn();
    expect(h.frames('turn.flush')[1]).toEqual({ ms: 0, cancelled: true });
    h.clock.advance(IDLE_MS + CHUNK_MS);
    expect(h.appended().slice(1).every(isSilent)).toBe(true);
    expect(h.appended().length).toBeGreaterThan(1);
  });

  it(`a release is idle from the next beat, not IDLE_MS (${IDLE_MS} ms) after the last audio: silence follows the padded remainder at once; the next press resumes (choice 7)`, async () => {
    const h = await livePalabra({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.appended()).toHaveLength(1);
    // The next beat, 320 ms on: the runner sends no audio between presses, so it is silence at once.
    h.clock.advance(CHUNK_MS);
    expect(h.appended().slice(1).map(isSilent)).toEqual([true]);
    expect(h.frames('audio.idle')).toEqual([{ sinceMs: CHUNK_MS }]);
    // The next press's audio ends the idle, and the beats stop sending while it comes.
    h.session.beginTurn();
    h.session.appendAudio(chunk(5));
    expect(h.frames('audio.resumed')).toHaveLength(1);
    const before = h.appended().length;
    h.clock.advance(CHUNK_MS);
    expect(h.appended()).toHaveLength(before);
  });

  it('a cancelled release is idle from the next beat too: the runner sends no audio after either (choice 7)', async () => {
    const h = await livePalabra({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.cancelTurn();
    expect(h.frames('turn.flush')).toEqual([{ ms: 0, cancelled: true }]);
    expect(h.appended()).toEqual([]);
    h.clock.advance(CHUNK_MS);
    expect(h.appended().map(isSilent)).toEqual([true]);
    expect(h.frames('audio.idle')).toEqual([{ sinceMs: CHUNK_MS }]);
  });

  it('push-to-talk never runs the stream ahead of real time: over 40 presses, what went up is at most a chunk past the time elapsed (choice 7)', async () => {
    const h = await livePalabra({ context: MANUAL_CTX });
    const liveAt = h.clock.now();
    // A capture chunk every 85⅓ ms: 85, 85 and 86 ms in turn.
    const steps = [85, 85, 86];
    let step = 0;
    // Every chunk that goes up is 320 ms, whatever it holds; counted without decoding it.
    const lead = () => h.socket().sent.filter((d) => typeof d === 'string' && d.startsWith('{"message_type":"input_audio_data"')).length * CHUNK_MS - (h.clock.now() - liveAt);
    let most = -Infinity;
    for (let press = 0; press < 40; press++) {
      h.session.beginTurn();
      for (let k = 0; k < 14; k++) {
        h.session.appendAudio(chunk());
        h.clock.advance(steps[step++ % 3]);
      }
      h.session.endTurn();
      most = Math.max(most, lead());
      // An idle of 0.7–1.0 s, its phase against the beat varied.
      const idle = 700 + ((press * 37) % 320);
      for (let t = 0; t < idle; t += 40) {
        h.clock.advance(40);
        most = Math.max(most, lead());
      }
    }
    expect(lead()).toBeLessThanOrEqual(CHUNK_MS);
    // A release's padded remainder may add a chunk the silence did not: never two.
    expect(most).toBeLessThan(2 * CHUNK_MS);
  });

  it(`a wall clock stepped back rebases the idle rule: the silence starts IDLE_MS (${IDLE_MS} ms) after the step, not after the size of the jump (choice 7)`, async () => {
    // A clock whose `now()` the test sets, its timers on a virtual clock: `realClock.now()` is `Date.now()`, which the system may move.
    let now = 50_000;
    const inner = createVirtualClock(0);
    const stepped: Clock = { now: () => now, setTimeout: (fn, ms) => inner.setTimeout(fn, ms) };
    const beat = () => { now += CHUNK_MS; inner.advance(CHUNK_MS); };
    const sockets = fakeSockets();
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: fakeRest().fetch }).start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: stepped, signal: new AbortController().signal },
      recordEvents().events,
    );
    sockets.last().open();
    now += POLL_MS;
    inner.advance(POLL_MS);
    sockets.last().receive(SERVER.currentTask());
    const session = await starting;
    const audio = () => sockets.last().sentJson<{ message_type: string }>().filter((m) => m.message_type === 'input_audio_data');
    session.appendAudio(chunk());
    // Ten seconds back: without the rebase, the silence would wait ten seconds more — long enough for SERVICE_TIMEOUT.
    now -= 10_000;
    // The first beat after the step rebases; the first beat IDLE_MS past it sends what waits, padded; the one after, silence.
    const beats = 1 + Math.ceil(IDLE_MS / CHUNK_MS) + 1;
    for (let i = 0; i < beats; i++) beat();
    expect(audio()).toHaveLength(2);
  });

  it('a wall clock stepped back rebases the stream once, not at every beat after: over 40 presses after a 10 s step, what went up is never two chunks past real time (choice 7)', async () => {
    let now = 50_000;
    const inner = createVirtualClock(0);
    const stepped: Clock = { now: () => now, setTimeout: (fn, ms) => inner.setTimeout(fn, ms) };
    const tick = (ms: number) => { now += ms; inner.advance(ms); };
    const sockets = fakeSockets();
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: fakeRest().fetch }).start(
      { context: MANUAL_CTX, config: configFor(MANUAL_CTX), credentials: KEY, clock: stepped, signal: new AbortController().signal },
      recordEvents().events,
    );
    sockets.last().open();
    tick(POLL_MS);
    sockets.last().receive(SERVER.currentTask());
    const session = await starting;
    // Real time since the leg went live, read on the virtual timers: the step does not move them.
    const liveAt = inner.now();
    tick(CHUNK_MS);
    // Ten seconds back, between two beats.
    now -= 10_000;
    tick(CHUNK_MS);
    // Every chunk that goes up is 320 ms, whatever it holds; counted without decoding it.
    const lead = () => sockets.last().sent.filter((d) => typeof d === 'string' && d.startsWith('{"message_type":"input_audio_data"')).length * CHUNK_MS - (inner.now() - liveAt);
    // A capture chunk every 85⅓ ms, as the 40-press case without a step.
    const steps = [85, 85, 86];
    let step = 0;
    let most = -Infinity;
    for (let press = 0; press < 40; press++) {
      session.beginTurn();
      for (let k = 0; k < 14; k++) {
        session.appendAudio(chunk());
        tick(steps[step++ % 3]);
      }
      session.endTurn();
      most = Math.max(most, lead());
      const idle = 700 + ((press * 37) % 320);
      for (let t = 0; t < idle; t += 40) {
        tick(40);
        most = Math.max(most, lead());
      }
    }
    expect(most).toBeLessThan(2 * CHUNK_MS);
  });

  it('under automatic turns a release sends nothing of its own', async () => {
    const h = await livePalabra();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.session.cancelTurn();
    expect(h.appended()).toEqual([]);
    expect(h.frames('turn.flush')).toEqual([]);
  });
});

describe("the Palabra AI adapter: a sentence's messages", () => {
  it("makes the probe's sentence into a source and its translation, paired by its id, the speech ranged once its burst is whole (ruling 6)", async () => {
    const h = await livePalabra();
    h.socket().receive(SERVER.partial('リアルタイム'));
    h.socket().receive(SERVER.validated());
    h.socket().receive(SERVER.translated());
    h.socket().receive(SERVER.audio());
    h.socket().receive(SERVER.audio({ last: true, samples: 2_859 }));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([
      { ref: 1, side: 'source', origin: SENTENCE },
      { ref: 2, side: 'translation', origin: SENTENCE },
    ]);
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.pcm.length])).toEqual([[2, 4_800], [2, 2_859]]);
    expect(h.of('speechRanges').map((e) => e.payload)).toEqual([{ ref: 2, ranges: [{ index: 0, range: [0, 51] }, { index: 1, range: [51, EN.length] }] }]);
    expect(h.frames('transcription.partial')).toEqual([{ id: SENTENCE, text: 'リアルタイム', start: 0.32, end: 5.66 }]);
    expect(h.frames('transcription.validated')).toEqual([{ id: SENTENCE, language: 'ja', text: JA, start: 0.32, end: 5.66 }]);
    expect(h.frames('translation.final')).toEqual([{ id: SENTENCE, part: '0', language: 'en', text: EN }]);
    expect(h.frames('audio.output')).toEqual([{ id: SENTENCE, part: '0', last: false, samples: 4_800 }, { id: SENTENCE, part: '0', last: true, samples: 2_859 }]);
  });

  it("logs the vendor's own language on the frames, even one outside the table", async () => {
    const h = await livePalabra();
    const withLanguage = (raw: string, language: string) => {
      const m = JSON.parse(raw);
      m.data.transcription.language = language;
      return JSON.stringify(m);
    };
    h.socket().receive(withLanguage(SERVER.validated(), 'ka'));
    h.socket().receive(withLanguage(SERVER.translated(), 'ka'));
    expect(h.frames('transcription.validated')).toMatchObject([{ language: 'ka' }]);
    expect(h.frames('translation.final')).toMatchObject([{ language: 'ka' }]);
  });

  it('on a leg that does not speak, frames the speech it gets anyway and plays none of it (ruling 7)', async () => {
    const h = await livePalabra({ context: { ...AUTO_CTX, speech: false } });
    expect(h.sent()[0]).toMatchObject({ data: { output_stream: null } });
    h.socket().receive(SERVER.translated());
    h.socket().receive(SERVER.audio({ last: true }));
    expect(h.of('audio')).toEqual([]);
    expect(h.frames('audio.output')).toHaveLength(1);
  });

  it("says the voice fell back once, on the first VOICE_NOT_FOUND; a stream's pacing warnings are the Logs' alone (ruling 11)", async () => {
    const h = await livePalabra();
    h.socket().receive(SERVER.voiceNotFound());
    h.socket().receive(SERVER.voiceNotFound());
    h.socket().receive(SERVER.warning('AUDIO_STREAM_TOO_SLOW', 'Too slow.'));
    expect(h.of('degraded').map((e) => e.payload)).toEqual([
      { code: 'voice_fallback', message: "Palabra did not have the voice asked for, and speaks in another: Voice ID 'default_low' is not available, using default voice" },
    ]);
    expect(h.frames('session.warning')).toEqual([
      { code: 'VOICE_NOT_FOUND', message: "Voice ID 'default_low' is not available, using default voice" },
      { code: 'VOICE_NOT_FOUND', message: "Voice ID 'default_low' is not available, using default voice" },
      { code: 'AUDIO_STREAM_TOO_SLOW', message: 'Too slow.' },
    ]);
  });

  it('frames a type it does not know, and end_of_stream; says a frame that will not read once per episode, and a chunk that will not decode as its own', async () => {
    const h = await livePalabra();
    h.socket().receive(SERVER.bare('session_heartbeat'));
    h.socket().receive(SERVER.endOfStream());
    h.socket().receive('not json');
    h.socket().receive('still not json');
    h.socket().receive(JSON.stringify({ message_type: 'output_audio_data', data: { transcription_id: SENTENCE, data: 7 } }));
    h.socket().receive(SERVER.audio());
    h.socket().receive('not json again');
    expect(h.frames('session.unknown')).toEqual([{ type: 'session_heartbeat' }]);
    expect(h.frames('session.end_of_stream')).toEqual([undefined]);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error', 'parse_error']);
    expect(h.frames('session.unreadable')).toHaveLength(3);
  });

  it('frames what comes before the task runs, and makes nothing of it', async () => {
    const h = startPalabra();
    h.socket().open();
    h.socket().receive(SERVER.validated());
    h.socket().receive(SERVER.audio({ last: true }));
    expect(h.frames('transcription.validated')).toHaveLength(1);
    expect(h.content()).toEqual([]);
  });
});

describe('the Palabra AI adapter: a session that ends (rulings 11, 12)', () => {
  it("a close within 10 s of an error reads in that error's words — SERVICE_TIMEOUT's 1008 among them — at the window's edge too", async () => {
    const h = await livePalabra();
    h.socket().receive(SERVER.serviceTimeout());
    h.clock.advance(ERROR_WORDS_MS);
    h.socket().serverClose(1008);
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([
      { code: 'server', message: '[Palabra SERVICE_TIMEOUT] No input audio received for 10s. Use the pause_task command for intentional pauses.' },
    ]);
    expect(h.frames('session.error')).toEqual([{ code: 'SERVICE_TIMEOUT', desc: 'No input audio received for 10s. Use the pause_task command for intentional pauses.', msg: null, param: null }]);
  });

  it('past the window a 1008 is the connection limit, and any other close the lost connection; nothing reconnects', async () => {
    const late = await livePalabra();
    late.socket().receive(SERVER.serviceTimeout());
    late.clock.advance(ERROR_WORDS_MS + 1);
    late.socket().serverClose(1008);
    await flush();
    expect(late.of('failed').map((e) => e.payload)).toEqual([{ code: 'rate_limit', message: RATE_LIMITED }]);

    const dropped = await livePalabra();
    dropped.socket().drop();
    await flush();
    expect(dropped.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to Palabra closed (1006).' }]);
    expect(dropped.sockets.all).toHaveLength(1);
    expect(dropped.timers()).toBe(0);
  });

  it('never words a close by an answer to its own ask, or by an error from a wall clock stepped back', async () => {
    const found = await livePalabra();
    found.socket().receive(SERVER.notFound());
    // After the start a NOT_FOUND is no expected answer: a red line, as any error.
    expect(found.frames('session.error')).toEqual([{ code: 'NOT_FOUND', desc: 'No active task found', msg: null, param: null }]);
    expect(found.frames('task.not_found')).toEqual([]);
    found.socket().serverClose(1011);
    await flush();
    expect(found.of('failed')[0].payload.code).toBe('connection_lost');

    // A clock whose `now()` the test sets: the error is stamped after the close it would word.
    let now = 50_000;
    const inner = createVirtualClock(0);
    const stepped: Clock = { now: () => now, setTimeout: (fn, ms) => inner.setTimeout(fn, ms) };
    const sockets = fakeSockets();
    const { events, log } = recordEvents();
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: fakeRest().fetch }).start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: stepped, signal: new AbortController().signal },
      events as AdapterEvents,
    );
    sockets.last().open();
    inner.advance(POLL_MS);
    sockets.last().receive(SERVER.currentTask());
    await starting;
    sockets.last().receive(SERVER.serviceTimeout());
    now = 40_000;
    sockets.last().serverClose(1011);
    await flush();
    expect(log.filter((e) => e.kind === 'failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to Palabra closed (1011).' }]);
  });

  it('an ending says failed once, then nothing but its delete\'s outcome; the app pair\'s session is deleted, and a later stop deletes nothing more', async () => {
    const h = await livePalabra({ credentials: APP });
    const logged = h.log.length;
    h.socket().serverClose(1011);
    await flush();
    h.socket().serverClose(1011);
    expect(h.of('failed')).toHaveLength(1);
    expect(h.rest.of('DELETE')).toHaveLength(1);
    await h.session.stop();
    expect(h.rest.of('DELETE')).toHaveLength(1);
    // The delete goes out as the leg ends, before its failed; its outcome after (Stage 2 session end, ruling 2 (ii)).
    expect(lines(h.log.slice(logged))).toEqual([
      ['session.connection_lost', { code: 1011, reason: '' }], ['session.delete'], ['failed'], ['session.deleted', { status: 204 }],
    ]);
    expect(h.timers()).toBe(0);
  });
});

describe('the Palabra AI adapter: stop (ruling 13)', () => {
  it('ends the task, framed, and closes the socket before its first await, what is in flight dropped; nothing more is said, and no timer is left (Stage 2 session end, ruling 2 (ii))', async () => {
    const h = await livePalabra();
    h.session.appendAudio(chunk());
    const logged = h.log.length;
    void h.session.stop();
    expect(h.sent().slice(-1)).toEqual([{ message_type: 'end_task', data: { force: true } }]);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    // The platform key's one line: it has no REST session to delete.
    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }]]);
    await flush();
    h.clock.advance(60_000);
    expect(h.log.length).toBe(logged + 1);
    expect(h.timers()).toBe(0);
  });

  it("a stop as the server's close comes in, before its close event lands, sends and frames no end_task: the socket is no longer open (Stage 2 session end, choice 4)", async () => {
    const h = await livePalabra();
    const socket = h.socket();
    const sent = socket.sent.length;
    socket.serverClose(1011);
    const logged = h.log.length;
    await h.session.stop();
    expect(socket.sent).toHaveLength(sent);
    expect(h.log.length).toBe(logged);
  });

  it("the app pair's stop sends its session's delete before its first await, with keepalive, and resolves once it is answered — each framed (Stage 2 session end, ruling 2 (ii))", async () => {
    const h = await livePalabra({ credentials: APP });
    const logged = h.log.length;
    const stopping = h.session.stop();
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: APP_HEADERS }]);
    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }], ['session.delete']]);
    await expect(stopping).resolves.toBeUndefined();
    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }], ['session.delete'], ['session.deleted', { status: 204 }]]);
    expect(h.timers()).toBe(0);
  });

  it('a delete that never answers is given its bound on the request\'s clock — 4 s, inside the runner\'s own — then the stop resolves, the delete a warning (Stage 2 session end, ruling 2 (ii); choice 5)', async () => {
    // 4 s: under the runner's own 5 s bound on a release (`adapter.runner.test.ts` shows why).
    expect(RELEASE_TIMEOUT_MS).toBe(4_000);
    const h = await livePalabra({ credentials: APP, rest: { remove: 'hang' } });
    const done = vi.fn();
    void h.session.stop().then(done);
    h.clock.advance(RELEASE_TIMEOUT_MS - 1);
    await flush();
    expect(done).not.toHaveBeenCalled();
    h.clock.advance(1);
    await flush();
    expect(done).toHaveBeenCalled();
    expect(h.rest.of('DELETE')[0].signal?.aborted).toBe(true);
    // The bound's own abort is not a transport failure to try again.
    expect(h.rest.of('DELETE')).toHaveLength(1);
    expect(h.frames('session.delete_warning')).toEqual([{ timeoutMs: RELEASE_TIMEOUT_MS }]);
    expect(h.timers()).toBe(0);
  });

  it("a delete refused with keepalive at the transport — a runtime refusing a keepalive request that needs a CORS preflight — goes again once, plain, and the stop resolves once that is answered (ruling 1)", async () => {
    const refused: RequestInit[] = [];
    const h = await livePalabra({
      credentials: APP,
      fetch: (rest) => (input, init = {}) => {
        if (init.method === 'DELETE' && init.keepalive === true) {
          refused.push(init);
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return rest.fetch(input, init);
      },
    });
    const logged = h.log.length;
    const stopping = h.session.stop();
    // The first goes before the stop's first await, with keepalive.
    expect(refused).toHaveLength(1);
    await expect(stopping).resolves.toBeUndefined();
    // Then exactly one more, plain: our own session's, with its credentials, and answered.
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), headers: APP_HEADERS }]);
    expect(h.rest.of('DELETE')[0].keepalive).not.toBe(true);
    expect(refused).toHaveLength(1);
    // One attempt framed, one outcome: the plain try's answer (Stage 2 session end, ruling 2 (ii)).
    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }], ['session.delete'], ['session.deleted', { status: 204 }]]);
    expect(h.timers()).toBe(0);
  });

  it('a delete that fails at the transport both times ends there: two attempts, a warning naming the error alone, no timer left (ruling 1; Stage 2 session end, ruling 2 (ii))', async () => {
    const attempts: RequestInit[] = [];
    const h = await livePalabra({
      credentials: APP,
      fetch: (rest) => (input, init = {}) => {
        if (init.method !== 'DELETE') return rest.fetch(input, init);
        attempts.push(init);
        return Promise.reject(new TypeError('Failed to fetch'));
      },
    });
    const logged = h.log.length;
    const done = vi.fn();
    void h.session.stop().then(done);
    await flush();
    expect(attempts.map((a) => a.keepalive === true)).toEqual([true, false]);
    expect(done).toHaveBeenCalled();
    expect(lines(h.log.slice(logged))).toEqual([['task.end', { force: true }], ['session.delete'], ['session.delete_warning', { error: 'TypeError' }]]);
    expect(h.timers()).toBe(0);
  });

  it("the plain try has only what is left of the delete's bound, on the request's clock: refused at 3 s, a plain one that never answers is given 1 s more, not 4 (ruling 1)", async () => {
    let refuse: () => void = () => {};
    const attempts: RequestInit[] = [];
    const h = await livePalabra({
      credentials: APP,
      fetch: (rest) => (input, init = {}) => {
        if (init.method !== 'DELETE') return rest.fetch(input, init);
        attempts.push(init);
        const { signal } = init;
        return new Promise<Response>((_resolve, reject) => {
          if (init.keepalive === true) refuse = () => reject(new TypeError('Failed to fetch'));
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });
    const done = vi.fn();
    void h.session.stop().then(done);
    h.clock.advance(3_000);
    refuse();
    await flush();
    expect(attempts.map((a) => a.keepalive === true)).toEqual([true, false]);
    h.clock.advance(RELEASE_TIMEOUT_MS - 3_000 - 1);
    await flush();
    expect(done).not.toHaveBeenCalled();
    h.clock.advance(1);
    await flush();
    expect(done).toHaveBeenCalled();
    expect(attempts[1].signal?.aborted).toBe(true);
    expect(h.frames('session.delete_warning')).toEqual([{ timeoutMs: RELEASE_TIMEOUT_MS }]);
    expect(h.timers()).toBe(0);
  });

  it.each([404, 500])('a delete Palabra answers with %i is its answer, not tried again, and a warning (ruling 1; Stage 2 session end, ruling 2 (ii))', async (status) => {
    const h = await livePalabra({ credentials: APP, rest: { remove: status } });
    await expect(h.session.stop()).resolves.toBeUndefined();
    await flush();
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true }]);
    expect(h.frames('session.delete_warning')).toEqual([{ status }]);
    expect(h.frames('session.deleted')).toEqual([]);
    expect(h.timers()).toBe(0);
  });
});
