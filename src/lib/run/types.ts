// src/lib/run/types.ts
//
// The run contract: what a provider declares for a run (its units and its session hooks) and what a run hands it
// (the settings every builder reads, the shape a run froze at its start, its plan). Types only. It imports no
// provider, plan or session module: they import it. The plan and the shape name the providers they hold by a type
// parameter, `P`, which the provider definition (`src/lib/provider/types.ts`) and the modules above it bind.
import type { Adapter, AdapterEvents, AdapterFrame, AdapterSession, FrameSource, SessionContext, StartRequest } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import type { SpeechEvents, SpeechSession, SpeechStartRequest } from '../contract/speech';
import type { TranslationEvents, TranslationSession, TranslationStartRequest } from '../contract/translation';
import type { LegName } from '../conversation/types';
import type { RunStage, StageIds } from '../lineup/types';
import type { LocalModels } from '../local-inference/selection/types';
import type { WordEntry } from '../words/list';

export interface LanguagePair { source: string; target: string }

/**
 * The sign-in session: what `credentials.read` may consult besides the
 * typed values (a managed provider), and the account a provider's
 * `prepare` or `Settings` acts for (F3).
 */
export interface AuthContext {
  signedIn: boolean;
  getToken(): Promise<string | null>;
  /** The signed-in user's id; null signed out. Absent where no sign-in is wired: tests, the root's default. */
  userId?: string | null;
  /**
   * False while the sign-in is still loading at launch: a managed
   * provider's `read` then answers `sign_in_pending`, not "sign in" (Stage 2
   * Kizuna Soniox, choice 10). Absent where no sign-in is wired — tests, the
   * root's default — and read as loaded.
   */
  loaded?: boolean;
}

export interface ModelOption { id: string }

/** What a builder may read beyond its own settings; a builder never reaches into a store. The system instructions are each provider's own setting (`instructions.ts`; Stage 2 Gemini, ruling 4). */
export interface SharedSettings {
  /** The segmentation pauses, in seconds, as stored. */
  pauses: { sourceSeconds: number; translationSeconds: number };
  /** This is the participant's direction: the pair's reverse. A run answers it by leg, so a same-language pair (en → en), one direction for both legs, still tells them apart. */
  reversed(direction: SessionContext['direction']): boolean;
  /** The display segmentation as stored: a provider that cuts its own jobs follows it (LocalInference). */
  segmentation: { mode: 'off' | 'pause' | 'sentences'; sentencesPerRow: number };
  /** Face-to-face: a builder that can run it forces its shared socket. Absent: false. */
  faceToFace?: boolean;
  /** Some leg of this run produces translated speech (its context's `speech`), fixed at start: a builder may ready a socket for it (Soniox asks for agent text when its own setting is on, spec 2026-11-05 §4.3). Whether the speech plays locally is not asked: speech that is not local makes no echo. Set by the run; absent: false. */
  speaks?: boolean;
  /**
   * The run has both legs, each built with its own direction. A builder whose unit is started one leg at a time
   * reads it here, where a start of both legs at once would have told its adapter (Soniox transcribing alone asks
   * for no agent text then, as its split Both does not). Set by the run; absent: false.
   */
  bothLegs?: boolean;
  /** The models this run's own readiness check found (F2): the list its settings component was shown, for the same effective-model function. */
  models: readonly ModelOption[];
  /** The app's word list and session background, read at start (spec §9): each builder sends what `wordsFor` gives its service. Absent: none. */
  words?: SessionWords;
  /**
   * The stored line-up as the run froze it at its start: the id each stage was given to. A builder whose provider
   * runs a stage in more than one way reads it here (the local provider: Bing or a local model, Edge or a local
   * voice). Absent: no stored line-up is what runs, or the caller is not a run.
   */
  lineUp?: StageIds;
  /**
   * This device's local models (`LocalModels`): what a builder of a unit that runs them (the local provider's) resolves
   * its models through, and what its `admit` budgets by. Set by the run when its deps have them (the app's always do);
   * absent where the caller is not a run.
   */
  localModels?: LocalModels;
}

/** The word list as a run reads it at start. */
export interface SessionWords {
  entries: readonly WordEntry[];
  background: string;
}

/** A refusal to build or admit: diagnostic English, and a code a surface can put into words. */
export interface ProviderRefusal {
  refused: string;
  /** Default: the runner's `build_refused` / `admit_refused`. */
  code?: string;
  params?: Record<string, string | number>;
}

/**
 * What a unit can do under its settings, in the words generic code reads.
 * A member may be computed when read (a whole unit asks its parts each time), so generic code reads
 * the member it needs and never spreads or serialises the object.
 */
