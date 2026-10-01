/**
 * The kit's seeded lifecycle scenario (Stage 2 Palabra, ruling 15): many
 * random lives of one adapter, each driven the way the runner drives it —
 * audio always under automatic turns, only while a key is held under manual
 * ones; a press, a release matching the runner's own end-or-cancel threshold
 * (`turn.ts`); typed text where the provider takes it; the server's own
 * steps, the clock, a dropped connection, an abort mid-opening, a stop —
 * over FakeSockets on a virtual clock, and checked for what every adapter
 * owes whatever the interleaving. Modelled on the fuzz testing OpenAI
 * Translate and OpenAI Realtime's own final passes did; the conformance
 * scenarios pin one path each, this one many orders of the same steps.
 *
 * What it checks, per run:
 * - the start settles: it resolves or rejects once the opening and the
 *   start's own bound have run, never hangs;
 * - a refused start says nothing but frames and status — its rejection is
 *   the one report of it (the same admission `mustReject` makes in
 *   `scenarios.ts`: content and `closed`/`failed` are flagged, a status
 *   event is not);
 * - once the session has ended — a `failed` or `closed`, or `stop()` has
 *   returned — nothing more goes up any socket, and at most one of
 *   `failed` / `closed` is said;
 * - a stop — the kit's random one, or its own unwind of a session that
 *   ended on its own — aborts the request's signal first and marks the log
 *   before that, exactly as the runner's own stop does: an adapter that
 *   answers its own abort with anything but a frame is caught by
 *   `stop-silence`, not missed; the log is marked again once `stop()` has
 *   returned, and only a frame the ending says of itself before that mark is
 *   admitted (Stage 2 session end, choice 3);
 * - `stop()` is given a bound of its own: a session whose release never
 *   answers is failed by name, not left to hang the scenario;
 * - with the clock run on after the end, no timer is armed and every
 *   socket the adapter opened is closed;
 * - no event carries a secret the harness names;
 * - the whole log passes `checkConformance`, less `text-input-answered`: a
 *   random stop may cut a typed text's answer short;
 * - and whatever the harness checks after a run (`after`).
 *
 * Each run draws from its own generator, seeded from the run's seed and its
 * own index: a run replays on its own, with no dependency on any run
 * before it. A failure names its seed, its run, and — for a step — the
 * step and the draw that chose it. Test-only, like the rest of the kit.
 */
import type { Adapter, AdapterSession, SessionContext } from '../adapter';
import { createVirtualClock, type VirtualClock } from '../clock';
import { checkConformance, recordConformance, type ConformanceLog } from '../conformance';
import { MIN_VOICED_SAMPLES } from '../../session/turn';
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
  /** Aborts the run's own request signal, the way a Stop does. */
  abort(reason?: unknown): void;
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
   * or refused the harness's own ways. The kit adds its own on top: the
   * start's signal aborted or the newest socket dropped before the opening
   * runs, and — while the start is still pending once it has — the signal
   * aborted mid-handshake too, before or after a few hops.
   */
  opening(run: LifecycleRun): void | Promise<void>;
  /** One thing the server does while the session is live, drawn from `run.rand`: a message, an error, a close. */
  server(run: LifecycleRun): void | Promise<void>;
  /** `stop()`'s own bound: how long the clock runs before a session whose release never answers is failed by name. Default 10 000 ms. */
  stopBoundMs?: number;
  /** After a run has ended and the clock has run on: the harness's own invariants, as problems. */
  after?(run: LifecycleRun, log: ConformanceLog): string[];
}

export interface LifecycleReport {
  seed: number;
  runs: number;
  /** `seed <s> run <n>[ step <i> (<op>)]: <problem>`, at most 40. */
  failures: string[];
  /**
   * How often each path was taken: `refused`, `live`, `end.failed.<code>`,
   * `end.closed`, `stopped`, `opening.abort`, `opening.drop` (the kit's own,
   * before the opening runs), `opening.abort.early` / `opening.abort.late`
   * (the kit's own, while the start was still pending after it), and the
   * harness's own counts.
   */
  stats: Record<string, number>;
}

