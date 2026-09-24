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

/** What `credentials.read` may consult besides the typed values: the sign-in session, for managed providers. */
export interface AuthContext { signedIn: boolean; getToken(): Promise<string | null> }

export interface ModelOption { id: string }

/** `models`, when present, is newest first. */
export type CheckResult = { ok: true; models?: readonly ModelOption[] } | { ok: false; reason: string };

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
  | { state: 'not-ready'; reason: string };

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
}

export interface SettingsProps<S> {
  settings: S;
  update(patch: Partial<S>): void;
  /** A run is not idle: the provider's settings are locked. */
  disabled?: boolean;
  /** The provider's language pair, for a `Settings`/`Engine` that needs it (LocalInference's model management is per direction). Set by `ProviderPanel`; absent elsewhere. */
  pair?: LanguagePair;
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

  // settings — never secrets
  settings: {
    /** Storage prefix: every field persists at `settings.<key>.<field>`. */
    key: string;
    defaults: S;
    /** Turns what was stored — every field of `defaults`, each read with its default — into this version's `S`. */
    migrate?(stored: Readonly<Record<string, unknown>>): S;
  };
  Settings: ComponentType<SettingsProps<S>>;
  /** Model management, shown in Simple mode too; the local engines only. */
  Engine?: ComponentType<SettingsProps<S>>;

  // credentials — stored apart from settings
  credentials: {
    /** Every key `fields` can ever return, so all of them load at startup. */
    keys: readonly string[];
    fields(s: S): readonly CredentialField[];
    /** Receives the values of exactly the fields `fields(s)` returns. `K` has no `missing` member — the type parameter's constraint enforces it. */
    read(values: CredentialValues, auth: AuthContext): K | { missing: string };
  };
  /**
   * Can this provider start now: a network validation, model readiness, or a
   * signed-in session. Throw when the check could not find out (offline);
   * answer `ok: false` only when the provider said no. Readiness is cached
   * per settings, credentials, sign-in, pair and legs.
   */
  check(k: K, s: S, ctx: CheckContext): Promise<CheckResult>;

  languages: {
    /** Includes `AUTO` when the provider detects the language. */
    sources(s: S): readonly LanguageOption[];
    /** Never includes `AUTO`. */
    targets(source: string, s: S): readonly LanguageOption[];
    /** The pair to start from when nothing is stored; normalized like any stored pair. Absent: the first source and its first target. */
    initial?(s: S): Partial<LanguagePair>;
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
