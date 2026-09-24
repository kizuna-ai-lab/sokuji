/**
 * The run as a subtitle surface needs it — plain data, so the extension
 * overlay can receive it over its wire (spec: "The two subtitle surfaces are
 * not the same thing").
 */
import type { LegName } from '../conversation/types';
import type { LanguagePair, Readiness } from '../provider/types';
import type { RunNotice, RunState, TurnMode } from '../session/types';

/** What the subtitle body shows while no run is live. */
export type SubtitleIdleModel =
  | { kind: 'ready' }
  | { kind: 'ended' }
  | { kind: 'starting' }
  | { kind: 'unready'; message: string }
  | { kind: 'failed'; notice: RunNotice };

export interface SubtitleSession {
  phase: RunState['phase'];
  /** The wall clock the run went live; null unless running. */
  since: number | null;
  /** The legs of the conversation on screen: the bar's display-mode buttons follow them. */
  legs: readonly LegName[];
  /** The selected provider's language pair, for the bar. */
  pair: LanguagePair | null;
  /** A run is live under manual turns: the surface offers its hold control. */
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
}

/**
 * The idle body, first match wins: a start under way; a provider that is not
 * ready (a live blocker outranks a stale failure, as today); a start that was
 * refused or failed; any other end — a run that failed mid-way ended, and its
 * notice is in the conversation; nothing yet.
 */
export function idleOf(run: RunState, readiness: Readiness | undefined): SubtitleIdleModel {
  if (run.phase === 'starting') return { kind: 'starting' };
  if (run.phase !== 'idle') return { kind: 'ended' };
  if (readiness?.state === 'not-ready') return { kind: 'unready', message: readiness.reason };
  const end = run.lastEnd;
  if (end && (end.reason === 'refused' || end.reason === 'start-failed') && end.notice) return { kind: 'failed', notice: end.notice };
  return end ? { kind: 'ended' } : { kind: 'ready' };
}

export function subtitleSession({ run, readiness, pair, turnMode, legs }: SubtitleSessionInput): SubtitleSession {
  return {
    phase: run.phase,
    since: run.phase === 'running' ? run.since : null,
    legs,
    pair,
    holdToTalk: run.phase === 'running' && turnMode !== 'auto',
    // The runner checks readiness at start; only a known blocker or a check in flight keeps Start off.
    canStart: run.phase === 'idle' && readiness?.state !== 'not-ready' && readiness?.state !== 'checking',
    idle: idleOf(run, readiness),
  };
}

function sameIdle(a: SubtitleIdleModel, b: SubtitleIdleModel): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'unready' && b.kind === 'unready') return a.message === b.message;
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
