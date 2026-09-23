/**
 * The session runner (spec: "The runner"): a plain module outside React.
 * Every surface calls the same methods; the UI reads only `state`.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { describeCause, reportError, reportWarning } from '../diagnostics/report';
import type { LegName } from '../conversation/types';
import { ConversationSet } from './conversationSet';
import type { ControlMethod, RunnerDeps } from './ports';
import { LegOpenError, RefusedError, Run, type RunHost } from './run';
import type { LegState, RunEnd, RunState } from './types';

const DEFAULT_TIMEOUT_MS = 5_000;

export interface Runner {
  readonly state: StoreApi<RunState>;
  /** The legs of the last run, until the next start replaces them. */
  readonly conversation: ConversationSet;
  start(method?: ControlMethod): Promise<void>;
  /** Idempotent: every call while a run ends returns the same promise. */
  stop(method?: ControlMethod): Promise<void>;
  press(): void;
  release(): void;
  sendText(text: string): void;
  /** Empties the conversation, and the queued audio with it. */
  clear(): void;
}

export function createRunner(deps: RunnerDeps): Runner {
  const state = createStore<RunState>(() => ({ phase: 'idle' }));
  const conversation = new ConversationSet();
  let current: Run | null = null;
  let ending: Promise<void> | null = null;

  /** A subscriber's bug is reported, never thrown into the runner: zustand stores the state before notifying, so the phase stays right. */
  const set = (next: RunState) => {
    try {
      state.setState(next, true);
    } catch (error) {
      reportError('SessionRunner', `A session-state subscriber threw: ${describeCause(error)}`, { cause: error });
    }
  };
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
      try {
        set({ phase: 'stopping' });
        // Stop speaking now; a throwing port must not keep the run open.
        try {
          deps.playback.clear();
        } catch (error) {
          reportError('SessionRunner', `Silencing playback failed: ${describeCause(error)}`, { cause: error });
        }
        await run.close();
        if (liveSince !== null) {
          const duration = deps.clock.now() - liveSince;
          const provider = run.shape.provider.id;
          // One per leg, as `connected` was.
          run.shape.legs.forEach(() => deps.analytics.track('connection_status', { status: 'disconnected', provider, duration_ms: duration }));
          deps.analytics.track('translation_session_end', { session_id: run.id, duration, provider });
          if (deps.onRunEnded) await bounded(Promise.resolve(deps.onRunEnded(conversation.snapshot())));
        }
      } catch (error) {
        reportError('SessionRunner', `Ending the session failed: ${describeCause(error)}`, { cause: error });
      } finally {
        current = null;
        ending = null;
        // `set` now absorbs a subscriber's throw; `finished()` still runs
        // last so `done` always resolves.
        set({ phase: 'idle', lastEnd: result });
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
    conversations: (map) => conversation.replace(map),
    end: (result) => { void end(run, result); },
  });

  const start = async (method: ControlMethod = 'button'): Promise<void> => {
    if (state.getState().phase !== 'idle') return;
    deps.analytics.track('session_control_clicked', { action: 'start', method });
    const shape = deps.readShape();
    if (!shape) {
      set({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'no-provider', message: 'No provider is chosen, or it has not loaded.' } } });
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
      deps.analytics.track('error_occurred', {
        error_type: 'session_start', error_message: message, component: 'session-runner',
        severity: 'high', provider: shape.provider.id, recoverable: true,
      });
      await end(run, { reason: 'start-failed', notice: { code: 'start-failed', message, ...(leg ? { leg } : {}) } });
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
    press: () => {},
    release: () => {},
    sendText: () => {},
    clear: () => {
      conversation.clear();
      deps.playback.clear();
    },
  };
}
