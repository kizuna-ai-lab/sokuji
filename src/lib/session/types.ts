/**
 * The runner's vocabulary (spec: "Session lifecycle"). Types only.
 */
import type { AdapterEvents, AdapterFrame, AdapterSession, StartRequest } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import type { LegName } from '../conversation/types';
import type { AnyProvider, AuthContext, LanguagePair, ProviderRefusal, SharedSettings } from '../provider/types';

/** One global setting (D15). Push-to-talk and push-to-translate are the same to an adapter: manual turns. */
export type TurnMode = 'auto' | 'push-to-talk' | 'push-to-translate';

/**
 * The signed-in account's wallet as the client knows it (Stage 2 Kizuna
 * Soniox, ruling 5; choice 8): the first fetch still in flight, a fetch
 * failed with no wallet known, or the wallet as last fetched
 * (`balanceMicroUsd` in micro-USD, negative after a post-paid overrun).
 */
export type AccountState =
  | { status: 'loading' }
  | { status: 'unknown' }
  | { status: 'known'; balanceMicroUsd: number; frozen: boolean };

/** Everything a run reads, frozen once at start (spec: "A run"); later steps read this, never the live stores. */
export interface RunShape {
  provider: AnyProvider;
  /** The provider's settings at start. */
  settings: unknown;
  /** Its saved credential values at start: every key in `credentials.keys`. */
  credentials: Readonly<Record<string, string>>;
  /** The speaker's pair; the participant leg runs its reverse. */
  pair: LanguagePair;
  /** The legs asked for, speaker first. */
  legs: readonly LegName[];
  turnMode: TurnMode;
  /** The speaker leg produces no translated speech (unless the provider always speaks). */
  textOnly: boolean;
  /** The participant-TTS opt-in; off until plan 1c-2's routing adds the switch. */
  participantSpeech: boolean;
  keepReplayAudio: boolean;
  /** What every builder may read, less `models`, which the run adds from its own readiness answer (F2). */
  shared: Omit<SharedSettings, 'models'>;
  auth: AuthContext;
  /** The account's wallet at start, for a managed provider's floor (ruling 5). Null or absent when signed out, or where no account is wired (tests, the preview): then the sign-in check speaks, not the gate. */
  account?: AccountState | null;
}

/** A notice a run records; surfaces localize it by `code`. */
export interface RunNotice {
  code: string;
  message: string;
  params?: Record<string, string | number>;
}

/** What a provider's `prepare` returns (the managed voice claim). */
export interface Prepared<S> {
  /** Applies to this run only. */
  override?: Partial<S>;
  /** Written back field by field, where the stored value still equals the run's snapshot. */
  persist?: Partial<S>;
  notice?: RunNotice;
}

/** What a managed provider's start floor depends on: the legs, whether the speaker speaks, and whether the participant would. */
export type BalanceShape = Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech'>;

/** A lease's granted time: the countdown's whole, and when it ends on the run's clock. */
export interface Budget {
  totalMs: number;
  endsAt: number;
}

/** A managed lease: one `K` per leg, released when the run unwinds. */
export interface Resources<K> {
  credentials(leg: LegName): K;
  /** The granted time, when the lease has one: the running state carries it to the countdown. */
  budget?: Budget;
  release(): Promise<void>;
}

/** What a lease hears from its run (spec: "Session hooks on the provider definition"). */
export interface LeaseContext {
  signal: AbortSignal;
  /** The run's clock: a lease's timers read it. */
  clock: Clock;
  /**
   * Ends the run with a notice — the grant used up, the longest segment
   * reached: the code says which. The runner tracks it as `api_error`
   * (ruling 8) unless `expected` says it is the normal end of a managed
   * segment, which the old client deliberately never tracked.
   */
  end(notice: RunNotice, o?: { expected?: boolean }): void;
  /** The lease's wire traffic (`session.*`), for the Logs: the runner files it under the first leg. */
  frame(frame: AdapterFrame): void;
}

/** What a provider may add across legs and time (spec: "Session hooks on the provider definition"). */
export interface SessionHooks<S, K, C> {
  prepare?(shape: RunShape, s: S, signal: AbortSignal): Promise<Prepared<S>>;
  /** Cross-leg checks over the configs actually built. */
  admit?(configs: Partial<Record<LegName, C>>): true | ProviderRefusal;
  /** `end` stops the run with a notice: budget exhausted, duration cutoff — the code says which. */
  acquire?(shape: RunShape, s: S, ctx: LeaseContext): Promise<Resources<K>>;
  /** Both legs at once (D23): the provider decides between one mixed socket and two. */
  startBoth?(
    requests: Record<LegName, StartRequest<C, K>>,
    events: Record<LegName, AdapterEvents>,
  ): Promise<Record<LegName, AdapterSession>>;
  /** A managed provider's start floor in µUSD for these legs (spec: "`minimumBalance`"): the start gate refuses a known balance below it. */
  minimumBalance?(shape: BalanceShape, s: S): number;
}

/** Why a run ended; the idle surfaces look the text up by the notice's code.
 *  Kebab-case on purpose: these are reasons, read by the runner and its
 *  callers, not notice codes — notice codes (`RunNoticeCode` and a
 *  provider's own) are snake_case. */
export type EndReason = 'user' | 'refused' | 'start-failed' | 'leg-failed' | 'leg-closed' | 'source-ended' | 'lease-ended';

export interface RunEnd {
  reason: EndReason;
  notice?: RunNotice & { leg?: LegName };
}

export type LegState = 'opening' | 'live' | 'reconnecting';

/** A leg loading its models while it opens: the `loading` event, as the starting surfaces show it. */
export interface LoadingProgress {
  leg: LegName;
  stage: string;
  done: number;
  total: number;
}

export type RunState =
  | { phase: 'idle'; lastEnd?: RunEnd }
  | { phase: 'starting'; step: 'checking' | 'preparing' | 'opening'; loading?: LoadingProgress }
  | { phase: 'running'; since: number; legs: Partial<Record<LegName, LegState>>; budget?: Budget }
  | { phase: 'stopping' };
