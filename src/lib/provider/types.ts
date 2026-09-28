/**
 * The provider definition: one object per provider, and the only thing
 * generic code knows about it (spec: "The provider definition"). Types only.
 */
import type { ComponentType } from 'react';
import type { PreviewClip } from '../audio/playback';
import type { Adapter, SessionContext } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import type { SessionHooks } from '../session/types';

export type Platform = 'electron' | 'extension' | 'web';
export type ProviderKind = 'own-key' | 'managed' | 'local';

export interface LanguageOption { value: string; name: string; englishName: string }
export interface LanguagePair { source: string; target: string }

/**
 * What the languages on offer may depend on besides the settings (Stage 2
 * Volcengine AST2, choice 1): whether the run would speak — any leg it
 * opens producing translated audio. Doubao AST 2.0 speaks eight languages
 * and transcribes twenty and two dialects. A language function called
 * without it answers its widest offer, every language any mode takes: the
 * offer the stored pair is kept within (`providerStore`).
 */
export interface LanguageContext { speech: boolean }

/**
 * A setting that decides which credential fields show (F4; Stage 2
 * Volcengine AST2, ruling 1; Palabra's platform/app toggle next): the
 * credential form draws its options as a segmented control above the
 * fields and writes the choice as a settings patch. Switching clears no
 * credential — every key in `credentials.keys` stays stored.
 */
export interface CredentialChoice {
  /** A field of `settings.defaults`, holding one option's `value`. */
  setting: string;
  options: ReadonlyArray<{ value: string; labelKey: string }>;
}

/**
 * One credential input. `key` is the field its value persists under
 * (`settings.<settings.key>.<key>`); `labelKey` and `placeholderKey` are i18n
 * keys.
 */
export interface CredentialField { key: string; labelKey: string; secret: boolean; placeholderKey?: string }

/** Credential values by field key; a field with nothing saved reads as ''. */
export type CredentialValues = Readonly<Record<string, string>>;

/** What `settings.migrate` may consult besides the stored fields (F5). */
export interface MigrationInputs {
  /**
   * Every key in `settings.legacyKeys`, as `getSetting` returns it with no
   * default: `undefined` where nothing was ever stored. A key that starts
   * with `settings.` names a whole storage key — a global the provider owns
   * a copy of, as Gemini's instructions (Stage 2 Gemini, choice 1); any
   * other names a field under the provider's prefix. Chrome storage keeps
   * a value's type; localStorage JSON-parses what it can, so a stored
   * `"123"` or `"true"` arrives as a number or a boolean — a migration
   * compares defensively.
   */
  legacy: Readonly<Record<string, unknown>>;
  /** The saved credential values: every key in `credentials.keys`, '' where nothing is saved. */
  credentials: CredentialValues;
}

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

/**
 * Why `credentials.read` found no credentials. `code` (and `params`) put
 * it into the user's words — `sign_in_required` for a managed provider
 * signed out; absent, the runner's `credentials_missing`.
 */
export interface CredentialsMissing { missing: string; code?: string; params?: Record<string, string | number> }

export interface ModelOption { id: string }

/**
 * What a provider's `Settings` may reach besides its settings (F3): the
 * saved credential values — every key in `credentials.keys` — and the
 * sign-in, for pieces that call the provider's API from Settings (Soniox's
 * voice library, a managed provider's voice source).
 */
export interface ProviderAccount { credentials: CredentialValues; auth: AuthContext }

/** `models`, when present, is newest first. A refusal's `code` (and `params`) put it into the user's words (`notices.<code>`); `reason` stays diagnostic English. */
export type CheckResult =
  | { ok: true; models?: readonly ModelOption[] }
  | { ok: false; reason: string; code?: string; params?: Record<string, string | number> };

