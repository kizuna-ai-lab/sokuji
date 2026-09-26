/**
 * The provider definition: one object per provider, and the only thing
 * generic code knows about it (spec: "The provider definition"). Types only.
 */
import type { ComponentType } from 'react';
import type { Adapter, SessionContext } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import type { SessionHooks } from '../session/types';

export type Platform = 'electron' | 'extension' | 'web';
export type ProviderKind = 'own-key' | 'managed' | 'local';

export interface LanguageOption { value: string; name: string; englishName: string }
export interface LanguagePair { source: string; target: string }

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
   * default: `undefined` where nothing was ever stored. Chrome storage keeps
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

/** What a builder may read beyond its own settings; a builder never reaches into a store. */
export interface SharedSettings {
  /** The system instructions for a direction: the user's for the speaker's direction, the participant prompt for the reverse. */
  instructions(direction: SessionContext['direction']): string;
  /** The segmentation pauses, in seconds, as stored. */
  pauses: { sourceSeconds: number; translationSeconds: number };
  /** This is the participant's direction: the pair's reverse. */
  reversed(direction: SessionContext['direction']): boolean;
  /** The display segmentation as stored: a provider that cuts its own jobs follows it (LocalInference). */
  segmentation: { mode: 'off' | 'pause' | 'sentences'; sentencesPerRow: number };
  /** The models this run's own readiness check found (F2): the list its settings component was shown, for the same effective-model function. */
  models: readonly ModelOption[];
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

export interface Provider<S, K extends { missing?: never } & object, C extends { refused?: never } & object> {
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
   * ?? id>.name` and `.description`. LocalInference's is `local_inference`,
   * OpenAI Compatible's will be `openaiCompatible`.
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
     * a field of `defaults`. Nothing is written back.
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
     * Receives the values of exactly the fields `fields(s)` returns. `K` has
     * no `missing` member — the type parameter's constraint enforces it. A
     * missing answer may carry a code (F3).
     */
    read(values: CredentialValues, auth: AuthContext): K | CredentialsMissing;
  };
  /**
   * Can this provider start now: a network validation, model readiness, or
   * the service's answer for a managed provider (the sign-in itself is
   * `credentials.read`'s to see). Throw when the check could not find out
   * (offline), and bound your own request: throw when it has not answered
   * within its limit, or the provider stays `checking` with Start off and no
   * words. Answer `ok: false` only when the provider said no. The last ready
   * answer is kept with its settings, credentials, pair and legs — and, for a
   * managed provider, its sign-in and account; a local provider is asked
   * every time.
   */
  check(k: K, s: S, ctx: CheckContext): Promise<CheckResult>;
  /**
   * Calls back when something `check` reads besides the settings,
   * credentials, pair and legs has changed — a local engine's models
   * downloading. The app re-checks a local provider then (plan 1e-3a
   * ruling 6). Returns the unsubscribe.
   */
  watchReadiness?(onChange: () => void): () => void;

  languages: {
    /** Includes `AUTO` when the provider detects the language. */
    sources(s: S): readonly LanguageOption[];
    /** Never includes `AUTO`. */
    targets(source: string, s: S): readonly LanguageOption[];
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

  // one leg's session; `C` has no `refused` member — the type parameter's constraint enforces it
  build(context: SessionContext, s: S, shared: SharedSettings): C | ProviderRefusal;
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string };
  start: Adapter<C, K>['start'];

  // across legs and time — optional
  session?: SessionHooks<S, K, C>;
}

/**
 * A provider whose `S`, `K` and `C` are not known here. The registry holds
 * providers of different types, and generic code treats all three as opaque.
 */
export type AnyProvider = Provider<any, any, any>;
