/**
 * A Kizuna twin (spec: "Managed twins are composition"): the base's
 * languages and units under its own id, kind, vendor, icon and storage
 * key; credentials read from the sign-in with no field; a static `check`;
 * and the lease that mints its per-leg keys.
 * What it takes from the base is named member by member (Stage 2 Kizuna
 * Soniox, choice 2): a member added to the base later is a decision here.
 */
import type { ComponentType } from 'react';
import type { AuthContext, SessionHooks, SessionWords, UnitDefinition } from '../run/types';
import type { AnyProvider, CredentialsMissing, FileRecognitionSpec, Provider, SettingsProps, VoiceSummaryProps } from './types';
import type { RunStage } from '../lineup/types';

/** What a managed `read` answers (the read type `R`, choice 1): the sign-in, never a key — the lease mints those. */
export interface ManagedSignIn {
  readonly signedIn: true;
}

/** The sign-in, as a managed provider's `read` answers it: loading, signed out, or signed in. */
export function readSignIn(auth: AuthContext, signedOut: string): ManagedSignIn | CredentialsMissing {
  if (auth.loaded === false) return { missing: 'The sign-in is still loading.', code: 'sign_in_pending' };
  return auth.signedIn ? { signedIn: true } : { missing: signedOut, code: 'sign_in_required' };
}

export interface ManagedOverrides<S, K, C, Id extends string> {
  id: Id;
  vendor: string;
  icon: ComponentType<{ size?: string | number }>;
  /** The twin's own storage prefix (its old slice key). */
  settingsKey: string;
  /** The base's settings component in its managed flavour. */
  Settings: ComponentType<SettingsProps<S>>;
  /** The stages its options act on (mock v19), when its view differs from the base provider's. */
  settingsStages?: readonly (readonly RunStage[])[];
  /** The twin's own setup guide; never the base's, which is about getting the vendor's key. */
  guideUrl?: string;
  /** The base's voice summary in its managed flavour; absent, the base's own, if it has one. */
  VoiceSummary?: ComponentType<VoiceSummaryProps<S>>;
  /** Diagnostic English for a signed-out `read`; the user reads `sign_in_required`'s words. */
  signedOut: string;
  /** The twin's own units; absent, its base's. */
  units?: readonly UnitDefinition[];
  /** The twin is flagged on its own; the base's flag never carries over. */
  flagged?: true;
  /** The twin's own file recognition, through the sign-in; absent, it transcribes no file (the base's needs a key). */
  fileRecognition?: (settings: S, credentials: K, words?: SessionWords) => FileRecognitionSpec | { missing: 'no-key' };
  /** Added to the base's hooks. `acquire` is required: a twin's `R` is not its `K`. */
  session: SessionHooks<S, K, C, AnyProvider> & Required<Pick<SessionHooks<S, K, C, AnyProvider>, 'acquire'>>;
}

export function managed<S, K extends { missing?: never } & object, C extends { refused?: never } & object, Id extends string>(
  base: Provider<S, K, C>,
  o: ManagedOverrides<S, K, C, Id>,
): Provider<S, K, C, ManagedSignIn> & { id: Id } {
  return {
    id: o.id,
    kind: 'managed',
    platforms: base.platforms,
    icon: o.icon,
    vendor: o.vendor,
    ...(o.guideUrl ? { guideUrl: o.guideUrl } : {}),
    ...(o.flagged ? { flagged: true as const } : {}),
    // Member by member (choice 2): a settings member added to the base later (`legacyKeys`, say) is a decision here, not a leak.
    settings: { key: o.settingsKey, defaults: base.settings.defaults, ...(base.settings.migrate ? { migrate: base.settings.migrate } : {}) },
    Settings: o.Settings,
    ...(base.TurnDetection ? { TurnDetection: base.TurnDetection } : {}),
    // The stages its options act on (mock v19): the same view, so the same parts.
    ...((o.settingsStages ?? base.settingsStages) ? { settingsStages: o.settingsStages ?? base.settingsStages } : {}),
    ...((o.VoiceSummary ?? base.VoiceSummary) ? { VoiceSummary: o.VoiceSummary ?? base.VoiceSummary } : {}),
    credentials: { keys: [], fields: () => [], read: (_values, auth) => readSignIn(auth, o.signedOut) },
    // Static: the sign-in is `read`'s to see, the balance the start gate's (spec: "Readiness is one check").
    check: async () => ({ ok: true }),
    languages: base.languages,
    // The twin's own, never the base's: the base's asks for the user's key, which a twin does not hold.
    ...(o.fileRecognition ? { fileRecognition: o.fileRecognition } : {}),
    ...(base.endToEnd ? { endToEnd: true as const } : {}),
    units: o.units ?? base.units,
    // The base's `startBoth` only: its other hooks (`prepare`, `admit`, `acquire`) are the base's own business, never the twin's.
    session: { ...(base.session?.startBoth ? { startBoth: base.session.startBoth } : {}), ...o.session },
  };
}