export interface UnitCapabilities {
  speech: 'always' | 'optional' | 'never';
  turns: ReadonlyArray<'auto' | 'manual'>;
  /** Who may decide the end of a turn (spec §9). Every unit answers 'either' in step 1. */
  turnOwner: 'unit' | 'external' | 'either';
  boundaries: 'provider' | 'silence';
  textInput: boolean;
  faceToFace: boolean;
  /** False: the participant leg never speaks, whatever its switch says. */
  participantSpeech: boolean;
  /**
   * A unit that speaks: whether it has a voice for `language` (an app code). Absent: the unit speaks whatever its
   * provider translates into (a whole unit).
   */
  speaks?(language: string): boolean;
  /**
   * A unit that translates: whether it translates from `source` into `target` (app codes). Absent: the unit
   * translates whatever its provider's language lists offer (a whole unit).
   */
  translates?(source: string, target: string): boolean;
}

/**
 * One piece of a provider that serves some stages of a run.
 * `any` by default: units of different providers are held together, so their settings, key and config types are erased, as `AnyProvider` does.
 */
export interface UnitDefinition<S = any, K = any, C = any> {
  /** `'whole'`: a unit that is a whole session (`wholeUnitOf`). */
  id: string;
  /**
   * The stages this unit occupies when asked for `want`, or null when it cannot serve exactly that.
   * Must not read the settings `s`: the line-up catalog is derived from it once, without settings.
   */
  occupies(s: S, want: ReadonlySet<RunStage>): readonly RunStage[] | null;
  capabilities(s: S): UnitCapabilities;
  build(context: SessionContext, s: S, shared: SharedSettings): C | ProviderRefusal;
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string };
  /**
   * A unit that transcribes, alone or with other stages: started through the adapter contract. Absent on a unit
   * that occupies only `translation`, only `speech`, or those two: such a unit has the start of each stage it
   * occupies below, and no `start`.
   */
  start?: Adapter<C, K>['start'];
  /** A unit that occupies `translation` and does not transcribe: started through the translation contract. */
  startTranslation?(request: TranslationStartRequest<C, K>, events: TranslationEvents): TranslationSession;
  /** A unit that occupies `speech` and does not transcribe: started through the speech contract. */
  startSpeech?(request: SpeechStartRequest<C, K>, events: SpeechEvents): SpeechSession;
}

/**
 * A unit chosen for a run, with its provider and the stages it serves there.
 * `P`: the provider definition, bound where it is known (`PlannedUnit`, `src/lib/plan/types.ts`).
 */
export interface PlannedUnitOf<P> { provider: P; unit: UnitDefinition; stages: readonly RunStage[] }

/** Which unit serves which stage of one run. */
export interface RunPlanOf<P> {
  /** In the order transcription, translation, speech; a unit that occupies several appears once. */
  units: readonly PlannedUnitOf<P>[];
  byStage: Readonly<Record<RunStage, PlannedUnitOf<P>>>;
}

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
  | ({ status: 'known'; balanceMicroUsd: number; frozen: boolean } & PayerWallets);

/**
 * The wallets a member of an organization can be billed to, as the wallet
 * status names them (`QuotaData` carries the same fields). Absent for a
 * non-member, whose account has the one wallet; for a member the top-level
 * balance is the organization's.
 */
export interface PayerWallets {
  organization?: { name: string; availableMicroUsd: number; committedBalanceMicroUsd?: number; frozen: boolean; role?: 'owner' | 'member' };
  personal?: { balanceMicroUsd: number; frozen: boolean };
}

/** Who pays for a session an organization member starts; on the wire exactly these two values. */
export type Payer = 'organization' | 'personal';

/** One provider of a run's plan as it stood at start. */
export interface PlanAccount {
  /** The provider's settings at start. */
  settings: unknown;
  /** Its saved credential values at start: every key in `credentials.keys`. */
  credentials: Readonly<Record<string, string>>;
}

