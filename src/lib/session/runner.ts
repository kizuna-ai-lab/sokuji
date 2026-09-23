/**
 * The session runner (spec: "The runner"): a plain module outside React.
 * Every surface calls the same methods; the UI reads only `state`.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { describeCause, reportError } from '../diagnostics/report';
import type { LegName } from '../conversation/types';
import { ConversationSet } from './conversationSet';
import type { ControlMethod, RunnerDeps } from './ports';
import { LegOpenError, RefusedError, Run, type RunHost } from './run';
import type { LegState, RunEnd, RunState } from './types';

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

  const set = (next: RunState) => state.setState(next, true);
  const legs = (run: Run) => Object.fromEntries(run.legStates) as Partial<Record<LegName, LegState>>;

  /** The one way a run ends — stop, a leg ending, a failed start — once per run. */
  const end = (run: Run, result: RunEnd): Promise<void> => {
    if (run !== current) return Promise.resolve();
    if (ending) return ending;
    const liveSince = run.liveSince;
    set({ phase: 'stopping' });
    ending = (async () => {
      await run.close();
      deps.playback.clear();
      if (liveSince !== null) {
        const duration = deps.clock.now() - liveSince;
        const provider = run.shape.provider.id;
        // One per leg, as `connected` was.
        run.shape.legs.forEach(() => deps.analytics.track('connection_status', { status: 'disconnected', provider, duration_ms: duration }));
        deps.analytics.track('translation_session_end', { session_id: run.id, duration, provider });
        try {
          await deps.onRunEnded?.(conversation.snapshot());
        } catch (error) {
          reportError('SessionRunner', `After the session ended: ${describeCause(error)}`, { cause: error });
        }
      }
      current = null;
      ending = null;
      set({ phase: 'idle', lastEnd: result });
    })();
    return ending;
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
