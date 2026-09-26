import { describe, it, expect } from 'vitest';
import { createFakeAdapter, type FakeConfig, type FakeCredentials } from '../../../providers/fake/adapter';
import { exchange } from '../../../providers/fake/script';
import { createBrokenAdapter, createEchoAdapter, type EchoConfig } from './examples';
import { fakeSockets } from './fakeSocket';
import { runScenario, scenarioNames, type AdapterHarness } from './scenarios';

/** One exchange, on refs 1 (source) and 2 (translation). */
const base = () => exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello there.'], translation: 'こんにちは。', origin: 'x1', audioChunks: 2 });

const fakeHarness: AdapterHarness<FakeConfig, FakeCredentials> = {
  adapter: createFakeAdapter(),
  config: (_context, scenario) => {
    if (scenario === 'abort-while-opening') return { script: { blocks: [base()] }, faults: { startDelayMs: 1000 } };
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
  answerText: [],
};

const brokenHarness: AdapterHarness<Record<string, never>, Record<string, never>> = {
  adapter: createBrokenAdapter(),
  config: () => ({}),
  credentials: {},
  opening: () => [],
  exchange: [],
  serverClose: [],
};

describe('runScenario', () => {
  it('the fake passes every scenario', async () => {
    const names = scenarioNames(fakeHarness);
    expect(names).toHaveLength(8);
    for (const name of names) {
      const report = await runScenario(fakeHarness, name);
      expect(report).toEqual({ name, violations: [], problems: [] });
    }
  });

  it('a socket adapter passes every scenario it can run, over FakeSocket', async () => {
    const names = scenarioNames(echoHarness);
    expect(names).toHaveLength(7);
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

    // The broken adapter resolves start at once, whatever its signal says.
    const abort = await runScenario(brokenHarness, 'abort-while-opening');
    expect(abort.problems).toContain('start resolved although its signal aborted while it was opening');
  });

  it('asks a harness only for what it has', async () => {
    const names = scenarioNames({});
    expect(names).not.toContain('text');
    expect(names).not.toContain('reconnect');
    await expect(runScenario(brokenHarness, 'text')).rejects.toThrow('this harness takes no typed text');
  });
});