/** Everything a run reads, frozen once at start (spec: "A run"); later steps read this, never the live stores. */
export interface RunShapeOf<P> {
  /** Which unit serves each stage of the run. */
  plan: RunPlanOf<P>;
  /** Settings and saved credential values at start, by provider id: every provider in the plan. */
  accounts: Readonly<Record<string, PlanAccount>>;
  /** The line-up id that serves each stage (`stageIdsFor`): what the run's records name. */
  lineUp: StageIds;
  /**
   * True: a line-up names the stages of this run (despite the name, not only a stored one): the stored line-up, or,
   * before one is stored, the one the settings show where this device runs (the line-up store's `lineUpThatRuns`).
   * `lineUp` is then that line-up's, and the run hands it to every builder (`SharedSettings.lineUp`). Absent or
   * false: no line-up names them; `lineUp` names the provider that runs on every stage and says nothing of how that
   * provider serves each, so a builder is handed none.
   */
  lineUpStored?: boolean;
  /** The speaker's pair; the participant leg runs its reverse. */
  pair: LanguagePair;
  /** The legs asked for, speaker first. */
  legs: readonly LegName[];
  turnMode: TurnMode;
  /** The speaker leg produces no translated speech (unless the provider always speaks). */
  textOnly: boolean;
  /** Translation I hear: the other's translation is spoken to me (the switch, the provider's flags and the recapture rule applied — `speakFor`). */
  participantSpeech: boolean;
  /** Both with the other side beside me, under a provider that offers it (spec 2026-10-08, slice 3). Absent: false. */
  faceToFace?: boolean;
  /**
   * Both with the other side beside me was asked for, whatever the unit that transcribes offers. It differs from
   * `faceToFace` only under a unit that cannot run it; the gate refuses that where another unit translates.
   */
  faceToFaceAsked?: boolean;
  keepReplayAudio: boolean;
  /** What every builder may read, less what the run adds: `models` from its own readiness answer (F2), `speaks`, and the line-up. */
  shared: Omit<SharedSettings, 'models' | 'speaks' | 'lineUp'>;
  auth: AuthContext;
  /** The account's wallet at start, for a managed provider's floor (ruling 5). Null or absent when signed out, or where no account is wired (tests, the preview): then the sign-in check speaks, not the gate. */
  account?: AccountState | null;
  /** Who pays, chosen once at start: set for an organization member only (`chosenPayer`), absent for everyone else, whose requests then carry no `payer`. */
  payer?: Payer;
  /** The chosen capture area for a provider that takes one (Qwen); run-time state, never persisted. */
  frames?: FrameSource;
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

/**
 * What a managed provider's start floor depends on: the legs, whether the speaker speaks, whether the participant
 * would, and the plan, which says whether the speech is this provider's to make (`servesSpeech`). Without a plan
 * the provider is taken to serve every stage.
 */
export type BalanceShapeOf<P> = Pick<RunShapeOf<P>, 'legs' | 'textOnly' | 'participantSpeech'> & Partial<Pick<RunShapeOf<P>, 'faceToFace' | 'plan'>>;

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
  /** Diagnostic cause only, set before abort. Never carries a notice's text or
   * changes signal.reason, which existing error handling depends on. */
  cancellationCause?(): EndReason | 'page-hidden' | undefined;
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
  /** The start is waiting for the account's previous session to clear (on), or no longer is (off): the runner shows it as a step. */
  waiting?(on: boolean): void;
}

/** `admit`'s third answer (#619): start, running these legs' configs in place of the ones built. The legs stay as built. */
export interface AdmittedConfigs<C> {
  configs: Partial<Record<LegName, C>>;
}

/** What a provider may add across legs and time (spec: "Session hooks on the provider definition"). */
export interface SessionHooks<S, K, C, P> {
  prepare?(shape: RunShapeOf<P>, s: S, signal: AbortSignal): Promise<Prepared<S>>;
  /**
   * Cross-leg checks over the configs actually built: run them, refuse, or run some legs on adjusted configs.
   * `shared`: what the builders of this unit were handed, less which leg each built.
   */
  admit?(configs: Partial<Record<LegName, C>>, shared: Omit<SharedSettings, 'reversed'>): true | ProviderRefusal | AdmittedConfigs<C>;
  /** `end` stops the run with a notice: budget exhausted, duration cutoff — the code says which. */
  acquire?(shape: RunShapeOf<P>, s: S, ctx: LeaseContext): Promise<Resources<K>>;
  /** Both legs at once (D23): the provider decides between one mixed socket and two. */
  startBoth?(
    requests: Record<LegName, StartRequest<C, K>>,
    events: Record<LegName, AdapterEvents>,
  ): Promise<Record<LegName, AdapterSession>>;
  /** A managed provider's start floor in µUSD for these legs (spec: "`minimumBalance`"): the start gate refuses a known balance below it. */
  minimumBalance?(shape: BalanceShapeOf<P>, s: S): number;
}

/** Why a run ended; the idle surfaces look the text up by the notice's code.
 *  Kebab-case on purpose: these are reasons, read by the runner and its
 *  callers, not notice codes — notice codes (`RunNoticeCode` and a
 *  provider's own) are snake_case. */
export type EndReason = 'user' | 'refused' | 'start-failed' | 'leg-failed' | 'leg-closed' | 'source-ended' | 'lease-ended';
