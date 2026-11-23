/**
 * The runner's vocabulary (spec: "Session lifecycle"): how a run stands and how it ended, and the shape of a run of
 * this app's providers. What a provider's hooks are handed is the run contract's (`src/lib/run/types.ts`). Types only.
 */
import type { LegName } from '../conversation/types';
import type { AnyProvider } from '../provider/types';
import type { BalanceShapeOf, Budget, EndReason, Payer, RunNotice, RunShapeOf } from '../run/types';

/** Everything a run of this app's providers reads, frozen once at start (`RunShapeOf`). */
export type RunShape = RunShapeOf<AnyProvider>;

/** What a managed provider's start floor depends on, in a run of this app's providers (`BalanceShapeOf`). */
export type BalanceShape = BalanceShapeOf<AnyProvider>;

export interface RunEnd {
  reason: EndReason;
  notice?: RunNotice & { leg?: LegName };
}

export type LegState = 'opening' | 'live' | 'reconnecting';

/** A leg reconnecting under an adapter that counts its attempts: the attempt now, and when the drop came on the run's clock. */
export interface ReconnectProgress {
  attempt: number;
  since: number;
}

/** A leg loading its models while it opens: the `loading` event, as the starting surfaces show it. */
export interface LoadingProgress {
  leg: LegName;
  stage: string;
  done: number;
  total: number;
}

/** `payer`: the one the run was started with (`RunShape.payer`), absent for a run with none; the payer line shows it while the run lasts. */
export type RunState =
  | { phase: 'idle'; lastEnd?: RunEnd }
  | { phase: 'starting'; participantSpeech: boolean; payer?: Payer; step: 'checking' | 'preparing' | 'opening' | 'waiting'; loading?: LoadingProgress }
  /** `reconnect`: the reconnecting legs whose adapter reports attempts (the status line's); absent when there are none. */
  | { phase: 'running'; participantSpeech: boolean; payer?: Payer; since: number; legs: Partial<Record<LegName, LegState>>; budget?: Budget; reconnect?: Partial<Record<LegName, ReconnectProgress>> }
  | { phase: 'stopping'; participantSpeech: boolean; payer?: Payer };
