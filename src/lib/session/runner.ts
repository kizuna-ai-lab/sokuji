/**
 * The session runner (spec: "The runner"): a plain module outside React.
 * Every surface calls the same methods; the UI reads only `state`.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { describeCause, reportError, reportWarning } from '../diagnostics/report';
import type { LegName } from '../conversation/types';
import type { RunNoticeCode } from './codes';
import { ConversationSet, type ConversationInfo } from './conversationSet';
import { guardPorts, type ControlMethod, type RunnerDeps } from './ports';
import { LegOpenError, RefusedError, Run, type RunHost } from './run';
import type { LegState, RunEnd, RunState } from './types';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 15_000;

export interface Runner {
  readonly state: StoreApi<RunState>;
  /** The legs of the last run, until the next start replaces them. */
  readonly conversation: ConversationSet;
  start(method?: ControlMethod): Promise<void>;
  /** Idempotent: every call while a run ends returns the same promise. */
  stop(method?: ControlMethod): Promise<void>;
  /** `pagehide`: closes every leg and source synchronously; no auto-save, no end analytics. Idle: does nothing. */
  abandon(): void;
  press(): void;
  release(): void;
  sendText(text: string): void;
  /** Empties the conversation, and the queued audio with it. */
  clear(): void;
}

export function createRunner(rawDeps: RunnerDeps): Runner {
  // Every port a `Run` (and this runner) touches is guarded once, here: a
  // throwing port is reported and never reaches the run or an adapter (F1).
  const deps: RunnerDeps = { ...rawDeps, ...guardPorts(rawDeps) };
  const rawState = createStore<RunState>(() => ({ phase: 'idle' }));
  // zustand's own `listeners.forEach` stops at the first listener that
  // throws, hiding every phase from every subscriber registered after it
  // (F2). Wrapping `subscribe` — not `setState` — means every listener,
  // including React's own via `useStore`, is isolated from the others.
  const state: StoreApi<RunState> = {
    setState: rawState.setState,
    getState: rawState.getState,
    getInitialState: rawState.getInitialState,
    subscribe: (listener) => rawState.subscribe((next, prev) => {
      try {
        listener(next, prev);
      } catch (error) {
        reportError('SessionRunner', `A session-state subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'subscriber' });
      }
    }),
  };
  const conversation = new ConversationSet();
  let current: Run | null = null;
  let ending: Promise<void> | null = null;
  // A run `abandon()` has already forced idle: an `end()` for it already in
  // flight (a stop, a leg's end, a failed start) must not run its
  // analytics/`onRunEnded` branch, nor overwrite the idle state `abandon()`
  // set — `current` may already be a newer run by the time it finishes.
  const abandoned = new WeakSet<Run>();
  /** An ending that outlived its bound, still unwinding: the next start waits for it. */
  let lingering: Promise<void> | null = null;
  /** A start already waiting on `lingering`: a second one while it waits does nothing, as a second start while `starting` does today. */
  let waitingToStart = false;

  const set = (next: RunState) => { state.setState(next, true); };
  const legs = (run: Run) => Object.fromEntries(run.legStates) as Partial<Record<LegName, LegState>>;

  /** Races `task` against `timeoutMs`; a timeout is reported and treated as done, so a hung `onRunEnded` cannot strand the runner. */
  const bounded = (task: Promise<void>): Promise<void> => new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const cancel = deps.clock.setTimeout(() => {
      reportWarning('SessionRunner', 'Saving after the session timed out', { dedupeKey: 'onRunEnded:timeout' });
      finish();
    }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    task.then(
      () => { cancel(); finish(); },
      (error) => {
        cancel();
        reportError('SessionRunner', `After the session ended: ${describeCause(error)}`, { cause: error });
        finish();
      },
    );
  });

  /** The one way a run ends — stop, a leg ending, a failed start — once per run. */
  const end = (run: Run, result: RunEnd): Promise<void> => {
    if (run !== current) return Promise.resolve();
    if (ending) return ending;
    const liveSince = run.liveSince;
    // Claim the run before any side effect: `set` notifies subscribers and
    // `run.close()` runs abort listeners synchronously, and either may call
    // `stop()` — or a lease's `end` — again while this is still in flight.
    let finished!: () => void;
    const done = new Promise<void>((resolve) => { finished = resolve; });
    ending = done;
    void (async () => {
      // Never rejects: its own `try`/`catch` absorbs everything, so the race
      // below always sees it settle rather than hang on an unhandled throw.
      const work = (async () => {
        try {
          // A refused start opened nothing and played nothing: straight back to
          // idle, leaving a replay of the kept conversation playing.
          const refused = result.reason === 'refused';
          if (!refused) set({ phase: 'stopping' });
          // Captured before `run.close()`, so teardown time (a hung release,
          // the bounded wait for fill-in) is never counted as session duration.
          const endedAt = deps.clock.now();
          // Stop speaking now; the port is guarded, so a throw here cannot keep the run open.
          if (!refused) deps.playback.clear();
          await run.close();
          if (liveSince !== null && !abandoned.has(run)) {
            const duration = endedAt - liveSince;
            const provider = run.shape.provider.id;
            // One per leg, as `connected` was.
            run.shape.legs.forEach(() => deps.analytics.track('connection_status', { status: 'disconnected', provider, duration_ms: duration }));
            deps.analytics.track('translation_session_end', { session_id: run.id, duration, provider });
            if (deps.onRunEnded) await bounded(Promise.resolve(deps.onRunEnded(conversation.snapshot())));
          }
        } catch (error) {
          reportError('SessionRunner', `Ending the session failed: ${describeCause(error)}`, { cause: error });
        }
      })();
      try {
        // Bounds the whole ending — every release, the fill-in wait,
        // `onRunEnded` — at once, so a stop cannot take their sum.
        const overran = await new Promise<boolean>((resolve) => {
          const cancel = deps.clock.setTimeout(() => resolve(true), deps.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS);
          void work.then(() => { cancel(); resolve(false); });
        });
        if (overran) {
          reportWarning('SessionRunner', 'Stopping the session is taking long; it goes on in the background', { dedupeKey: 'close:timeout' });
          // Cleared when it finishes — unless a newer lingering ending replaced it meanwhile.
          const lingerFor: Promise<void> = work.then(() => { if (lingering === lingerFor) lingering = null; });
          lingering = lingerFor;
        }
      } finally {
        // Already forced idle by `abandon()`; `current` may already be a
        // newer run by now, so this stale closure must not touch it.
        if (!abandoned.has(run)) {
          current = null;
          ending = null;
          // `set` now absorbs a subscriber's throw; `finished()` still runs
          // last so `done` always resolves.
          set({ phase: 'idle', lastEnd: result });
        }
        finished();
      }
    })();
    return done;
  };

  const hostFor = (run: Run): RunHost => ({
    step: (step) => {
      if (run === current && state.getState().phase === 'starting') set({ phase: 'starting', step });
    },
    legState: () => {
      const now = state.getState();
      if (run === current && now.phase === 'running') set({ ...now, legs: legs(run) });
    },
    loading: (leg, progress) => {
      const now = state.getState();
      if (run === current && now.phase === 'starting') set({ ...now, loading: { leg, ...progress } });
    },
    conversations: (map, info: ConversationInfo) => conversation.replace(map, info),
    end: (result) => { void end(run, result); },
  });

  const start = async (method: ControlMethod = 'button'): Promise<void> => {
    if (state.getState().phase !== 'idle') return;
    if (lingering) {
      // The last run is still unwinding past its bound: never open a second one over it.
      if (waitingToStart) return;
      waitingToStart = true;
      try {
        await new Promise<void>((resolve) => {
          const cancel = deps.clock.setTimeout(resolve, deps.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS);
          void lingering!.then(() => { cancel(); resolve(); });
        });
      } finally {
        waitingToStart = false;
      }
      if (state.getState().phase !== 'idle') return;
    }
    deps.analytics.track('session_control_clicked', { action: 'start', method });
    const shape = deps.readShape();
    if (!shape) {
      set({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'no_provider' satisfies RunNoticeCode, message: 'No provider is chosen, or it has not loaded.' } } });
      return;
    }
    const run = new Run(deps, hostFor, shape);
    current = run;
    set({ phase: 'starting', step: 'checking' });
    try {
      await run.open();
    } catch (error) {
      if (run !== current || run.signal.aborted) return; // a stop or a leg's end is already ending it
      if (error instanceof RefusedError) {
        await end(run, { reason: 'refused', notice: error.refusal });
        return;
      }
      const leg = error instanceof LegOpenError ? error.leg : undefined;
      const message = describeCause(error);
      reportError('SessionRunner', `The session did not start: ${message}`, { cause: error });
      deps.analytics.track('error_occurred', {
        error_type: 'session_start', error_message: message, component: 'session-runner',
        severity: 'high', provider: shape.provider.id, recoverable: true,
      });
      await end(run, { reason: 'start-failed', notice: { code: 'start_failed' satisfies RunNoticeCode, message, ...(leg ? { leg } : {}) } });
      return;
    }
    if (run !== current || run.signal.aborted) return;
    set({ phase: 'running', since: run.liveSince!, legs: legs(run) });
    deps.analytics.track('translation_session_start', {
      session_id: run.id,
      provider: shape.provider.id,
      source_language: shape.pair.source,
      target_language: shape.pair.target,
      asr_model: run.models.asrModel,
      translation_model: run.models.translationModel,
      tts_model: run.models.ttsModel,
      transport: run.transport,
      platform: deps.platform,
      channels: [...shape.legs],
    });
  };

  const stop = (method: ControlMethod = 'button'): Promise<void> => {
    const run = current;
    if (!run) return Promise.resolve();
    if (!ending) {
      const action = state.getState().phase === 'starting' ? 'cancel' : 'stop';
      deps.analytics.track('session_control_clicked', { action, method });
    }
    return end(run, { reason: 'user' });
  };

  return {
    state,
    conversation,
    start,
    stop,
    abandon: () => {
      const run = current;
      if (!run) return;
      abandoned.add(run);
      current = null;
      ending = null;
      run.abandon();
      set({ phase: 'idle', lastEnd: { reason: 'user' } });
    },
    press: () => current?.press(),
    release: () => current?.release(),
    sendText: (text) => current?.sendText(text),
    clear: () => {
      conversation.clear();
      deps.playback.clear();
    },
  };
}
