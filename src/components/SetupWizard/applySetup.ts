// src/components/SetupWizard/applySetup.ts
//
// The one place the wizard writes anything (spec §1.5). Store actions come in
// as an argument so this stays testable without the stores' import graph, and
// so the ORDER is a fact of this file rather than of whichever component calls
// it: the provider's write before the record (the app session's readiness
// then re-checks once, over final values), record last. No display mode: a
// mode the user chose stays chosen, whatever the scenario and however often
// the wizard runs (Stage 2 session end, ruling 1).
import { getScenario } from '../../lib/setup/scenarios';
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import type { ProviderType } from '../../types/Provider';
import type { SetupDraft } from './setupDraft';

export interface ApplySetupDeps {
  setMode: (m: 'speaker' | 'participant' | 'both') => void;
  /** Both's other side: every scenario says, so a re-run never leaves a stale "beside me". */
  setOtherSide: (side: 'meeting' | 'beside') => void;
  /** A face-to-face scenario has met Both's other side already: its popover need not open by itself. */
  setBothPopoverSeen: (seen: boolean) => void;
  setTextOnly: (v: boolean) => void;
  /** The provider, its pair and — on the own-key path — its credentials and
   *  the credential choice its step showed (a settings patch; F4), written
   *  where the session reads them; the one write the wizard makes besides
   *  the presets and the record. Rejects with `SetupPersistError` when a
   *  write did not land; the record is then not written. */
  applyProvider: (
    provider: ProviderType,
    pair: { source: string; target: string },
    credentials: Record<string, string>,
    settings: Record<string, string>,
  ) => Promise<void>;
  completeSetup: (r: { scenario: ScenarioId; providerPath: ProviderPath; provider: string }) => Promise<void>;
}

export async function applySetupDraft(draft: SetupDraft, deps: ApplySetupDeps): Promise<void> {
  const { scenario, providerPath, provider, sourceLanguage, targetLanguage } = draft;
  if (!scenario || !providerPath || !provider || !sourceLanguage || !targetLanguage) {
    throw new Error('applySetupDraft: draft is incomplete');
  }
  const preset = getScenario(scenario);

  deps.setMode(preset.mode);
  deps.setOtherSide(preset.otherSide ?? 'meeting');
  if (preset.otherSide === 'beside') deps.setBothPopoverSeen(true);
  deps.setTextOnly(preset.textOnly);

  const credentials = providerPath === 'own-key' && !draft.credentialsPending ? draft.credentials : {};
  // The credential choice the step showed is written even when the key was
  // skipped: Settings then shows the fields the user chose (Stage 2
  // Volcengine AST2, ruling 1).
  const choice = providerPath === 'own-key' ? draft.credentialChoice : null;
  const settings = choice ? { [choice.setting]: choice.value } : {};
  // Awaited: a rejected write has to reach Finish's error path rather than
  // becoming an unhandled rejection behind a "done" wizard.
  await deps.applyProvider(provider, { source: sourceLanguage, target: targetLanguage }, credentials, settings);
  await deps.completeSetup({ scenario, providerPath, provider });
}