/** What a readiness check may consult besides the credentials and settings. */
export interface CheckContext {
  /** The speaker's pair; the participant leg runs its reverse. A local engine's models are per direction. */
  pair: LanguagePair;
  /** The legs a run would open, speaker first: the participant leg runs the pair's reverse. */
  legs: readonly LegName[];
  /** Aborted when the start that asked is cancelled. */
  signal?: AbortSignal;
}

/** Whether a provider can start now (spec: "Readiness is one check"). */
export type Readiness =
  | { state: 'unknown' }
  | { state: 'checking' }
  | { state: 'ready'; models: readonly ModelOption[] }
  /** `code` / `params` as a refusal's: the provider's own code puts `reason` into the user's words. */
  | { state: 'not-ready'; reason: string; code?: string; params?: Record<string, string | number> };

/** What a builder may read beyond its own settings; a builder never reaches into a store. The system instructions are each provider's own setting (`instructions.ts`; Stage 2 Gemini, ruling 4). */
export interface SharedSettings {
  /** The segmentation pauses, in seconds, as stored. */
  pauses: { sourceSeconds: number; translationSeconds: number };
  /** This is the participant's direction: the pair's reverse. */
  reversed(direction: SessionContext['direction']): boolean;
  /** The display segmentation as stored: a provider that cuts its own jobs follows it (LocalInference). */
  segmentation: { mode: 'off' | 'pause' | 'sentences'; sentencesPerRow: number };
  /** The models this run's own readiness check found (F2): the list its settings component was shown, for the same effective-model function. */
  models: readonly ModelOption[];
}

/** The voice-preview route (spec, "Playback — Routing": voice preview, the real device, a fixed route): one clip at its own rate; `play` resolves when it ends or is stopped. */
export interface PreviewPort {
  play(clip: PreviewClip): Promise<void>;
  stop(): void;
}

export interface SettingsProps<S> {
  settings: S;
  update(patch: Partial<S>): void;
  /** A run is not idle: the provider's settings are locked. */
  disabled?: boolean;
  /** The provider's language pair, for a `Settings`/`Engine` that needs it (LocalInference's model management is per direction). Set by every host, through `ownProps`; absent in a component's own tests. */
  pair?: LanguagePair;
  /**
   * The models the provider's latest ready answer found (F2), newest
   * first; empty until one has. A model-choosing provider hands them and
   * its settings to its effective-model function, as its `build` does with
   * `shared.models`. Set by every host; absent in a component's own tests.
   */
  models?: readonly ModelOption[];
  /** The provider's account (F3). Set by `ProviderOwnSettings` for `Settings`; absent elsewhere. */
  account?: ProviderAccount;
  /** The voice-preview route. Set by `ProviderOwnSettings` for `Settings`; absent elsewhere, where a voice library plays on its own. */
  preview?: PreviewPort;
  /** The legs a start would open (the audio mode's). Set by `ProviderOwnSettings` for `Settings`: Soniox locks its shared-session choice outside Both. */
  legs?: readonly LegName[];
}

/** One slot of a local engine's model management: a stage of one direction (`src→tgt`). */
export interface EngineSlot { dir: string; stage: 'asr' | 'translation' | 'tts' }

/** What an `Engine` is handed besides its settings. */
export interface EngineProps<S> extends SettingsProps<S> {
  /** The legs a start would open (the audio mode's): the directions it shows. */
  legs: readonly LegName[];
  /** Open this slot on mount — a chip's deep link; `onInitialSlotConsumed` says it was. */
  initialSlot?: EngineSlot | null;
  onInitialSlotConsumed?(): void;
}

/** A local engine's summary under the picker: its slot chips and memory estimate (Simple mode's way into the `Engine`). */
export interface EngineSummaryProps<S> extends SettingsProps<S> {
  legs: readonly LegName[];
  openSlot(slot: EngineSlot): void;
}

/** A refusal to build or admit: diagnostic English, and a code a surface can put into words. */
export interface ProviderRefusal {
  refused: string;
  /** Default: the runner's `build_refused` / `admit_refused`. */
  code?: string;
  params?: Record<string, string | number>;
}

