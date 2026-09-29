/**
 * The kit's seeded lifecycle scenario (Stage 2 Palabra, ruling 15), run over
 * the kit's template adapter — which it must pass, every path taken — and
 * over broken variants of it, each of which it must catch.
 */
import { describe, it, expect } from 'vitest';
import type { Adapter, AdapterSession } from '../adapter';
import { every } from '../clock';
import { createEchoAdapter, type EchoConfig } from './examples';
import { FakeSocket } from './fakeSocket';
import { runLifecycles, type LifecycleHarness } from './lifecycle';

type Echo = Pick<Adapter<EchoConfig, { key: string }>, 'start'>;

function echoHarness(adapter: Echo = createEchoAdapter()): LifecycleHarness<EchoConfig, { key: string }> {
  return {
    adapter: () => adapter,
    config: (_context, run) => ({ openSocket: run.sockets.create }),
    credentials: { key: 'test-key' },
    secrets: ['test-key'],
    textInput: true,
    // The template has no bound of its own: its every opening settles.
    startBoundMs: 0,
    opening: (run) => {
      if (run.rand() < 0.1) run.sockets.last().serverClose(4001, 'bad key');
      else run.sockets.last().open();
    },
    server: (run) => {
      const socket = run.sockets.last();
      if (socket.readyState !== FakeSocket.OPEN) return;
      const r = run.rand();
      if (r < 0.8) socket.receive(JSON.stringify({ source: 'Hello.', translation: 'こんにちは。' }));
      else if (r < 0.9) socket.receive('not json');
      else socket.serverClose(1011, 'server error');
    },
  };
}

/** The template, with its session wrapped: what each broken variant changes. */
function wrapped(change: (session: AdapterSession, request: Parameters<Echo['start']>[0], events: Parameters<Echo['start']>[1]) => AdapterSession): Echo {
  return {
    start: async (request, events) => change(await createEchoAdapter().start(request, events), request, events),
  };
}

describe('runLifecycles', () => {
  it('passes the kit\'s template adapter over every path: refused, live, ended by the server, stopped', async () => {
    const report = await runLifecycles(echoHarness(), { seed: 7, runs: 200 });
    expect(report.failures).toEqual([]);
    expect(report.runs).toBe(200);
    for (const key of ['refused', 'live', 'stopped', 'end.closed']) expect(report.stats[key], key).toBeGreaterThan(0);
  });

  it('plays the same runs for the same seed', async () => {
    const a = await runLifecycles(echoHarness(), { seed: 11, runs: 40 });
    const b = await runLifecycles(echoHarness(), { seed: 11, runs: 40 });
    expect(a.stats).toEqual(b.stats);
  });

  it('catches a timer the session leaves armed', async () => {
    const leaking = wrapped((session, request) => { every(request.clock, 100, () => {}); return session; });
    const report = await runLifecycles(echoHarness(leaking), { seed: 7, runs: 20 });
    expect(report.failures.some((f) => f.endsWith('timer(s) still armed after the session ended'))).toBe(true);
  });

  it('catches a send after the session ended', async () => {
    // Its stop sends one frame after its first await, straight to the socket.
    const lateSender: Echo = {
      start: async (request, events) => {
        let socket: WebSocket | undefined;
        const session = await createEchoAdapter().start({ ...request, config: { openSocket: (url) => { socket = request.config.openSocket(url); return socket; } } }, events);
        return { ...session, stop: async () => { await Promise.resolve(); socket?.send('late'); await session.stop(); } };
      },
    };
    const report = await runLifecycles(echoHarness(lateSender), { seed: 7, runs: 20 });
    expect(report.failures.some((f) => f.endsWith('send(s) after the session ended'))).toBe(true);
  });

  it('catches an event said after stop', async () => {
    const chatty = wrapped((session, request, events) => ({
      ...session,
      stop: async () => { await session.stop(); request.clock.setTimeout(() => events.segmentOpened({ ref: 999, side: 'source' }), 100); },
    }));
    const report = await runLifecycles(echoHarness(chatty), { seed: 7, runs: 20 });
    expect(report.failures.some((f) => f.includes('conformance stop-silence'))).toBe(true);
  });

  it('catches a socket left open, and a secret in an event', async () => {
    const leaky: Echo = {
      start: async (request, events) => {
        const session = await createEchoAdapter().start(request, events);
        events.frame({ direction: 'out', type: 'session.key', payload: { note: `the key is ${request.credentials.key}` } });
        // Its stop forgets the socket.
        return { ...session, stop: async () => {} };
      },
    };
    const report = await runLifecycles(echoHarness(leaky), { seed: 7, runs: 20 });
    expect(report.failures.some((f) => f.endsWith('socket(s) left open after the session ended'))).toBe(true);
    expect(report.failures.some((f) => f.endsWith('a frame event carried a secret'))).toBe(true);
  });

  it('catches a start that never settles', async () => {
    const hangs: Echo = { start: () => new Promise<AdapterSession>(() => {}) };
    const report = await runLifecycles({ ...echoHarness(hangs), opening: () => {} }, { seed: 7, runs: 3 });
    expect(report.failures).toEqual([
      'run 0: the start neither resolved nor rejected once its bound had run',
      'run 1: the start neither resolved nor rejected once its bound had run',
      'run 2: the start neither resolved nor rejected once its bound had run',
    ]);
  });
});
