/**
 * The run as a subtitle surface needs it — plain data, so the extension
 * overlay can receive it over its wire (spec: "The two subtitle surfaces are
 * not the same thing").
 */
import type { LegName } from '../conversation/types';
import type { LanguagePair, Readiness } from '../provider/types';
import { NO_MICROPHONE, type Refusal } from '../session/shape';
import type { RunNotice, RunState, TurnMode } from '../session/types';

/** What the subtitle body shows while no run is live. */
export type SubtitleIdleModel =
  | { kind: 'ready' }
  | { kind: 'ended' }
  | { kind: 'starting' }
  /** `message` is diagnostic English; `code`, when present, is what the surface words. */
  | { kind: 'unready'; message: string; code?: string; params?: Record<string, string | number> }
  | { kind: 'failed'; notice: RunNotice };

export interface SubtitleSession {
  phase: RunState['phase'];
  /** The wall clock the run went live; null unless running. */
  since: number | null;
  /** The audio mode's legs (intent) joined with the conversation's (ruling 12): the bar's display-mode buttons follow them. Also crosses the overlay's wire. */
  legs: readonly LegName[];
  /** The selected provider's language pair, for the bar. */
  pair: LanguagePair | null;
  /** A run is live under manual turns with a speaker leg to hold (plan 1e-4 ruling 8): the surface offers its hold control. */
  holdToTalk: boolean;
  /** Start is offered: idle, and the provider neither known to be unready nor being checked. */
  canStart: boolean;
  idle: SubtitleIdleModel;
}

export interface SubtitleSessionInput {
  run: RunState;
  readiness: Readiness | undefined;
  pair: LanguagePair | null;
  turnMode: TurnMode;
  legs: readonly LegName[];
  /** The app's capture needs a microphone and none is chosen (1e-3 ruling 5). */
  microphoneMissing?: boolean;
  /** The selected provider's entry has loaded: until then a start would be refused as no provider (plan 1e-3b-1 ruling 11). Default true. */
  providerLoaded?: boolean;
  /** What the start gate refuses over the stores as they stand (F7), or null. */
  refusal?: Refusal | null;
}

/**
 * The idle body, first match wins: a start under way; no microphone chosen
 * (the precedence the old start gate had: a missing device before the
 * provider's own blocker); the start gate's refusal (F7); a provider that is
 * not ready (a live blocker outranks a stale failure, as before); a start
 * that was refused or failed; any other end — a run that failed mid-way
 * ended, and its notice is in the conversation; nothing yet.
 */
export function idleOf(run: RunState, readiness: Readiness | undefined, microphoneMissing = false, refusal: Refusal | null = null): SubtitleIdleModel {
  if (run.phase === 'starting') return { kind: 'starting' };
  if (run.phase !== 'idle') return { kind: 'ended' };
  if (microphoneMissing) return { kind: 'unready', message: 'No microphone is chosen for the speaker leg.', code: NO_MICROPHONE };
  // The start gate's refusal (F7): this shape cannot start — after the
  // device, where today's computeStartGate put its participant blocker,
  // and before the provider's readiness.
  if (refusal) return { kind: 'unready', message: refusal.message, code: refusal.code, ...(refusal.params ? { params: refusal.params } : {}) };
  if (readiness?.state === 'not-ready') return { kind: 'unready', message: readiness.reason, ...(readiness.code ? { code: readiness.code } : {}), ...(readiness.params ? { params: readiness.params } : {}) };
  const end = run.lastEnd;
  if (end && (end.reason === 'refused' || end.reason === 'start-failed') && end.notice) return { kind: 'failed', notice: end.notice };
  return end ? { kind: 'ended' } : { kind: 'ready' };
}

export function subtitleSession({ run, readiness, pair, turnMode, legs, microphoneMissing = false, providerLoaded = true, refusal = null }: SubtitleSessionInput): SubtitleSession {
  return {
    phase: run.phase,
    since: run.phase === 'running' ? run.since : null,
    legs,
    pair,
    // A press opens a turn on the speaker leg only (`Run.press`, run.ts:275-281):
    // a participant-only run offers no hold — it would do nothing.
    holdToTalk: run.phase === 'running' && turnMode !== 'auto' && run.legs.speaker !== undefined,
    // The runner checks readiness at start; only a known blocker or a check in flight keeps Start off.
    canStart: run.phase === 'idle' && !microphoneMissing && readiness?.state !== 'not-ready' && readiness?.state !== 'checking' && providerLoaded && !refusal,
    idle: idleOf(run, readiness, microphoneMissing, refusal),
  };
}

/** Shallow: every key of `a` and `b` matches, both ways. */
function sameParams(a: Record<string, string | number> | undefined, b: Record<string, string | number> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

function sameIdle(a: SubtitleIdleModel, b: SubtitleIdleModel): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'unready' && b.kind === 'unready') return a.message === b.message && a.code === b.code && sameParams(a.params, b.params);
  if (a.kind === 'failed' && b.kind === 'failed') return a.notice === b.notice || (a.notice.code === b.notice.code && a.notice.message === b.notice.message);
  return true;
}

/** Two sessions that draw the same, compared by value, so a source can keep its identity. */
export function sameSession(a: SubtitleSession, b: SubtitleSession): boolean {
  return a.phase === b.phase && a.since === b.since && a.holdToTalk === b.holdToTalk && a.canStart === b.canStart
    && a.legs.length === b.legs.length && a.legs.every((leg, i) => leg === b.legs[i])
    && a.pair?.source === b.pair?.source && a.pair?.target === b.pair?.target
    && sameIdle(a.idle, b.idle);
}
