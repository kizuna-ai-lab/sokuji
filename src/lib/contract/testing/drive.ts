/**
 * The scenario driver (F9): starts an adapter on a virtual clock, plays a
 * list of steps at it — the caller's side (audio, text, turns, stop, a
 * cancel) and the server's (the test's own `run` steps: a FakeSocket's
 * frames) — records every event with the markers conformance reads, stops
 * the session, runs the clock on to catch anything that fires after the
 * end, and checks the log (`checkConformance`).
 *
 * Real time is flushed, the virtual clock never moved, at two points: after
 * the opening steps, until `start` settles; and after the last step, before
 * the driver's own `stop()`, so an answer an adapter awaits (a Blob's text,
 * a decoder: microtasks, then one macrotask) still lands before it. A step
 * list needs no trailing `{ flush: true }`; one belongs only between two
 * steps whose order matters — an answer that must land before the server
 * close the next step sends.
 *
 * The clock convention for adapters and the protocol modules they own:
 * every timer reads the request's `clock` — `clock.setTimeout`,
 * `every(clock, ms, fn)` for an interval, `clock.now()` for the time —
 * never the global `setTimeout` / `setInterval` / `Date.now`
 * (`src/providers/sessionSide.consistency.test.ts` holds the session side
 * to it). Here the clock is virtual, so a minute of keep-alive is one
 * `{ advance: 60_000 }`. Test-only.
 */
import type { Adapter, AdapterSession, Punctuator, SessionContext } from '../adapter';
import { SAMPLE_RATE } from '../adapter';
import { createVirtualClock, type VirtualClock } from '../clock';
import { checkConformance, recordConformance, type ConformanceLog, type Violation } from '../conformance';

export interface ScenarioHandles {
  /** The session `start` resolved with; null while it opens, or when it rejected. */
  session: AdapterSession | null;
  clock: VirtualClock;
  log: ConformanceLog;
}

export type ScenarioStep =
  | { advance: number }
  | { flush: true }
  /** `appendAudio`: this many ms of voiced pcm. */
  | { audio: number }
  /** `appendText`, marked for the typed-text rule. */
  | { text: string }
  /** A turn's key: press; release with speech; release without (the last two marked, though no conformance rule reads those markers yet). */
  | { turn: 'begin' | 'end' | 'cancel' }
  /** Abort the request's signal: a cancel. */
  | { abort: true }
  /** `stop()`, marked and awaited. */
  | { stop: true }
  /** The test's own step: a server frame, a socket drop. */
  | { run(handles: ScenarioHandles): void | Promise<void> };

export interface DriveOptions<C, K> {
  context: SessionContext;
  config: C;
  credentials: K;
  /** Run while `start` is still pending: what lets it resolve (the server's handshake), or cancels it. */
  opening?: readonly ScenarioStep[];
  /** Run once `start` has resolved; skipped when it rejected. */
  steps?: readonly ScenarioStep[];
  /** After the steps the session is stopped (unless a step did), then the clock runs this much further. Default 10 000 ms. */
  settleMs?: number;
  input?: MediaStreamTrack;
  punctuate?: Punctuator;
}

export interface DriveResult {
  log: ConformanceLog;
  session: AdapterSession | null;
  /** How `start` ended: resolved, rejected (or threw), or hung — neither, once the opening steps and the flushes after them had run. */
  startOutcome: 'resolved' | 'rejected' | 'hung';
  /** What `start` rejected or threw with; an Error saying so when it hung; undefined when it resolved. */
  startError: unknown;
  violations: Violation[];
  clock: VirtualClock;
}

/** One macrotask: every pending promise and microtask (a FakeSocket's close) has run. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** This many ms of 24 kHz pcm, voiced: a 440 Hz tone at a fifth of full scale. */
export function voicedPcm(ms: number): Int16Array {
  const out = new Int16Array(Math.round((SAMPLE_RATE * ms) / 1000));
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 6554);
  return out;
}

/** How many flushes a start may take to settle once its opening steps have run. */
const START_FLUSHES = 20;
/** Flushes after the last step, before the driver's own stop: the second catches a macrotask queued after microtask hops. */
const ANSWER_FLUSHES = 2;
type Settled = { session: AdapterSession } | { error: unknown };

export async function driveAdapter<C, K>(adapter: Pick<Adapter<C, K>, 'start'>, o: DriveOptions<C, K>): Promise<DriveResult> {
  const clock = createVirtualClock(0);
  const controller = new AbortController();
  const recorder = recordConformance();
  const handles: ScenarioHandles = { session: null, clock, log: recorder.log };
  const box: { settled: Settled | null; stopped: boolean } = { settled: null, stopped: false };
  const read = (): Settled | null => box.settled;
  const stop = async () => {
    if (!handles.session || box.stopped) return;
    box.stopped = true;
    recorder.mark('stop');
    await handles.session.stop();
  };
  const play = async (step: ScenarioStep): Promise<void> => {
    if ('advance' in step) clock.advance(step.advance);
    else if ('flush' in step) await flush();
    else if ('audio' in step) handles.session?.appendAudio(voicedPcm(step.audio));
    else if ('text' in step) { recorder.mark('appendText', step.text); handles.session?.appendText(step.text); }
    else if ('turn' in step) {
      if (step.turn === 'begin') handles.session?.beginTurn();
      else if (step.turn === 'end') { recorder.mark('endTurn'); handles.session?.endTurn(); }
      else { recorder.mark('cancelTurn'); handles.session?.cancelTurn(); }
    } else if ('abort' in step) controller.abort(new Error('the scenario cancelled the start'));
    else if ('stop' in step) await stop();
    else await step.run(handles);
  };
  const result = (startOutcome: DriveResult['startOutcome'], startError: unknown): DriveResult =>
    ({ log: recorder.log, session: handles.session, startOutcome, startError, violations: checkConformance(recorder.log, o.context), clock });

  let started: Promise<AdapterSession>;
  try {
    started = adapter.start(
      { context: o.context, config: o.config, credentials: o.credentials, clock, signal: controller.signal, input: o.input, punctuate: o.punctuate },
      recorder.events,
    );
  } catch (error) {
    // A start that throws breaks the contract; it is reported as the rejection it should have been.
    started = Promise.reject(error);
  }
  void started.then((session) => { box.settled = { session }; }, (error: unknown) => { box.settled = { error }; });
  for (const step of o.opening ?? []) await play(step);
  for (let i = 0; i < START_FLUSHES && read() === null; i++) await flush();
  const settled = read();
  if (settled === null) return result('hung', new Error('start neither resolved nor rejected after the opening steps'));
  if ('error' in settled) {
    // Anything an adapter emits after a rejected start is still caught (the abort scenario reads it).
    clock.advance(o.settleMs ?? 10_000);
    await flush();
    return result('rejected', settled.error);
  }
  handles.session = settled.session;
  for (const step of o.steps ?? []) await play(step);
  for (let i = 0; i < ANSWER_FLUSHES; i++) await flush();
  await stop();
  clock.advance(o.settleMs ?? 10_000);
  await flush();
  return result('resolved', undefined);
}
