/**
 * The kit's seeded lifecycle scenario (Stage 2 Palabra, ruling 15), run over
 * the kit's template adapter — which it must pass, every path taken — and
 * over broken variants of it, each of which it must catch.
 */
import { describe, it, expect } from 'vitest';
import type { Adapter, AdapterEvents, AdapterSession } from '../adapter';
import { every } from '../clock';
import { MIN_VOICED_SAMPLES } from '../../session/turn';
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

/** The template, with its session wrapped: what a session-level broken variant changes. */
function wrapped(change: (session: AdapterSession, request: Parameters<Echo['start']>[0], events: Parameters<Echo['start']>[1]) => AdapterSession): Echo {
  return {
    start: async (request, events) => change(await createEchoAdapter().start(request, events), request, events),
  };
}

/** The template, with its events intercepted before the adapter sees them: what an events-level broken variant needs (a session that says `closed` and then `failed`, say — `wrapped` alone cannot reach the events the adapter itself calls). */
function withEvents(onEvents: (events: AdapterEvents, ctx: { request: Parameters<Echo['start']>[0] }) => AdapterEvents): Echo {
  return {
    start: async (request, events) => createEchoAdapter().start(request, onEvents(events, { request })),
  };
}

/** Any echo-shaped adapter, given its own clock-based start bound — mirroring a real provider's internal timeout (Palabra's `START_TIMEOUT_MS`, `adapter.ts:155-157`), which is what actually answers a start the opening never decides. Closes the socket it captures when the bound fires, as a real provider's own timeout does. */
function withOwnBound(adapter: Echo, boundMs: number): Echo {
  return {
    start: (request, events) => new Promise<AdapterSession>((resolve, reject) => {
      let ws: WebSocket | undefined;
      const req = { ...request, config: { openSocket: (url: string) => { ws = request.config.openSocket(url); return ws; } } };
      let settled = false;
      const cancel = request.clock.setTimeout(() => {
        if (settled) return;
        settled = true;
        ws?.close();
        reject(new Error(`the adapter's own bound ran out after ${boundMs} ms`));
      }, boundMs);
      adapter.start(req, events).then(
        (session) => { if (settled) return; settled = true; cancel(); resolve(session); },
        (error: unknown) => { if (settled) return; settled = true; cancel(); reject(error); },
      );
    }),
  };
}

/**
 * A harness whose opening sometimes decides nothing at all — the socket
 * stays CONNECTING — so the start is genuinely still pending once the
 * opening has run: reachable only by the kit's own mid-handshake abort, or
 * by the adapter's own bound once the kit runs its start bound out, exactly
 * as a real provider answers this (Palabra's own `START_TIMEOUT_MS`).
 */
function pendingHarness(): LifecycleHarness<EchoConfig, { key: string }> {
  return {
    ...echoHarness(withOwnBound(createEchoAdapter(), 5_000)),
    startBoundMs: 6_000,
    opening: (run) => {
      const r = run.rand();
      if (r < 0.3) return; // nothing at all: genuinely pending until the kit's abort or its bound
      if (r < 0.4) run.sockets.last().serverClose(4001, 'bad key');
      else run.sockets.last().open();
    },
  };
}

/** Deaf to the request's signal, like the runner's own signal is never re-read by an adapter once it starts a socket. */
function deafToAbort(): Echo {
  return {
    start: (request, events) => createEchoAdapter().start({ ...request, signal: new AbortController().signal }, events),
  };
}

/**
 * A harness whose opening never decides the start itself: the socket opens
 * only when the kit runs the start's own bound out (`clock.advance`), which
 * may be well after the kit's own mid-handshake abort already fired on a
 * genuinely pending start. Paired with an adapter deaf to that abort, this
 * is NB-2's case: a start that resolves anyway, despite the kit's abort.
 * `withOwnBound` is only a safety net for the kit's own pre-opening abort or
 * drop (`opening.abort` / `opening.drop`), which never calls `opening` at
 * all: without it those rare lives would hang, since nothing would ever
 * schedule the deferred `open()` below.
 */
