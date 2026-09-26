import { describe, it, expect } from 'vitest';
import { AdapterStartError, type Adapter, type AdapterSession, type SessionContext } from '../adapter';
import { createFakeAdapter, type FakeConfig, type FakeCredentials } from '../../../providers/fake/adapter';
import { exchange } from '../../../providers/fake/script';
import { driveAdapter } from './drive';
import { createBrokenAdapter, createEchoAdapter, type EchoConfig } from './examples';
import { fakeSockets, type FakeSocket } from './fakeSocket';
import { runScenario, scenarioNames, type AdapterHarness } from './scenarios';

/** One exchange, on refs 1 (source) and 2 (translation). */
const base = () => exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello there.'], translation: 'こんにちは。', origin: 'x1', audioChunks: 2 });

const fakeHarness: AdapterHarness<FakeConfig, FakeCredentials> = {
  adapter: createFakeAdapter(),
  config: (_context, scenario) => {
    if (scenario === 'abort-while-opening') return { script: { blocks: [base()] }, faults: { startDelayMs: 1000 } };
    if (scenario === 'refused-while-opening') return { script: { blocks: [base()] }, faults: { startThrows: 'the fake server refused the key' } };
    if (scenario === 'server-close') {
      return { script: { blocks: [base(), { startAt: 4000, steps: [{ at: 0, closed: { reason: 'the fake server went away' } }] }] } };
    }
    if (scenario === 'reconnect') {
      return {
        script: {
          blocks: [
            base(),
            { startAt: 3000, steps: [{ at: 0, reconnecting: true }, { at: 500, reconnected: true }] },
            // Refs 3–4: never reused across the reconnect.
            exchange({ startAt: 4000, ref: 3, source: ['Again.'], translation: 'もう一度。', origin: 'x2' }),
          ],
        },
      };
    }
    return { script: { blocks: [base()] } };
  },
  credentials: {},
  // The fake opens at once, and plays its whole script inside one advance.
  opening: () => [],
  exchange: [{ advance: 8000 }],
  serverClose: [],
  // Its config refuses the start for this scenario.
  refuse: [],
  answerText: [],
  reconnect: [],
};

let sockets = fakeSockets();
const echoHarness: AdapterHarness<EchoConfig, { key: string }> = {
  adapter: createEchoAdapter(),
  config: () => {
    sockets = fakeSockets();
    return { openSocket: sockets.create };
  },
  credentials: { key: 'test-key' },
  opening: () => [{ run: () => sockets.last().open() }, { flush: true }],
  exchange: [{ run: () => sockets.last().receive(JSON.stringify({ source: 'Hello.', translation: 'こんにちは。' })) }],
  serverClose: [{ run: () => sockets.last().serverClose(1011, 'server error') }, { flush: true }],
  // No trailing flush: the driver flushes until the start settles.
  refuse: [{ run: () => sockets.last().serverClose(4001, 'bad key') }],
  answerText: [],
};

const brokenHarness: AdapterHarness<Record<string, never>, Record<string, never>> = {
  adapter: createBrokenAdapter(),
  config: () => ({}),
  credentials: {},
  opening: () => [],
  exchange: [],
  serverClose: [],
  refuse: [],
};

const AUTO: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const hangs = { start: () => new Promise<AdapterSession>(() => {}) };
const idle = (stop: () => Promise<void>): AdapterSession =>
  ({ info: {}, appendAudio() {}, appendText() {}, beginTurn() {}, endTurn() {}, cancelTurn() {}, stop });

/** The template before its fix: a close before `open` says `closed`, and the start never settles. */
const hangsOnRefusal: Pick<Adapter<EchoConfig, { key: string }>, 'start'> = {
  start: (request, events) => new Promise<AdapterSession>((resolve) => {
    const ws = request.config.openSocket('wss://echo.test/translate');
    request.signal.addEventListener('abort', () => ws.close(), { once: true });
    ws.onopen = () => resolve(idle(async () => { ws.close(1000); }));
    ws.onclose = (ev) => events.closed({ reason: `the socket closed (${ev.code})` });
  }),
};

