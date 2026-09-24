import type { AnalyticsEvents } from '../analytics';
import type { Clock } from '../contract/clock';
import type { Punctuator } from '../conversation/fillIn';
import type { Leg, LegName } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';
import type { AnyProvider, AuthContext, Platform, Readiness } from '../provider/types';
import type { OpenSource } from './source';
import type { RunShape } from './types';

/** Where a run's audio goes; plan 1c-2's `Playback` (src/lib/audio/playback.ts) implements it. */
export interface PlaybackPort {
  /**
   * One piece of a leg's translated audio: one clip, which is one speech entry
   * of the segment `ref` names (absent: it names none).
   */
  audio(leg: LegName, ref: number | undefined, pcm: Int16Array): void;
  /** Push-to-translate only: the original-voice route is closed while the key is held. */
  held(held: boolean): void;
  /** The run ended or the conversation was cleared: stop, and drop what is queued. */
  clear(): void;
}

/** The session events the runner owns (spec: "Analytics"). */
export interface AnalyticsPort {
  track<E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]): void;
}

/** One protocol frame an adapter reported (spec D8): what the Logs panel lists. */
export interface AdapterFrame {
  direction: 'in' | 'out';
  type: string;
  payload?: unknown;
}

/** Where a run's frames go: the app's log store (plan 1e). */
export interface FramePort {
  frame(leg: LegName, frame: AdapterFrame): void;
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
  /** The Logs panel's feed; absent, frames are dropped. */
  frames?: FramePort;
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
export function guardPorts(deps: RunnerDeps): Pick<RunnerDeps, 'playback' | 'analytics' | 'frames'> {
  const report = (name: string, error: unknown) =>
    reportError('SessionRunner', `The ${name} port threw: ${describeCause(error)}`, { cause: error, dedupeKey: `port:${name}` });
  const guard = <A extends unknown[]>(name: string, fn: (...args: A) => void) => (...args: A): void => {
    try {
      fn(...args);
    } catch (error) {
      report(name, error);
    }
  };
  const { playback, analytics, frames } = deps;
  // Audio arrives per chunk: report when the port starts failing, not on every
  // chunk after, so a dead sink costs one console line per failing streak.
  let audioFailing = false;
  let framesFailing = false;
  return {
    playback: {
      audio: (leg: LegName, ref: number | undefined, pcm: Int16Array) => {
        try {
          playback.audio(leg, ref, pcm);
          audioFailing = false;
        } catch (error) {
          if (!audioFailing) report('playback.audio', error);
          audioFailing = true;
        }
      },
      held: guard('playback.held', (held: boolean) => playback.held(held)),
      clear: guard('playback.clear', () => playback.clear()),
    },
    analytics: { track: guard('analytics.track', (event, properties) => analytics.track(event, properties)) as AnalyticsPort['track'] },
    // Frames arrive per message: report when the port starts failing, not on
    // every frame after, so a dead sink costs one console line per failing streak.
    ...(frames ? {
      frames: {
        frame: (leg: LegName, frame: AdapterFrame) => {
          try {
            frames.frame(leg, frame);
            framesFailing = false;
          } catch (error) {
            if (!framesFailing) report('frames.frame', error);
            framesFailing = true;
          }
        },
      },
    } : {}),
  };
}
