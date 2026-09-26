/**
 * The session runner (spec: "The runner"): a plain module outside React.
 * Every surface calls the same methods; the UI reads only `state`.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { AdapterStartError } from '../contract/adapter';
import { describeCause, reportError, reportWarning } from '../diagnostics/report';
import type { LegName } from '../conversation/types';
import type { RunNoticeCode } from './codes';
import { ConversationSet, type ConversationInfo } from './conversationSet';
import { guardPorts, type ControlMethod, type RunnerDeps } from './ports';
import { LegOpenError, RefusedError, retentionFor, Run, type RunHost } from './run';
import type { LegState, RunEnd, RunState } from './types';

const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_CLOSE_TIMEOUT_MS = 15_000;

export interface Runner {
  readonly state: StoreApi<RunState>;
  /** The legs of the last run, until the next start replaces them. */
  readonly conversation: ConversationSet;
  start(method?: ControlMethod): Promise<void>;
  /** Idempotent: every call while a run ends returns the same promise. Resolves by the overall bound (`closeTimeoutMs`); `settled()` waits for what outlives it. */
  stop(method?: ControlMethod): Promise<void>;
  /** Resolves once no ending is in flight and none still unwinds past its bound (what an Electron close awaits); at once when there is neither. */
  settled(): Promise<void>;
  /** `pagehide`: closes every leg and source synchronously — the run's, or those of an ending still unwinding past its bound; no auto-save, no end analytics. Idle with neither: does nothing. */
  abandon(): void;
  press(): void;
  release(): void;
  /** Whether the speaker's voice is fed into processing now — what the mic strip shows: while running, except under push-to-talk only while a turn is held. False when idle, starting or stopping. */
  speakerAudioInUse(): boolean;
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
  // `keepReplayAudio` takes effect at once: the kept conversation and a live run alike. The runner lives as long as the page.
  deps.replayAudio?.subscribe(() => {
    const retention = retentionFor(deps.replayAudio!.get());
    for (const leg of ['speaker', 'participant'] as const) conversation.get(leg)?.setRetention(retention);
  });
  let current: Run | null = null;
  let ending: Promise<void> | null = null;
  // A run `abandon()` has already forced idle: an `end()` for it already in
  // flight (a stop, a leg's end, a failed start) must not run its
  // analytics/`onRunEnded` branch, nor overwrite the idle state `abandon()`
  // set — `current` may already be a newer run by the time it finishes.
  const abandoned = new WeakSet<Run>();
  /**
   * An ending that outlived its bound, still unwinding and still this
   * runner's: `abandon()` reaches it, and a start is refused until it has
   * finished, so two runs never hold the microphone at once.
   */
  let lingering: { run: Run; done: Promise<void> } | null = null;

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
          deps.playback.live(false);
          await run.close();
          if (liveSince !== null && !abandoned.has(run)) {
            const duration = endedAt - liveSince;
            const provider = run.shape.provider.id;
            // One per leg, as `connected` was.
            run.shape.legs.forEach((leg) => deps.analytics.track('connection_status', { status: 'disconnected', provider, duration_ms: duration, channel: leg }));
            deps.analytics.track('translation_session_end', { session_id: run.id, duration, provider });
            // The run's own legs, never the runner's conversation set: an
            // ending that outlived its bound must save what it ran.
            if (deps.onRunEnded) await bounded(Promise.resolve(deps.onRunEnded(run.legs())));
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
        // An abandoned run is no longer this runner's: it never lingers.
        if (overran && !abandoned.has(run)) {
          reportWarning('SessionRunner', 'Stopping the session is taking long; it goes on in the background', { dedupeKey: 'close:timeout' });
          // Cleared when it finishes — unless `abandon()` already let it go.
          const linger: { run: Run; done: Promise<void> } = { run, done: work.then(() => { if (lingering === linger) lingering = null; }) };
          lingering = linger;
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
    // The replay of the last conversation stops where that conversation goes:
    // refs restart per run, so its clip keys would alias the new run's segments.
    conversations: (map, info: ConversationInfo) => { deps.playback.clear(); conversation.replace(map, info); },
    end: (result) => { void end(run, result); },
  });

  const start = async (method: ControlMethod = 'button'): Promise<void> => {
    if (state.getState().phase !== 'idle') return;
    deps.analytics.track('session_control_clicked', { action: 'start', method });
    if (lingering) {
      // The last run is still unwinding past its bound: never open a second one over it.
      set({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'still_stopping' satisfies RunNoticeCode, message: 'The last session is still stopping.' } } });
      return;
    }
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
      const failure = error instanceof LegOpenError ? error.failure : error;
      const adapterError = failure instanceof AdapterStartError ? failure : undefined;
      const message = describeCause(error);
      reportError('SessionRunner', `The session did not start: ${message}`, { cause: error });
      deps.analytics.track('error_occurred', {
        error_type: 'session_start', error_message: message, component: 'session-runner',
        severity: 'high', provider: shape.provider.id, recoverable: true,
      });
      await end(run, {
        reason: 'start-failed',
        notice: {
          code: adapterError?.code ?? ('start_failed' satisfies RunNoticeCode),
          message,
          ...(adapterError?.params ? { params: adapterError.params } : {}),
          ...(leg ? { leg } : {}),
        },
      });
      return;
    }
    if (run !== current || run.signal.aborted) return;
    // Before the state says running: a subscriber that stops the run at once
    // must leave playback not live, not live again after its stop.
    deps.playback.live(true);
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
    settled: async () => {
      // An ending in flight may overrun into a lingering one: wait until neither is left.
      for (let wait = ending ?? lingering?.done; wait; wait = ending ?? lingering?.done) await wait;
    },
    abandon: () => {
      // The current run, or an ending still unwinding past its bound — never
      // both, since a start is refused while one lingers.
      const run = current ?? lingering?.run;
      if (!run) return;
      const wasCurrent = run === current;
      abandoned.add(run);
      current = null;
      ending = null;
      lingering = null;
      run.abandon();
      deps.playback.live(false);
      deps.playback.clear();
      // A lingering run already shows idle, with its own end: that stays as it is.
      if (wasCurrent) set({ phase: 'idle', lastEnd: { reason: 'user' } });
    },
    press: () => current?.press(),
    release: () => current?.release(),
    // The phase too: `end()` says stopping before the run itself starts ending.
    speakerAudioInUse: () => state.getState().phase === 'running' && (current?.speakerAudioInUse() ?? false),
    sendText: (text) => current?.sendText(text),
    clear: () => {
      conversation.clear();
      deps.playback.clear();
    },
  };
}
