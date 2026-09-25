// src/components/SetupWizard/applySetup.ts
//
// The one place the wizard writes anything (spec §1.5). Store actions come in
// as an argument so this stays testable without the stores' import graph, and
// so the ORDER is a fact of this file rather than of whichever component calls
// it: the provider's write before the record (SettingsInitializer's validation
// effect then fires once, over final values), record last.
import { getScenario } from '../../lib/setup/scenarios';
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import type { ProviderType } from '../../types/Provider';
import type { SetupDraft } from './setupDraft';

export interface ApplySetupDeps {
  setMode: (m: 'speaker' | 'participant' | 'both') => void;
  setTextOnly: (v: boolean) => void;
  setSpeakerDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
  setParticipantDisplayMode: (m: 'source' | 'translation' | 'both') => Promise<void> | void;
  /** The provider, its pair and — on the own-key path — its credentials,
   *  written where the session reads them; the one write the wizard makes
   *  besides the presets and the record. */
  applyProvider: (provider: ProviderType, pair: { source: string; target: string }, credentials: Record<string, string>) => Promise<void>;
  completeSetup: (r: { scenario: ScenarioId; providerPath: ProviderPath; provider: string }) => Promise<void>;
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
  // Awaited: a rejected write has to reach Finish's error path rather than
  // becoming an unhandled rejection behind a "done" wizard.
  await deps.applyProvider(provider, { source: sourceLanguage, target: targetLanguage }, credentials);
  await deps.completeSetup({ scenario, providerPath, provider });
}
