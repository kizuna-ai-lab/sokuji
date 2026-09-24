import type { AnalyticsEvents } from '../analytics';
import type { AdapterFrame } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import type { Punctuator } from '../conversation/fillIn';
import type { Leg, LegName } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';
import { redact } from '../diagnostics/redact';
import type { AnyProvider, Platform, Readiness } from '../provider/types';
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

// `AdapterFrame` lives once, in `contract/adapter.ts` — `AdapterEvents.frame`
// and this port share it. Re-exported so a caller can still import it here.
export type { AdapterFrame } from '../contract/adapter';

/** Where a run's frames go: the app's log store (plan 1e). */
export interface FramePort {
  frame(leg: LegName, frame: AdapterFrame): void;
}

export type ControlMethod = AnalyticsEvents['session_control_clicked']['method'];

/** Every string value — and every string in an array value — through `redact`: an event never carries a secret, whoever built it. */
function redactValues<T extends object>(properties: T): T {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [
    key,
    typeof value === 'string' ? redact(value)
      : Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? redact(item) : item))
        : value,
  ])) as T;
}

export interface RunnerDeps {
  clock: Clock;
  platform: Platform;
  /** Everything a run freezes; null when no provider is chosen or it has not loaded. */
  readShape(): RunShape | null;
  /** Readiness of the run's own shape (settings, credentials, pair), through the shared cache; honours `signal`. */
  ensureReady(shape: RunShape, signal: AbortSignal): Promise<Readiness>;
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
  /** Bounds a whole ending — every release, the fill-in wait, `onRunEnded` — at once; default 15000. What outlives it unwinds in the background. */
  closeTimeoutMs?: number;
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
    analytics: { track: guard('analytics.track', (event, properties) => analytics.track(event, redactValues(properties))) as AnalyticsPort['track'] },
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
