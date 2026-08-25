// src/components/SetupWizard/setupDraft.ts
//
// Everything the wizard collects, and the rules for moving through it. Pure:
// no store, no DOM. The UI dispatches actions; Finish hands the draft to
// applySetup. Nothing here is persisted — backing out of the wizard discards
// the draft, which is what makes every step reversible (spec §1.1).
import type { ScenarioId, ProviderPath } from '../../lib/setup/types';
import type { ProviderType } from '../../types/Provider';

export type SetupStep = 0 | 1 | 2 | 3 | 4 | 5;
export const LAST_STEP: SetupStep = 5;

export interface SetupDraft {
  step: SetupStep;
  scenario: ScenarioId | null;
  providerPath: ProviderPath | null;
  /** Resolved from the path (managed/offline) or picked by the user (own-key). */
  provider: ProviderType | null;
  /** own-key only: slice key → value, cleared when path or provider changes. */
  credentials: Record<string, string>;
  credentialsValidated: boolean;
  /** "Skip for now" was taken on step 3 (spec §1.4). */
  credentialsPending: boolean;
  sourceLanguage: string | null;
  targetLanguage: string | null;
}

export type SetupAction =
  | { type: 'setScenario'; scenario: ScenarioId; keepProvider: boolean }
  | { type: 'setPath'; path: ProviderPath; provider: ProviderType | null }
  | { type: 'setProvider'; provider: ProviderType }
  | { type: 'setCredential'; key: string; value: string }
  | { type: 'prefillCredentials'; credentials: Record<string, string> }
  | { type: 'credentialsValidated' }
  | { type: 'skipCredentials' }
  | { type: 'setLanguages'; source: string; target: string }
  | { type: 'next' }
  | { type: 'back' };

export interface AdvanceEnv {
  isSignedIn: boolean;
}

export function initialDraft(): SetupDraft {
  return {
    step: 0,
    scenario: null,
    providerPath: null,
    provider: null,
    credentials: {},
    credentialsValidated: false,
    credentialsPending: false,
    sourceLanguage: null,
    targetLanguage: null,
  };
}

/** Pre-fill for a Help re-run (spec §1.6). A migrated record carries nulls and
 *  yields a blank draft. */
export function draftFromRecord(
  r: { scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: string },
  opts: { credentialsAlreadyValid: boolean },
): SetupDraft {
  if (!r.scenario || !r.providerPath) return initialDraft();
  return {
    ...initialDraft(),
    scenario: r.scenario,
    providerPath: r.providerPath,
    provider: r.provider as ProviderType,
    credentialsValidated: r.providerPath === 'own-key' && opts.credentialsAlreadyValid,
  };
}

const cleared = {
  credentials: {} as Record<string, string>,
  credentialsValidated: false,
  credentialsPending: false,
  sourceLanguage: null,
  targetLanguage: null,
};

export function canAdvance(d: SetupDraft, env: AdvanceEnv): boolean {
  switch (d.step) {
    case 0: return true;
    case 1: return d.scenario !== null;
    case 2: return d.providerPath !== null && d.provider !== null;
    case 3:
      if (d.credentialsPending) return true;
      if (d.providerPath === 'managed') return env.isSignedIn;
      if (d.providerPath === 'own-key') return d.credentialsValidated;
      return true; // offline: nothing to provide
    case 4: return d.sourceLanguage !== null && d.targetLanguage !== null;
    case 5: return true;
  }
}

export function setupReducer(d: SetupDraft, a: SetupAction): SetupDraft {
  switch (a.type) {
    case 'setScenario':
      if (a.keepProvider) return { ...d, scenario: a.scenario };
      return { ...d, scenario: a.scenario, providerPath: null, provider: null, ...cleared };
    case 'setPath':
      return { ...d, providerPath: a.path, provider: a.provider, ...cleared };
    case 'setProvider':
      return { ...d, provider: a.provider, ...cleared };
    case 'setCredential':
      return {
        ...d,
        credentials: { ...d.credentials, [a.key]: a.value },
        credentialsValidated: false,
        credentialsPending: false,
      };
    // The key already in settings, mirrored into the draft so a re-run shows
    // what is saved instead of an empty box. Unlike a keystroke it says nothing
    // new about the key, so it must not disturb the validated/pending flags the
    // record seeded (spec §1.6).
    case 'prefillCredentials':
      return { ...d, credentials: { ...a.credentials, ...d.credentials } };
    case 'credentialsValidated':
      return { ...d, credentialsValidated: true, credentialsPending: false };
    case 'skipCredentials':
      return { ...d, credentials: {}, credentialsValidated: false, credentialsPending: true };
    case 'setLanguages':
      return { ...d, sourceLanguage: a.source, targetLanguage: a.target };
    case 'next':
      return d.step < LAST_STEP ? { ...d, step: (d.step + 1) as SetupStep } : d;
    case 'back':
      return d.step > 0 ? { ...d, step: (d.step - 1) as SetupStep } : d;
  }
}
