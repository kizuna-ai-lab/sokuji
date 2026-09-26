// src/components/SetupWizard/providerPaths.ts
//
// The wizard asks "what do you have" (spec §1.2 step 2) and resolves the answer
// to a provider. The own-key and offline lists read the registry (F12, Stage 2
// Soniox); the managed one still reads the old factory, until Kizuna Soniox
// (Plan B) replaces it too.
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import type { ProviderType } from '../../types/Provider';
import type { AnyProvider } from '../../lib/provider/types';
import { providerIdFromStored, storedProviderValue } from '../../lib/session/storedSettings';
import { presentProviders } from '../../providers/registry';
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import { getScenario, providerFitForScenario } from '../../lib/setup/scenarios';
import type { ProviderFit } from '../../lib/setup/scenarios';

export interface ProviderOption {
  id: ProviderType;
  fit: ProviderFit;
}

export function managedProvider(): ProviderType | null {
  return ProviderConfigFactory.getDefaultManagedProvider();
}

/** A definition's speech as the old descriptor's `textOnlyCapability`: the word the scenario fit and the pair sentence read. */
export function textOnlyCapabilityOf(p: Pick<AnyProvider, 'speech'>): 'always' | 'optional' | 'never' {
  return p.speech === 'always' ? 'never' : p.speech === 'never' ? 'always' : 'optional';
}

/** The registered provider a draft names — drafts and records keep the old enum's spelling — or undefined. */
export function wizardProvider(id: string | null | undefined): AnyProvider | undefined {
  const registryId = providerIdFromStored(id);
  return registryId === null ? undefined : presentProviders().find((p) => p.id === registryId);
}

/** The paths the wizard offers: own key once an own-key provider is registered (Soniox, Stage 2), and offline. Managed returns with Kizuna Soniox. */
export function availablePaths(): ProviderPath[] {
  return presentProviders().some((p) => p.kind === 'own-key') ? ['own-key', 'offline'] : ['offline'];
}

export function providerFits(provider: ProviderType, scenario: ScenarioId): boolean {
  const p = wizardProvider(provider);
  return p !== undefined && providerFitForScenario(textOnlyCapabilityOf(p), getScenario(scenario)).ok;
}

/** The registry's own-key providers, in its order, each with its fit for the scenario — unfit ones greyed with the reason, never hidden. */
export function ownKeyOptions(scenario: ScenarioId): ProviderOption[] {
  const preset = getScenario(scenario);
  return presentProviders()
    .filter((p) => p.kind === 'own-key')
    .map((p) => ({ id: storedProviderValue(p.id) as ProviderType, fit: providerFitForScenario(textOnlyCapabilityOf(p), preset) }));
}

/** The managed provider with its fit for the scenario, or null in a build that
 *  registers none. Judged the same way the own-key list judges its options: a
 *  build can ship a managed twin that cannot run subtitles-only, and offering
 *  "start right away" for a subtitles-only scenario would hand the user a
 *  session the app then refuses to start. */
export function managedOption(scenario: ScenarioId): ProviderOption | null {
  const id = managedProvider();
  if (!id) return null;
  return {
    id,
    fit: providerFitForScenario(
      ProviderConfigFactory.getConfig(id).capabilities.textOnlyCapability,
      getScenario(scenario),
    ),
  };
}

/** The in-app engine; LocalNative returns with Stage 2. */
export function offlineOptions(): ProviderType[] {
  return [Provider.LOCAL_INFERENCE];
}

/** Whether a stored setup's path and provider are still on offer, so a Help
 *  re-run may pre-fill them (1e-3 ruling 15). A record whose card is gone —
 *  managed until Stage 2, or an own-key provider this build no longer
 *  registers — starts the re-run blank: seeded, the wizard would advance on
 *  the old provider and Finish into one this build lacks. */
export function offersRecord(record: { scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: string }): boolean {
  const { scenario, providerPath, provider } = record;
  if (!scenario || !providerPath || !availablePaths().includes(providerPath)) return false;
  switch (providerPath) {
    case 'offline': return offlineOptions().includes(provider as ProviderType);
    case 'managed': return managedProvider() === provider;
    case 'own-key': return ownKeyOptions(scenario).some((option) => option.id === provider);
  }
}
