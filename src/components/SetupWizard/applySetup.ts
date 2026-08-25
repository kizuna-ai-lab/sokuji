// src/components/SetupWizard/applySetup.ts
//
// The one place the wizard writes anything (spec §1.5). Store actions come in
// as an argument so this stays testable without the stores' import graph, and
// so the ORDER is a fact of this file rather than of whichever component calls
// it: slice before provider (SettingsInitializer's validation effect then fires
// once, over final values), record last.
import { getScenario } from '../../lib/setup/scenarios';
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import type { ProviderType } from '../../types/Provider';
import type { SetupDraft } from './setupDraft';

export interface ApplySetupDeps {
  /** settingsStore.provider BEFORE the writes — decides the re-validate gap. */
  currentProvider: ProviderType;
  sliceKeyFor: (p: ProviderType) => string;
  setMode: (m: 'speaker' | 'participant' | 'both') => void;
  setTextOnly: (v: boolean) => void;
  setSpeakerDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
  setParticipantDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
  updateProviderSlice: (sliceKey: string, patch: Record<string, unknown>) => Promise<void>;
  setProvider: (p: ProviderType) => void | Promise<void>;
  completeSetup: (r: { scenario: ScenarioId; providerPath: ProviderPath; provider: string }) => Promise<void>;
  /** settingsStore.validateApiKey, bound by the caller with its auth getter. */
  validateApiKey: () => Promise<unknown>;
}

export async function applySetupDraft(draft: SetupDraft, deps: ApplySetupDeps): Promise<void> {
  const { scenario, providerPath, provider, sourceLanguage, targetLanguage } = draft;
  if (!scenario || !providerPath || !provider || !sourceLanguage || !targetLanguage) {
    throw new Error('applySetupDraft: draft is incomplete');
  }
  const preset = getScenario(scenario);

  deps.setMode(preset.mode);
  deps.setTextOnly(preset.textOnly);
  if (preset.speakerDisplayMode) await deps.setSpeakerDisplayMode(preset.speakerDisplayMode);
  if (preset.participantDisplayMode) await deps.setParticipantDisplayMode(preset.participantDisplayMode);

  const credentials = providerPath === 'own-key' && !draft.credentialsPending ? draft.credentials : {};
  await deps.updateProviderSlice(deps.sliceKeyFor(provider), { sourceLanguage, targetLanguage, ...credentials });

  // Awaited: a rejected persist has to reach Finish's error path rather than
  // becoming an unhandled rejection behind a "done" wizard.
  await deps.setProvider(provider);
  await deps.completeSetup({ scenario, providerPath, provider });

  // settingsStore.setProvider clears the validation cache unconditionally —
  // even when the provider it is handed is the one already selected. On an
  // unchanged provider SettingsInitializer's effects do not re-fire, so
  // readiness would stay cleared until something else validated: the managed
  // path lands on "managed-key-unavailable", the offline path on an
  // un-validated engine. Re-derive it here for EVERY path when the provider
  // did not change. (Secondary reason: SettingsInitializer also misses
  // credential changes for Soniox's regional keys.)
  if (provider === deps.currentProvider) {
    // Best-effort: on the offline path this routes into model-readiness checks
    // that can reject. A rejection here must not cost Finish its completion —
    // the setup record is already written. SettingsInitializer re-derives the
    // readiness verdict on the next change, and the Start gate shows its own
    // message in the meantime.
    try {
      await deps.validateApiKey();
    } catch (err) {
      console.warn('[applySetup] Post-finish validation failed:', err);
    }
  }
}