/** Answers each frame after `delay()`: an adapter whose frame handling awaits (a Blob's text, a decoder). */
function lateEcho(delay: () => Promise<void>): Pick<Adapter<EchoConfig, { key: string }>, 'start'> {
  return {
    start: (request, events) => new Promise<AdapterSession>((resolve) => {
      const ws = request.config.openSocket('wss://echo.test/translate');
      let ended = false;
      ws.onopen = () => resolve(idle(async () => { ended = true; ws.close(1000); }));
      ws.onmessage = async (ev) => {
        await delay();
        // Dropped after stop, as an adapter must: so an answer the driver stopped too early for is lost.
        if (ended) return;
        const { source, translation } = JSON.parse(String(ev.data)) as { source: string; translation: string };
        events.segmentOpened({ ref: 1, side: 'source' });
        events.segmentText({ ref: 1, text: source });
        events.segmentClosed({ ref: 1 });
        events.segmentOpened({ ref: 2, side: 'translation' });
        events.segmentText({ ref: 2, text: translation });
        events.segmentClosed({ ref: 2 });
      };
    }),
  };
}
const hops = (n: number) => async () => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('runScenario', () => {
  it('the fake passes every scenario', async () => {
    const names = scenarioNames(fakeHarness);
    expect(names).toHaveLength(9);
    for (const name of names) {
      const report = await runScenario(fakeHarness, name);
      expect(report).toEqual({ name, violations: [], problems: [] });
    }
  });

  it('a socket adapter passes every scenario it can run, over FakeSocket', async () => {
    const names = scenarioNames(echoHarness);
    expect(names).toHaveLength(8);
    expect(names).not.toContain('reconnect');
    for (const name of names) {
      const report = await runScenario(echoHarness, name);
      expect(report).toEqual({ name, violations: [], problems: [] });
    }
  });

  it('a broken adapter is caught', async () => {
    const openStop = await runScenario(brokenHarness, 'open-stop');
    expect(openStop.problems).toContain('the exchange steps produced no segment');
    expect(openStop.violations.map((v) => v.rule)).toContain('stop-silence');

    const serverClose = await runScenario(brokenHarness, 'server-close');
    expect(serverClose.problems).toContain('the server ended the session and the adapter did not say so (failed or closed)');

    // The broken adapter resolves start at once, whatever its signal or its server says.
    const abort = await runScenario(brokenHarness, 'abort-while-opening');
    expect(abort.problems).toContain('start resolved although its signal aborted while it was opening');
    const refused = await runScenario(brokenHarness, 'refused-while-opening');
    expect(refused.problems).toContain('start resolved although the server refused the connection while it was opening');
  });

  it('catches a start that ignores its abort signal and hangs', async () => {
    const hung = 'start neither resolved nor rejected (it hung) although its signal aborted while it was opening';
    // The template without its abort listener: it waits for an open that never comes.
    const deaf: Pick<Adapter<EchoConfig, { key: string }>, 'start'> = {
      start: (request, events) => createEchoAdapter().start({ ...request, signal: new AbortController().signal }, events),
    };
    expect((await runScenario({ ...echoHarness, adapter: deaf }, 'abort-while-opening')).problems).toContain(hung);
    expect((await runScenario({ ...brokenHarness, adapter: hangs }, 'abort-while-opening')).problems).toContain(hung);
  });

  it('catches a start that hangs when its connection is refused, and a closed for a session that never began', async () => {
    const { problems } = await runScenario({ ...echoHarness, adapter: hangsOnRefusal }, 'refused-while-opening');
    expect(problems).toContain('start neither resolved nor rejected (it hung) although the server refused the connection while it was opening');
    expect(problems).toContain('closed or failed was emitted although the server refused the connection while it was opening: the rejection alone says so');
  });

  it('says a start that hung hung, rather than that it rejected', async () => {
    const { problems } = await runScenario({ ...brokenHarness, adapter: hangs }, 'open-stop');
    expect(problems).toContain('start neither resolved nor rejected after the opening steps (it hung)');
    expect(problems.some((p) => p.startsWith('start rejected'))).toBe(false);
  });

  it('sees an answer that lands microtasks or a macrotask after the last step, with no flush in the harness', async () => {
    const delays: Array<[string, () => Promise<void>]> = [
      ['1 hop', hops(1)], ['2 hops', hops(2)], ['3 hops', hops(3)], ['4 hops', hops(4)], ['6 hops', hops(6)],
      ['one macrotask', macrotask],
      ['3 hops, then a macrotask', async () => { await hops(3)(); await macrotask(); }],
    ];
    for (const [label, delay] of delays) {
      const report = await runScenario({ ...echoHarness, adapter: lateEcho(delay) }, 'open-stop');
      expect({ label, problems: report.problems, violations: report.violations }).toEqual({ label, problems: [], violations: [] });
    }
  });

  it('asks a harness only for what it has', async () => {
    const names = scenarioNames({});
    expect(names).not.toContain('text');
    expect(names).not.toContain('reconnect');
    await expect(runScenario(brokenHarness, 'text')).rejects.toThrow('this harness takes no typed text');
  });
});

describe('createEchoAdapter, the template', () => {
  const drive = (refuse: (socket: FakeSocket) => void) => {
    const sockets = fakeSockets();
    return driveAdapter(createEchoAdapter(), {
      context: AUTO,
      config: { openSocket: sockets.create },
      credentials: { key: 'test-key' },
      opening: [{ run: () => refuse(sockets.last()) }],
    });
  };

  it('rejects a start whose connection is refused while opening, with a notice code, and says nothing else', async () => {
    const badKey = await drive((s) => s.serverClose(4001, 'bad key'));
    expect(badKey.startOutcome).toBe('rejected');
    expect(badKey.startError).toBeInstanceOf(AdapterStartError);
    expect(badKey.startError).toMatchObject({ code: 'auth', params: { detail: 'bad key' } });
    expect(badKey.log).toEqual([]);

    const dropped = await drive((s) => s.drop());
    expect(dropped.startOutcome).toBe('rejected');
    expect(dropped.startError).toMatchObject({ code: 'network' });
    expect(dropped.log).toEqual([]);
  });

  it('degrades on a frame that will not parse, and goes on', async () => {
    const r = await runScenario(
      { ...echoHarness, exchange: [{ run: () => sockets.last().receive('not json') }, ...echoHarness.exchange] },
      'open-stop',
    );
    expect(r).toEqual({ name: 'open-stop', violations: [], problems: [] });

    const sockets2 = fakeSockets();
    const driven = await driveAdapter(createEchoAdapter(), {
      context: AUTO,
      config: { openSocket: sockets2.create },
      credentials: { key: 'test-key' },
      opening: [{ run: () => sockets2.last().open() }],
      steps: [{ run: () => sockets2.last().receive('not json') }],
    });
    const degraded = driven.log.filter((e) => e.kind === 'degraded');
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toMatchObject({ payload: { code: 'parse_error' } });
  });
});
