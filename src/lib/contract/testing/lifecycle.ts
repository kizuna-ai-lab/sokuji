/**
 * The kit's seeded lifecycle scenario (Stage 2 Palabra, ruling 15): many
 * random lives of one adapter, each driven the way the runner drives it —
 * audio always under automatic turns, only while a key is held under manual
 * ones; a press, a release with or without speech; typed text where the
 * provider takes it; the server's own steps, the clock, a dropped
 * connection, a stop — over FakeSockets on a virtual clock, and checked for
 * what every adapter owes whatever the interleaving. Modelled on the OpenAI
 * Translate and OpenAI Realtime final reviews' fuzzes; the conformance
 * scenarios pin one path each, this one many orders of the same steps.
 *
 * What it checks, per run:
 * - the start settles: it resolves or rejects once the opening and the
 *   start's own bound have run, never hangs;
 * - a refused start says nothing but frames — its rejection is the one
 *   report of it;
 * - once the session has ended — a `failed` or `closed`, or `stop()` has
 *   returned — nothing more goes up any socket, and at most one of
 *   `failed` / `closed` is said;
 * - with the clock run on after the end, no timer is armed and every
 *   socket the adapter opened is closed;
 * - no event carries a secret the harness names;
 * - the whole log passes `checkConformance`, less `text-input-answered`: a
 *   random stop may cut a typed text's answer short;
 * - and whatever the harness checks after a run (`after`).
 *
 * The generator is seeded: a failure names its run, and the same seed plays
 * the same runs. Test-only, like the rest of the kit.
 */
import type { Adapter, AdapterSession, SessionContext } from '../adapter';
import { createVirtualClock, type VirtualClock } from '../clock';
import { checkConformance, recordConformance, type ConformanceLog } from '../conformance';
import { flush } from './drive';
import { FakeSocket, fakeSockets, type FakeSockets } from './fakeSocket';

/** One run, as the harness sees it. */
export interface LifecycleRun {
  /** The run's number, from 0: what a failure names. */
  readonly index: number;
  /** The seeded generator, in [0, 1): the harness draws its choices from it, so a seed replays them. */
  rand(): number;
  pick<T>(items: readonly T[]): T;
  readonly clock: VirtualClock;
  /** The run's sockets: the harness hands `sockets.create` to its adapter. */
  readonly sockets: FakeSockets;
  readonly context: SessionContext;
  /** Counts an outcome of the harness's own in the report's stats. */
  count(key: string): void;
}

export interface LifecycleHarness<C, K> {
  /** A fresh adapter for one run, over the run's sockets and whatever else the harness fakes (a REST server). */
  adapter(run: LifecycleRun): Pick<Adapter<C, K>, 'start'>;
  config(context: SessionContext, run: LifecycleRun): C;
  credentials: K;
  /** No event may carry any of these: the credentials, and whatever the harness's fakes hand out as secret. */
  secrets: readonly string[];
  /** The provider takes typed text: typed text is one of the random steps. */
  textInput: boolean;
  /** The start's own bound: a start still pending once the opening has run is given this much clock. */
  startBoundMs: number;
  /**
   * One way the start goes, drawn from `run.rand`: the handshake answered,
   * or refused the harness's own ways. The kit adds two of its own: the
   * start's signal aborted, and the newest socket dropped.
   */
  opening(run: LifecycleRun): void | Promise<void>;
  /** One thing the server does while the session is live, drawn from `run.rand`: a message, an error, a close. */
  server(run: LifecycleRun): void | Promise<void>;
  /** After a run has ended and the clock has run on: the harness's own invariants, as problems. */
  after?(run: LifecycleRun, log: ConformanceLog): string[];
}

export interface LifecycleReport {
  runs: number;
  /** `run <n>: <problem>`, at most 40. */
  failures: string[];
  /** How often each path was taken: `refused`, `live`, `end.failed.<code>`, `end.closed`, `stopped`, and the harness's own counts. */
  stats: Record<string, number>;
}

/** A few microtask hops: a FakeSocket's close and an awaited fake answer land within them. */
const hops = async (n = 10) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
/** Capture chunk sizes the runner hands over: the worklet's 85 ms, the ScriptProcessor fallback's 341 ms, and odd ones. */
const CHUNKS = [480, 2_048, 2_400, 4_800, 8_192] as const;
const ADVANCES = [10, 100, 320, 500, 1_000, 2_100, 5_000, 10_000] as const;
const MAX_FAILURES = 40;