function resolvesAfterAbortHarness(): LifecycleHarness<EchoConfig, { key: string }> {
  return {
    ...echoHarness(withOwnBound(deafToAbort(), 5_500)),
    startBoundMs: 6_000,
    // A pure microtask chain, longer than the kit's own decision window (up
    // to ~20 hops): the flush after it always fully drains a microtask
    // chain, however long, well before any clock advance — so the socket
    // opens on its own, with the clock-based bound above only a safety net
    // for the rare pre-opening abort/drop, which never calls this at all.
    opening: (run) => {
      void (async () => {
        for (let i = 0; i < 25; i++) await Promise.resolve();
        run.sockets.last().open();
      })();
    },
  };
}

describe('runLifecycles', () => {
  it('passes the kit\'s template adapter over every path: refused, live, ended by the server, stopped', async () => {
    const report = await runLifecycles(echoHarness(), { seed: 7, runs: 200 });
    expect(report.failures).toEqual([]);
    expect(report.runs).toBe(200);
    // opening.abort.early / opening.abort.late / opening.bound are pinned
    // separately, on `pendingHarness`: the template's own opening always
    // decides the start, so a post-opening abort or its bound never has a
    // genuinely pending start left to reach (NB-3).
    for (const key of ['refused', 'live', 'stopped', 'end.closed', 'opening.abort', 'opening.drop']) {
      expect(report.stats[key], key).toBeGreaterThan(0);
    }
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
    expect(report.failures.some((f) => /conformance stop-silence \(log index \d+\)/.test(f))).toBe(true);
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
      'seed 7 run 0: the start neither resolved nor rejected once its bound had run',
      'seed 7 run 1: the start neither resolved nor rejected once its bound had run',
      'seed 7 run 2: the start neither resolved nor rejected once its bound had run',
    ]);
  });

  it('catches an abort listener left attached after start, which speaks on the run\'s own stop', async () => {
    // The runner aborts the request's signal on every stop: a session that
    // answers its own abort is caught by `stop-silence`, not missed.
    const listening = wrapped((session, request, events) => {
      request.signal.addEventListener('abort', () => events.failed({ message: 'aborted' }));
      return session;
    });
    const report = await runLifecycles(echoHarness(listening), { seed: 7, runs: 60 });
    expect(report.failures.some((f) => f.includes('conformance stop-silence'))).toBe(true);
  });

  it('catches a session that says closed, then failed', async () => {
    const doubled = withEvents((events) => ({ ...events, closed: (e) => { events.closed(e); events.failed({ message: 'and failed' }); } }));
    const report = await runLifecycles(echoHarness(doubled), { seed: 7, runs: 60 });
    expect(report.failures.some((f) => f.endsWith('failed/closed events: at most one'))).toBe(true);
  });

  it('catches a refused start that speaks', async () => {
    const speaksOnRefusal: Echo = {
      start: async (request, events) => {
        try {
          return await createEchoAdapter().start(request, events);
        } catch (error) {
          events.failed({ message: 'refused', code: 'auth' });
          throw error;
        }
      },
    };
    const report = await runLifecycles(echoHarness(speaksOnRefusal), { seed: 7, runs: 60 });
    expect(report.failures.some((f) => f.endsWith('a refused start said failed'))).toBe(true);
  });

  it('catches a refused start that speaks 100 ms after its rejection', async () => {
    // Pins reading the refused start's log after the clock has run on: a
    // late speaker no marker or `ended` flag would otherwise catch.
    const speaksLate: Echo = {
      start: async (request, events) => {
        try {
          return await createEchoAdapter().start(request, events);
        } catch (error) {
          request.clock.setTimeout(() => events.failed({ message: 'late refusal' }), 100);
          throw error;
        }
      },
    };
    const report = await runLifecycles(echoHarness(speaksLate), { seed: 7, runs: 60 });
    expect(report.failures.some((f) => f.endsWith('a refused start said failed'))).toBe(true);
  });

  it('catches a start that throws synchronously', async () => {
    const throwing: Echo = { start: () => { throw new Error('sync throw'); } };
    const report = await runLifecycles(echoHarness(throwing), { seed: 7, runs: 5 });
    expect(report.failures.length).toBe(5);
    expect(report.failures.every((f) => f.includes('start threw rather than rejecting'))).toBe(true);
  });

  it('catches a step that throws', async () => {
    const throwingAudio = wrapped((session) => ({ ...session, appendAudio: () => { throw new Error('no audio'); } }));
    const report = await runLifecycles(echoHarness(throwingAudio), { seed: 7, runs: 60 });
    expect(report.failures.some((f) => /step \d+ \(\d+\.\d+\).*a step threw/.test(f))).toBe(true);
  });

  it('catches what the harness\'s after() names', async () => {
    const report = await runLifecycles({ ...echoHarness(), after: (run) => (run.index % 10 === 0 ? ['after: boom'] : []) }, { seed: 7, runs: 20 });
    expect(report.failures.filter((f) => f.endsWith('after: boom')).length).toBeGreaterThan(0);
  });

  it('catches the harness\'s opening() throwing, rather than rejecting the whole scenario', async () => {
    const report = await runLifecycles({ ...echoHarness(), opening: () => { throw new Error('boom'); } }, { seed: 7, runs: 5 });
    expect(report.failures.some((f) => f.includes('the harness\'s opening threw'))).toBe(true);
  });

  it('catches the unwind\'s stop() rejecting, rather than rejecting the whole scenario', async () => {
    const rejectingStop = wrapped((session) => ({ ...session, stop: async () => { await session.stop(); throw new Error('stop failed'); } }));
    const report = await runLifecycles(echoHarness(rejectingStop), { seed: 7, runs: 60 });
    expect(report.failures.some((f) => f.includes('the unwind\'s stop threw'))).toBe(true);
  });

  it('fails a stop that never returns within its bound, rather than hanging the scenario', async () => {
    const neverStops: Echo = {
      start: async (request, events) => {
        const session = await createEchoAdapter().start(request, events);
        return { ...session, stop: () => new Promise<void>(() => {}) };
      },
    };
    const report = await runLifecycles(echoHarness(neverStops), { seed: 7, runs: 20 });
    expect(report.failures.some((f) => f.endsWith('stop() did not return within its bound'))).toBe(true);
  });

  it('does not reject the scenario over a circular cause', async () => {
    const circular: Echo = {
      start: async (request, events) => {
        const session = await createEchoAdapter().start(request, events);
        const cause: Record<string, unknown> = { note: 'a cause that points at itself' };
        cause.self = cause;
        events.degraded({ code: 'parse_error', message: 'would not parse', cause });
        return session;
      },
    };
    const report = await runLifecycles(echoHarness(circular), { seed: 7, runs: 5 });
    expect(report.failures.some((f) => f.includes('the secret scan could not read'))).toBe(true);
  });

  it('replays a single failing run alone with from', async () => {
    const listening = wrapped((session, request, events) => {
      request.signal.addEventListener('abort', () => events.failed({ message: 'aborted' }));
      return session;
    });
    const full = await runLifecycles(echoHarness(listening), { seed: 7, runs: 60 });
    expect(full.failures.length).toBeGreaterThan(0);
    const n = Number(full.failures[0].match(/run (\d+)/)?.[1]);
    const alone = await runLifecycles(echoHarness(listening), { seed: 7, runs: n + 1, from: n });
    expect(alone.seed).toBe(7);
    expect(alone.failures).toEqual(full.failures.filter((f) => f.startsWith(`seed 7 run ${n}`)));
  });

  it('releases match the runner\'s own threshold for a turn of known length', async () => {
    // Every release must follow MIN_VOICED_SAMPLES exactly, except the small
    // raw draw kept for exploration: no mismatch may exceed that count.
    const violations: string[] = [];
    const counting: Echo = {
      start: async (request, events) => {
        const session = await createEchoAdapter().start(request, events);
        let held = 0;
        let inTurn = false;
        return {
          ...session,
          beginTurn: () => { inTurn = true; held = 0; session.beginTurn(); },
          appendAudio: (pcm) => { if (inTurn) held += pcm.length; session.appendAudio(pcm); },
          endTurn: () => { if (inTurn && held < MIN_VOICED_SAMPLES) violations.push(`endTurn at ${held} samples`); inTurn = false; session.endTurn(); },
          cancelTurn: () => { if (inTurn && held >= MIN_VOICED_SAMPLES) violations.push(`cancelTurn at ${held} samples`); inTurn = false; session.cancelTurn(); },
        };
      },
    };
    const report = await runLifecycles(echoHarness(counting), { seed: 7, runs: 300 });
    expect(report.failures).toEqual([]);
    expect(violations.length).toBeLessThanOrEqual(report.stats['release.raw'] ?? 0);
  });

  it('passes over an adapter that leaves typed text unanswered after a stop', async () => {
    // The text-input-answered rule is excluded on purpose: a random stop may
    // cut a typed text's answer short. An adapter that never answers it at
    // all must still pass.
    const silentText = wrapped((session) => ({ ...session, appendText: () => {} }));
    const report = await runLifecycles(echoHarness(silentText), { seed: 7, runs: 200 });
    expect(report.failures).toEqual([]);
  });

  it('passes over an adapter whose stop() sends a goodbye synchronously while still live', async () => {
    // Load-bearing: Palabra's stop() sends END_TASK synchronously, before its
    // first await. What stop() sends before it returns is its own.
    const goodbye: Echo = {
      start: async (request, events) => {
        let ws: WebSocket | undefined;
        const session = await createEchoAdapter().start({ ...request, config: { openSocket: (url) => { ws = request.config.openSocket(url); return ws; } } }, events);
        return { ...session, stop: () => { if (ws && ws.readyState === FakeSocket.OPEN) ws.send(JSON.stringify({ type: 'bye' })); return session.stop(); } };
      },
    };
    const report = await runLifecycles(echoHarness(goodbye), { seed: 7, runs: 200 });
    expect(report.failures).toEqual([]);
  });

  it('catches a goodbye sent after close() inside a live stop() (lost in a browser)', async () => {
    const lateGoodbye: Echo = {
      start: async (request, events) => {
        let ws: WebSocket | undefined;
        const session = await createEchoAdapter().start({ ...request, config: { openSocket: (url) => { ws = request.config.openSocket(url); return ws; } } }, events);
        return {
          ...session,
          stop: () => {
            const live = !!ws && ws.readyState === FakeSocket.OPEN;
            const ending = session.stop();
            if (live) ws!.send('bye');
            return ending;
          },
        };
      },
    };
    const report = await runLifecycles(echoHarness(lateGoodbye), { seed: 7, runs: 60 });
    expect(report.failures.some((f) => f.endsWith('send(s) after the session ended'))).toBe(true);
  });

  it('catches a send one microtask after a refusal', async () => {
    const t20: Echo = {
      start: async (request, events) => {
        let ws: WebSocket | undefined;
        try {
          return await createEchoAdapter().start({ ...request, config: { openSocket: (url) => { ws = request.config.openSocket(url); return ws; } } }, events);
        } catch (error) {
          queueMicrotask(() => { try { ws?.send('after the rejection'); } catch { /* CONNECTING throws */ } });
          throw error;
        }
      },
    };
    const report = await runLifecycles(echoHarness(t20), { seed: 7, runs: 60 });
    expect(report.failures.some((f) => f.endsWith('send(s) after the session ended'))).toBe(true);
  });

  it('reaches its own abort or the start bound while a start is still pending, and pins both', async () => {
    const report = await runLifecycles(pendingHarness(), { seed: 7, runs: 300 });
    expect(report.failures).toEqual([]);
    for (const key of ['opening.abort.early', 'opening.abort.late', 'opening.bound']) {
      expect(report.stats[key], key).toBeGreaterThan(0);
    }
  });

  it('stops at once, with no live step, a start that resolves after the kit already aborted it', async () => {
    const report = await runLifecycles(resolvesAfterAbortHarness(), { seed: 7, runs: 300 });
    expect(report.failures).toEqual([]);
    expect(report.stats['opening.abort.resolved'], 'opening.abort.resolved').toBeGreaterThan(0);
  });
});