/**
 * `R` is what `credentials.read` answers and `check` takes; it is `K`
 * unless the provider mints `K` in `session.acquire` — a managed twin's `R`
 * is the sign-in (`managed.ts`), its `K` the lease's per-leg keys (Stage 2
 * Kizuna Soniox, choice 1).
 */
export interface Provider<S, K extends { missing?: never } & object, C extends { refused?: never } & object, R extends { missing?: never } & object = K> {
  // identity and presence
  /** Persisted as the selected provider; never renamed. */
  id: string;
  kind: ProviderKind;
  platforms: readonly Platform[];
  /** Hidden in release builds unless `VITE_ENABLED_PROVIDERS` lists the id (D19). */
  flagged?: true;
  icon: ComponentType<{ size?: string | number }>;
  docs?: string;
  vendor?: string;
  /**
   * The segment the provider's locale keys sit under, when the catalogs
   * spell it otherwise than `id` (controller ruling 2): `providers.<i18nKey
   * ?? id>.name` and `.description`. LocalInference's is `local_inference`.
   */
  i18nKey?: string;
  /** Where a user reads how to set this provider up; the picker links it, dismissibly. */
  guideUrl?: string;
  /**
   * A tester's run-time way in for a flagged provider in a release build:
   * a `localStorage` key that, set to `'1'`, offers it here — Local
   * Native's `debug:local-native` until it ships (F6). Only on a flagged
   * provider (registry invariant).
   */
  testerSwitch?: string;

  // settings — never secrets
  settings: {
    /** Storage prefix: every field persists at `settings.<key>.<field>`. */
    key: string;
    defaults: S;
    /**
     * Keys read with no default at load and handed to `migrate` (F5): a setting this
     * version no longer has (OpenAI's `turnDetectionMode`), or a field whose
     * absence must be told from its default (Palabra's `authMode`). May name
     * a field of `defaults`. May name a whole storage key
     * (`settings.common.systemInstructions`), read there, never written.
     * Nothing is written back.
     */
    legacyKeys?: readonly string[];
    /** Turns what was stored — every field of `defaults`, each read with its default — into this version's `S`. */
    migrate?(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): S;
  };
  Settings: ComponentType<SettingsProps<S>>;
  /** Model management, the local engines only: pushed from the summary in Simple mode, inline on Advanced's Provider tab. */
  Engine?: ComponentType<EngineProps<S>>;
  /** The `Engine`'s summary under the picker: its slot chips and memory estimate — Simple mode's way in, and drawn before `Engine` on Advanced's Provider tab (ruling 15). */
  EngineSummary?: ComponentType<EngineSummaryProps<S>>;
  /**
   * The provider's own tuning of automatic turn detection. The Summary is
   * shown in the Speech section while the turn mode is Auto, in both layouts
   * as a link to the Controls (from Simple it switches to Advanced first).
   * The Controls live on Advanced's
   * Provider tab, drawn by the host as their own block in every turn mode.
   * Each renders nothing while there is nothing to tune: the section then
   * shows no row at all, and the host's empty block is hidden.
   */
  TurnDetection?: {
    /** Text only — no tooltip. The section places `Help` itself, as a sibling. */
    Summary: ComponentType<SettingsProps<S>>;
    Controls: ComponentType<SettingsProps<S>>;
    /**
     * An explanatory tooltip trigger for the row, rendered by the section as
     * a sibling right after the Summary/link — never nested inside the link
     * `<button>`, whose own click must not fire the trigger's.
     * Optional: a provider with nothing to explain omits it. Follows
     * `Summary`'s own rule — render nothing while there is nothing to tune.
     */
    Help?: ComponentType<SettingsProps<S>>;
  };