/** mulberry32: small, seeded, and the same on every platform. */
function seeded(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The payload as the checks read it: pcm elided, so a key scan never reads audio. */
const readable = (value: unknown) => JSON.stringify(value ?? {}, (_k, v: unknown) => (v instanceof Int16Array ? `pcm(${v.length})` : v));

export async function runLifecycles<C, K>(h: LifecycleHarness<C, K>, o: { seed: number; runs: number }): Promise<LifecycleReport> {
  const rand = seeded(o.seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const failures: string[] = [];
  const stats: Record<string, number> = {};
  const count = (key: string) => { stats[key] = (stats[key] ?? 0) + 1; };

  for (let index = 0; index < o.runs; index++) {
    const fail = (problem: string) => { if (failures.length < MAX_FAILURES) failures.push(`run ${index}: ${problem}`); };
    const context: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: rand() < 0.7, turns: rand() < 0.5 ? 'manual' : 'auto' };
    const clock = createVirtualClock(0);
    // Set the moment the session has ended: a send from then on is a failure.
    const state = { ended: false, lateSends: 0, terminals: 0 };
    const inner = fakeSockets();
    const sockets: FakeSockets = {
      create: (url, protocols) => {
        const ws = inner.create(url, protocols);
        const socket = inner.last();
        const send = socket.send.bind(socket);
        socket.send = (data) => {
          if (state.ended) state.lateSends += 1;
          send(data);
        };
        return ws;
      },
      get all() { return inner.all; },
      last: () => inner.last(),
    };
    const run: LifecycleRun = { index, rand, pick, clock, sockets, context, count };
    const recorder = recordConformance();
    const events = recorder.events;
    const watched = { ...events };
    watched.failed = (e) => { state.terminals += 1; state.ended = true; count(`end.failed.${e.code ?? 'none'}`); events.failed(e); };
    watched.closed = (e) => { state.terminals += 1; state.ended = true; count('end.closed'); events.closed(e); };

    const controller = new AbortController();
    const settled: { session?: AdapterSession; error?: unknown; done: boolean } = { done: false };
    let starting: Promise<AdapterSession>;
    try {
      starting = h.adapter(run).start({ context, config: h.config(context, run), credentials: h.credentials, clock, signal: controller.signal }, watched);
    } catch (error) {
      fail(`start threw rather than rejecting: ${String(error)}`);
      continue;
    }
    void starting.then((session) => { settled.session = session; settled.done = true; }, (error: unknown) => { settled.error = error; settled.done = true; });

    // The opening: the kit's two ways, or the harness's own.
    const roll = rand();
    if (roll < 0.03) controller.abort(new Error('the lifecycle cancelled the start'));
    else if (roll < 0.06 && sockets.all.length > 0) sockets.last().drop();
    else await h.opening(run);
    await hops();
    if (!settled.done) {
      clock.advance(h.startBoundMs);
      await hops();
      await flush();
    }
    if (!settled.done) {
      fail('the start neither resolved nor rejected once its bound had run');
      controller.abort(new Error('the lifecycle gave up on the start'));
      await flush();
      continue;
    }

    const session = settled.session;
    if (!session) {
      count('refused');
      state.ended = true;
      for (const e of recorder.log) {
        if (e.kind !== 'marker' && e.kind !== 'frame') fail(`a refused start said ${e.kind}`);
      }
    } else {
      count('live');
      let held = false;
      const steps = 20 + Math.floor(rand() * 80);
      for (let i = 0; i < steps && !state.ended; i++) {
        const op = rand();
        try {
          if (op < 0.1) {
            if (context.turns === 'manual' && !held) { held = true; session.beginTurn(); }
          } else if (op < 0.2) {
            if (context.turns === 'manual' && held) {
              held = false;
              if (rand() < 0.8) { recorder.mark('endTurn'); session.endTurn(); } else { recorder.mark('cancelTurn'); session.cancelTurn(); }
            }
          } else if (op < 0.45) {
            if (context.turns === 'auto' || held) session.appendAudio(new Int16Array(pick(CHUNKS)).fill(900));
          } else if (op < 0.5) {
            if (h.textInput) { const text = pick(['Hello.', 'こんにちは。', ' x ']); recorder.mark('appendText', text); session.appendText(text); }
          } else if (op < 0.8) {
            await h.server(run);
            await hops();
          } else if (op < 0.97) {
            clock.advance(pick(ADVANCES));
            await hops();
          } else if (op < 0.985) {
            if (sockets.all.length > 0) { sockets.last().drop(); await hops(); }
          } else {
            recorder.mark('stop');
            count('stopped');
            // What `stop()` sends before it returns — a goodbye frame, then the close — is its own; anything after is late.
            const ending = session.stop();
            state.ended = true;
            await ending;
          }
        } catch (error) {
          fail(`a step threw: ${String(error)}`);
        }
      }
      // A session that ended by itself is stopped, as the runner's unwind does; one still live, by the kit.
      if (!recorder.log.some((e) => e.kind === 'marker' && e.payload === 'stop')) {
        recorder.mark('stop');
        const ending = session.stop();
        state.ended = true;
        await ending;
      }
    }

    clock.advance(10_000);
    await hops();
    await flush();
    if (clock.pending() > 0) fail(`${clock.pending()} timer(s) still armed after the session ended`);
    const open = sockets.all.filter((s) => s.readyState !== FakeSocket.CLOSED).length;
    if (open > 0) fail(`${open} socket(s) left open after the session ended`);
    if (state.lateSends > 0) fail(`${state.lateSends} send(s) after the session ended`);
    if (state.terminals > 1) fail(`${state.terminals} failed/closed events: at most one`);
    for (const e of recorder.log) {
      if (e.kind === 'marker') continue;
      const text = readable(e.payload);
      for (const secret of h.secrets) if (text.includes(secret)) fail(`a ${e.kind} event carried a secret`);
    }
    for (const v of checkConformance(recorder.log, context)) {
      if (v.rule !== 'text-input-answered') fail(`conformance ${v.rule}: ${v.detail}`);
    }
    for (const problem of h.after?.(run, recorder.log) ?? []) fail(problem);
  }
  return { runs: o.runs, failures, stats };
}
