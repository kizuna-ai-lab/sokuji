/**
 * A Kizuna twin (spec: "Managed twins are composition"): the base's
 * languages, capabilities, builder and adapter under its own id, kind,
 * vendor, icon and storage key; credentials read from the sign-in with no
 * field; a static `check`; and the lease that mints its per-leg keys.
 * What it takes from the base is named member by member (Stage 2 Kizuna
 * Soniox, choice 2): a member added to the base later is a decision here.
 */
import type { ComponentType } from 'react';
import type { SessionHooks } from '../session/types';
import type { AuthContext, CredentialsMissing, Provider, SettingsProps } from './types';

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
  /** Diagnostic English for a signed-out `read`; the user reads `sign_in_required`'s words. */
  signedOut: string;
  /** The participant-speech flag (ruling 2); absent, the base's capability is not narrowed. */
  participantSpeech?: boolean;
  /** Added to the base's hooks. `acquire` is required: a twin's `R` is not its `K`. */
  session: SessionHooks<S, K, C> & Required<Pick<SessionHooks<S, K, C>, 'acquire'>>;
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
    // Member by member (choice 2): a settings member added to the base later (`legacyKeys`, say) is a decision here, not a leak.
    settings: { key: o.settingsKey, defaults: base.settings.defaults, ...(base.settings.migrate ? { migrate: base.settings.migrate } : {}) },
    Settings: o.Settings,
    ...(base.TurnDetection ? { TurnDetection: base.TurnDetection } : {}),
    credentials: { keys: [], fields: () => [], read: (_values, auth) => readSignIn(auth, o.signedOut) },
    // Static: the sign-in is `read`'s to see, the balance the start gate's (spec: "Readiness is one check").
    check: async () => ({ ok: true }),
    languages: base.languages,
    speech: base.speech,
    textInput: base.textInput,
    boundaries: base.boundaries,
    turns: base.turns,
    ...(o.participantSpeech === undefined ? {} : { participantSpeech: o.participantSpeech }),
    build: base.build,
    describe: base.describe,
    start: base.start,
    // The base's `startBoth` only: its other hooks (`prepare`, `admit`, `acquire`) are the base's own business, never the twin's.
    session: { ...(base.session?.startBoth ? { startBoth: base.session.startBoth } : {}), ...o.session },
  };
}
