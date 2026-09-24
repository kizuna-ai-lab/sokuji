/**
 * The runner's vocabulary (spec: "Session lifecycle"). Types only.
 */
import type { AdapterEvents, AdapterSession, StartRequest } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import type { AnyProvider, AuthContext, LanguagePair, SharedSettings } from '../provider/types';

/** One global setting (D15). Push-to-talk and push-to-translate are the same to an adapter: manual turns. */
export type TurnMode = 'auto' | 'push-to-talk' | 'push-to-translate';

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
  shared: SharedSettings;
  auth: AuthContext;
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

/** A managed lease: one `K` per leg, released when the run unwinds. */
export interface Resources<K> {
  credentials(leg: LegName): K;
  release(): Promise<void>;
}

/** What a provider may add across legs and time (spec: "Session hooks on the provider definition"). */
export interface SessionHooks<S, K, C> {
  prepare?(shape: RunShape, s: S, signal: AbortSignal): Promise<Prepared<S>>;
  /** Cross-leg checks over the configs actually built. */
  admit?(configs: Partial<Record<LegName, C>>): true | { refused: string };
  /** `end` stops the run with a notice: budget exhausted, duration cutoff — the code says which. */
  acquire?(shape: RunShape, s: S, ctx: { signal: AbortSignal; end(notice: RunNotice): void }): Promise<Resources<K>>;
  /** Both legs at once (D23): the provider decides between one mixed socket and two. */
  startBoth?(
    requests: Record<LegName, StartRequest<C, K>>,
    events: Record<LegName, AdapterEvents>,
  ): Promise<Record<LegName, AdapterSession>>;
}

/** Why a run ended; the idle surfaces look the text up by the notice's code. */
export type EndReason = 'user' | 'refused' | 'start-failed' | 'leg-failed' | 'leg-closed' | 'source-ended' | 'lease-ended';

export interface RunEnd {
  reason: EndReason;
  notice?: RunNotice & { leg?: LegName };
}

export type LegState = 'opening' | 'live' | 'reconnecting';

export type RunState =
  | { phase: 'idle'; lastEnd?: RunEnd }
  | { phase: 'starting'; step: 'checking' | 'preparing' | 'opening' }
  | { phase: 'running'; since: number; legs: Partial<Record<LegName, LegState>> }
  | { phase: 'stopping' };