  // credentials — stored apart from settings
  credentials: {
    /** Every key `fields` can ever return, so all of them load at startup. */
    keys: readonly string[];
    fields(s: S): readonly CredentialField[];
    /**
     * Receives the values of exactly the fields `fields(s)` returns. `R` has
     * no `missing` member — the type parameter's constraint enforces it. A
     * missing answer may carry a code (F3).
     */
    read(values: CredentialValues, auth: AuthContext): R | CredentialsMissing;
    /** A setting that picks which fields show, drawn by the credential form above them (F4). */
    choice?: CredentialChoice;
  };
  /**
   * Can this provider start now: a network validation, model readiness, or
   * the service's answer for a managed provider (the sign-in itself is
   * `credentials.read`'s to see). Throw when the check could not find out
   * (offline), and bound your own request: throw when it has not answered
   * within its limit, or the provider stays `checking` with Start off and no
   * words. Answer `ok: false` only when the provider said no. The last ready
   * answer is kept with its settings, credentials, pair and legs — or, when
   * `checkReads` is declared, with the fields it lists — and, for a
   * managed provider, its sign-in and account; a local provider is asked
   * every time.
   */
  check(r: R, s: S, ctx: CheckContext): Promise<CheckResult>;
  /**
   * The settings fields `check` reads (Stage 2 OpenAI Realtime, ruling 9):
   * an edit to any other field keeps the readiness answer — ready or not,
   * Start stays as it was, and nothing is checked again — unless the edit
   * moved the run's pair; a kept ready answer is keyed on these alone. Every
   * field `check` reads must be listed, and every field that decides the
   * credential fields. Absent: every field, as before. OpenAI Realtime's
   * model list reads none (`[]`).
   */
  checkReads?: readonly (keyof S & string)[];
  /**
   * Calls back when something `check` reads besides the settings,
   * credentials, pair and legs has changed — a local engine's models
   * downloading. The app re-checks a local provider then (plan 1e-3a
   * ruling 6). Returns the unsubscribe.
   */
  watchReadiness?(onChange: () => void): () => void;

  languages: {
    /** Includes `AUTO` when the provider detects the language. Without a `context`: the widest offer. */
    sources(s: S, context?: LanguageContext): readonly LanguageOption[];
    /** Never includes `AUTO`. Without a `context`: the widest offer. */
    targets(source: string, s: S, context?: LanguageContext): readonly LanguageOption[];
    /** The pair to start from when nothing is stored; normalized like any stored pair. Absent: the first source and its first target. */
    initial?(s: S): Partial<LanguagePair>;
    /**
     * Rewrites the stored pair before it is normalized (F5): a code the
     * provider renamed (Palabra's `vn` → `vi`). '' in a side means nothing
     * is stored there; a side returned as '' falls back to `initial`.
     */
    migratePair?(stored: LanguagePair, s: S): LanguagePair;
  };

  // the only capabilities generic code reads
  speech: 'always' | 'optional' | 'never';
  textInput: boolean;
  boundaries(s: S): 'provider' | 'silence';
  turns(s: S): ReadonlyArray<'auto' | 'manual'>;
  /**
   * Whether the participant leg may speak. `false`: never, whatever its
   * switch says — Kizuna Soniox ships so until the backend mints a
   * participant speech key (Stage 2 Kizuna Soniox, ruling 2); the switch
   * then shows off and disabled with a "not available yet" tooltip,
   * keeping the stored choice. Absent or `true`: the participant speaks
   * when its switch is on.
   */
  participantSpeech?: boolean;

  // one leg's session; `C` has no `refused` member — the type parameter's constraint enforces it
  build(context: SessionContext, s: S, shared: SharedSettings): C | ProviderRefusal;
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string };
  start: Adapter<C, K>['start'];

  // across legs and time — optional
  session?: SessionHooks<S, K, C>;
}

/**
 * A provider whose `S`, `K`, `C` and `R` are not known here. The registry
 * holds providers of different types, and generic code treats all four as
 * opaque.
 */
export type AnyProvider = Provider<any, any, any, any>;
