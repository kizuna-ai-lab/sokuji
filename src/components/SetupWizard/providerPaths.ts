// src/components/SetupWizard/providerPaths.ts
//
// The wizard asks "what do you have" (spec §1.2 step 2) and resolves the answer
// to a provider. Every list reads the registry: the managed path returned with
// Kizuna Soniox, the own-key one with Soniox (Stage 2).
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

/** The registry's default managed provider — the first present, in its order — in the old enum's spelling; null in a build that offers none. */
export function managedProvider(): ProviderType | null {
  const p = presentProviders().find((candidate) => candidate.kind === 'managed');
  return p ? (storedProviderValue(p.id) as ProviderType) : null;
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

/** The paths the wizard offers: managed first when one is present (Kizuna Soniox), own key once an own-key provider is (Soniox), and offline. */
export function availablePaths(): ProviderPath[] {
  const present = presentProviders();
  const paths: ProviderPath[] = [];
  if (present.some((p) => p.kind === 'managed')) paths.push('managed');
  if (present.some((p) => p.kind === 'own-key')) paths.push('own-key');
  paths.push('offline');
  return paths;
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

/** The managed provider with its fit for the scenario, or null in a build that registers none; judged as the own-key list judges its options. */
export function managedOption(scenario: ScenarioId): ProviderOption | null {
  const id = managedProvider();
  const p = wizardProvider(id);
  if (!id || !p) return null;
  return { id, fit: providerFitForScenario(textOnlyCapabilityOf(p), getScenario(scenario)) };
}

/** The in-app engine; LocalNative returns with Stage 2. */
export function offlineOptions(): ProviderType[] {
  return [Provider.LOCAL_INFERENCE];
}

/** Whether a stored setup's path and provider are still on offer, so a Help
 *  re-run may pre-fill them (1e-3 ruling 15). A record whose card is gone —
 *  a managed or own-key provider this build no longer registers — starts
 *  the re-run blank: seeded, the wizard would advance on the old provider
 *  and Finish into one this build lacks. */
export function offersRecord(record: { scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: string }): boolean {
  const { scenario, providerPath, provider } = record;
  if (!scenario || !providerPath || !availablePaths().includes(providerPath)) return false;
  switch (providerPath) {
    case 'offline': return offlineOptions().includes(provider as ProviderType);
    case 'managed': return managedProvider() === provider;
    case 'own-key': return ownKeyOptions(scenario).some((option) => option.id === provider);
  }
}
