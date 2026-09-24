import type { AnalyticsEvents } from '../analytics';
import type { Clock } from '../contract/clock';
import type { Punctuator } from '../conversation/fillIn';
import type { Leg, LegName } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';
import type { AnyProvider, AuthContext, Platform, Readiness } from '../provider/types';
import type { OpenSource } from './source';
import type { RunShape } from './types';

/** Where a run's audio goes; plan 1c-2 builds the clip queues and routes behind it. */
export interface PlaybackPort {
  /** A leg's translated audio; `ref` names the segment it speaks, absent when it names none. */
  audio(leg: LegName, ref: number | undefined, pcm: Int16Array): void;
  /** A segment closed: no more audio will come for it. */
  closed(leg: LegName, ref: number): void;
  /** A manual turn is held (push-to-translate closes the original-voice route while held). */
  held(held: boolean): void;
  /** The run ended or the conversation was cleared: stop, and drop what is queued. */
  clear(): void;
}

/** The session events the runner owns (spec: "Analytics"). */
export interface AnalyticsPort {
  track<E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]): void;
}

export type ControlMethod = AnalyticsEvents['session_control_clicked']['method'];

export interface RunnerDeps {
  clock: Clock;
  platform: Platform;
  /** Everything a run freezes; null when no provider is chosen or it has not loaded. */
  readShape(): RunShape | null;
  /** Readiness through the shared cache (the provider store's `refreshReadiness`). */
  ensureReady(p: AnyProvider, auth: AuthContext): Promise<Readiness>;
  /** Writes a `prepare` patch field by field, only where the stored value still equals the run's snapshot. */
  persistIfUnchanged(p: AnyProvider, snapshot: unknown, patch: Readonly<Record<string, unknown>>): void;
  openSource: OpenSource;
  playback: PlaybackPort;
  analytics: AnalyticsPort;
  punctuate?: Punctuator;
  newSessionId(): string;
  /** After a run that went live has ended and its legs are final: where auto-save plugs in. */
  onRunEnded?(legs: readonly Leg[]): Promise<void> | void;
  /** Bounds each release and the wait for punctuation fill-in; default 5000. */
  timeoutMs?: number;
}

/**
 * The caller's ports, each method guarded: a port that throws is reported
 * once per method (a dedupe key) and never reaches the run or an adapter.
 */
export function guardPorts(deps: RunnerDeps): Pick<RunnerDeps, 'playback' | 'analytics'> {
  const guard = <A extends unknown[]>(name: string, fn: (...args: A) => void) => (...args: A): void => {
    try {
      fn(...args);
    } catch (error) {
      reportError('SessionRunner', `The ${name} port threw: ${describeCause(error)}`, { cause: error, dedupeKey: `port:${name}` });
    }
  };
  const { playback, analytics } = deps;
  return {
    playback: {
      audio: guard('playback.audio', (leg: LegName, ref: number | undefined, pcm: Int16Array) => playback.audio(leg, ref, pcm)),
      closed: guard('playback.closed', (leg: LegName, ref: number) => playback.closed(leg, ref)),
      held: guard('playback.held', (held: boolean) => playback.held(held)),
      clear: guard('playback.clear', () => playback.clear()),
    },
    analytics: { track: guard('analytics.track', (event, properties) => analytics.track(event, properties)) as AnalyticsPort['track'] },
  };
}