/** A few microtask hops: a FakeSocket's close and an awaited fake answer land within them. */
const hops = async (n = 10) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
/** Capture chunk sizes the runner hands over: the worklet's 85 ms, the ScriptProcessor fallback's 341 ms, and odd ones. */
const CHUNKS = [480, 2_048, 2_400, 4_800, 8_192] as const;
const ADVANCES = [10, 100, 320, 500, 1_000, 2_100, 5_000, 10_000] as const;
const MAX_FAILURES = 40;
const DEFAULT_STOP_BOUND_MS = 10_000;
/** Near the old, unconditional early-abort rate: how often the kit aborts mid-handshake, once the start is genuinely still pending after the opening. */
const OPENING_ABORT_P = 0.06;
/** A refused start's log, read the way `mustReject` reads a scenario's refusal (`scenarios.ts`): content and `closed`/`failed` are flagged, a status event is admitted. */
const REFUSED_CONTENT = new Set(['segmentOpened', 'segmentText', 'segmentClosed', 'audio']);
const REFUSED_ENDED = new Set(['closed', 'failed']);

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

export async function runLifecycles<C, K>(h: LifecycleHarness<C, K>, o: { seed: number; runs: number; from?: number }): Promise<LifecycleReport> {
  const failures: string[] = [];
  const stats: Record<string, number> = {};
  const count = (key: string) => { stats[key] = (stats[key] ?? 0) + 1; };
  const stopBoundMs = h.stopBoundMs ?? DEFAULT_STOP_BOUND_MS;

  for (let index = o.from ?? 0; index < o.runs; index++) {
    const fail = (problem: string, step?: { i: number; op: number }) => {
      if (failures.length >= MAX_FAILURES) return;
      const where = step ? ` step ${step.i} (${step.op.toFixed(3)})` : '';
      failures.push(`seed ${o.seed} run ${index}${where}: ${problem}`);
    };
    // Each run draws from its own generator, derived from the seed and the
    // index: it replays on its own, with no dependency on any run before it.
    const rand = seeded(o.seed ^ Math.imul(index, 0x9e3779b1));
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
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
          // `state.ended` alone is a race for a refused start: a send a
          // mutant schedules right as the rejection settles can run before
          // any reaction attached to that same promise (a plain callback
          // queued ahead of a `.then` is always a hop earlier). `CLOSED` has
          // no such lag: it is set only as the close event is delivered, so
          // the adapter has been told. `CLOSING` counts only when the
          // adapter closed the socket itself (`closedByClient`): a send
          // queued before a close it has not yet heard of — a continuation
          // racing a server close or drop, or a timer task a browser could
          // run in that window — is not a "send after the session ended"
          // from anyone's point of view, and a browser drops it the same
          // way. `CONNECTING` is left out: `FakeSocket` throws there, as a
          // browser does, and a leak or a refusal already reports it.
          if (state.ended || socket.readyState === FakeSocket.CLOSED || (socket.readyState === FakeSocket.CLOSING && socket.closedByClient !== null)) state.lateSends += 1;
          send(data);
        };
        return ws;
      },
      get all() { return inner.all; },
      last: () => inner.last(),
    };
    const controller = new AbortController();
    const run: LifecycleRun = {
      index, rand, pick, clock, sockets, context, count,
      abort: (reason) => controller.abort(reason ?? new Error('the lifecycle aborted the run')),
    };
    /** Awaits `stop()`'s promise within `stopBoundMs` of clock time; fails by name and gives up rather than hanging the scenario. */
    const awaitStop = async (ending: Promise<void>): Promise<void> => {
      let settledStop = false;
      void ending.then(() => { settledStop = true; }, () => { settledStop = true; });
      await hops();
      if (!settledStop) {
        clock.advance(stopBoundMs);
        await flush();
      }
      if (!settledStop) {
        fail('stop() did not return within its bound');
        // It may still settle later: never an unhandled rejection for it.
        void ending.catch(() => {});
        return;
      }
      await ending;
      // What the ending framed of itself came before this; a frame after it is late (Stage 2 session end, choice 3).
      recorder.mark('stopped');
    };
    const recorder = recordConformance();
    const events = recorder.events;
    const watched = { ...events };
    watched.failed = (e) => { state.terminals += 1; state.ended = true; count(`end.failed.${e.code ?? 'none'}`); events.failed(e); };
    watched.closed = (e) => { state.terminals += 1; state.ended = true; count('end.closed'); events.closed(e); };

    const settled: { session?: AdapterSession; error?: unknown; done: boolean } = { done: false };
    let starting: Promise<AdapterSession>;
    try {
      starting = h.adapter(run).start({ context, config: h.config(context, run), credentials: h.credentials, clock, signal: controller.signal }, watched);
    } catch (error) {
      fail(`start threw rather than rejecting: ${String(error)}`);
      continue;
    }
    void starting.then(
      (session) => { settled.session = session; settled.done = true; },
      (error: unknown) => { settled.error = error; settled.done = true; state.ended = true; },
    );

    // The opening: the kit's own abort or drop before it runs, or the
    // harness's own opening. Only once that has settled, a hop lets
    // anything already in flight catch up — a resolution the kit has not
    // yet observed is not "still opening" — before the kit decides, on a
    // random draw, whether to abort mid-handshake too: the realistic "Stop
    // pressed while connecting" race. Not drawn, or resolved anyway despite
    // it: the start's own bound gets its turn below, as it always did.
    let abortedWhileOpening = false;
    const roll = rand();
    if (roll < 0.03) { run.abort(new Error('the lifecycle cancelled the start')); count('opening.abort'); }
    else if (roll < 0.06 && sockets.all.length > 0) { sockets.last().drop(); count('opening.drop'); }
    else {
      try {
        await h.opening(run);
      } catch (error) {
        fail(`the harness's opening threw: ${String(error)}`);
      }
      await hops();
      if (!settled.done && rand() < OPENING_ABORT_P) {
        if (rand() < 0.5) {
          run.abort(new Error('the lifecycle aborted while the start was still opening'));
          abortedWhileOpening = true;
          count('opening.abort.early');
        } else {
          count('opening.abort.late');
          await hops(Math.floor(rand() * 11));
          if (!settled.done) {
            run.abort(new Error('the lifecycle aborted while the start was still opening'));
            abortedWhileOpening = true;
          }
        }
      }
    }
    await hops();
    await flush();
    if (!settled.done) {
      count('opening.bound');
      clock.advance(h.startBoundMs);
      await hops();
      await flush();
    }
    if (!settled.done) {
      fail('the start neither resolved nor rejected once its bound had run');
      run.abort(new Error('the lifecycle gave up on the start'));
      await flush();
      continue;
    }

    const session = settled.session;
    if (!session) {
      count('refused');
      state.ended = true;
    } else if (abortedWhileOpening) {
      // The runner's own shape: a start that resolves into an already
      // aborted run defers nothing — `openLeg` unwinds it at once
      // (`run.ts`), with no live step in between.
      count('opening.abort.resolved');
      recorder.mark('stop');
      try {
        const ending = session.stop();
        state.ended = true;
        await awaitStop(ending);
      } catch (error) {
        state.ended = true;
        fail(`the unwind's stop threw: ${String(error)}`);
      }
    } else {
      count('live');
      let held = false;
      let heldSamples = 0;
      const steps = 20 + Math.floor(rand() * 80);
      for (let i = 0; i < steps && !state.ended; i++) {
        const op = rand();
        try {
          if (op < 0.1) {
            if (context.turns === 'manual' && !held) { held = true; heldSamples = 0; session.beginTurn(); }
          } else if (op < 0.2) {
            if (context.turns === 'manual' && held) {
              held = false;
              // Matches the runner's own rule for a manual release
              // (`turn.ts`): end only when the held turn reached at least
              // `MIN_VOICED_SAMPLES` (500 ms at 24 kHz), else cancel. A
              // small raw draw keeps some exploration of a ratio the
              // runner itself would never produce.
              if (rand() < 0.05) {
                count('release.raw');
                if (rand() < 0.8) { recorder.mark('endTurn'); session.endTurn(); } else { recorder.mark('cancelTurn'); session.cancelTurn(); }
              } else if (heldSamples >= MIN_VOICED_SAMPLES) { recorder.mark('endTurn'); session.endTurn(); } else { recorder.mark('cancelTurn'); session.cancelTurn(); }
            }
          } else if (op < 0.45) {
            if (context.turns === 'auto' || held) {
              const pcm = new Int16Array(pick(CHUNKS)).fill(900);
              if (context.turns === 'manual' && held) heldSamples += pcm.length;
              session.appendAudio(pcm);
            }
          } else if (op < 0.5) {
            if (h.textInput) { const text = pick(['Hello.', 'こんにちは。', ' x ']); recorder.mark('appendText', text); session.appendText(text); }
          } else if (op < 0.8) {
            await h.server(run);
            await hops(Math.floor(rand() * 11));
          } else if (op < 0.97) {
            clock.advance(pick(ADVANCES));
            await hops(Math.floor(rand() * 11));
          } else if (op < 0.985) {
            if (sockets.all.length > 0) { sockets.last().drop(); await hops(Math.floor(rand() * 11)); }
          } else {
            recorder.mark('stop');
            count('stopped');
            run.abort(new Error('the run ended'));
            // What `stop()` sends before it returns — a goodbye frame, then the close — is its own; anything after is late.
            const ending = session.stop();
            state.ended = true;
            await awaitStop(ending);
          }
        } catch (error) {
          fail(`a step threw: ${String(error)}`, { i, op });
        }
      }
      // A session that ended by itself is stopped, as the runner's unwind does; one still live, by the kit.
      if (!recorder.log.some((e) => e.kind === 'marker' && e.payload === 'stop')) {
        recorder.mark('stop');
        run.abort(new Error('the run ended'));
        try {
          const ending = session.stop();
          state.ended = true;
          await awaitStop(ending);
        } catch (error) {
          state.ended = true;
          fail(`the unwind's stop threw: ${String(error)}`);
        }
      }
    }

    clock.advance(10_000);
    await hops();
    await flush();
    if (!settled.session) {
      for (const e of recorder.log) {
        if (e.kind === 'marker') continue;
        if (REFUSED_CONTENT.has(e.kind) || REFUSED_ENDED.has(e.kind)) fail(`a refused start said ${e.kind}`);
      }
    }
    if (clock.pending() > 0) fail(`${clock.pending()} timer(s) still armed after the session ended`);
    const open = sockets.all.filter((s) => s.readyState !== FakeSocket.CLOSED).length;
    if (open > 0) fail(`${open} socket(s) left open after the session ended`);
    if (state.lateSends > 0) fail(`${state.lateSends} send(s) after the session ended or into a closed socket`);
    if (state.terminals > 1) fail(`${state.terminals} failed/closed events: at most one`);
    for (const e of recorder.log) {
      if (e.kind === 'marker') continue;
      let text: string;
      try {
        text = readable(e.payload);
      } catch (error) {
        fail(`the secret scan could not read a ${e.kind} event: ${String(error)}`);
        continue;
      }
      for (const secret of h.secrets) if (text.includes(secret)) fail(`a ${e.kind} event carried a secret`);
    }
    for (const v of checkConformance(recorder.log, context)) {
      if (v.rule !== 'text-input-answered') fail(`conformance ${v.rule} (log index ${v.index}): ${v.detail}`);
    }
    try {
      for (const problem of h.after?.(run, recorder.log) ?? []) fail(problem);
    } catch (error) {
      fail(`the harness's after() threw: ${String(error)}`);
    }
  }
  return { seed: o.seed, runs: o.runs, failures, stats };
}
