// src/components/SetupWizard/providerPaths.ts
//
// The wizard asks "what do you have" (spec §1.2 step 2) and resolves the answer
// to a provider. Reads the same registry and gates the rest of the app does, so
// it can never offer a provider ProviderConfigFactory did not register.
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { isKizunaManagedProvider, Provider } from '../../types/Provider';
import type { ProviderType } from '../../types/Provider';
import { OFFLINE_PROVIDERS } from '../../lib/setup/providerPath';
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

/** The paths the wizard offers. The branch runs LocalInference only until
 *  Stage 2 restores the managed and own-key providers (1e-3 rulings 1, 15),
 *  so the offline path is the one card. */
export function availablePaths(): ProviderPath[] {
  return ['offline'];
}

export function providerFits(provider: ProviderType, scenario: ScenarioId): boolean {
  const cap = ProviderConfigFactory.getConfig(provider).capabilities.textOnlyCapability;
  return providerFitForScenario(cap, getScenario(scenario)).ok;
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

/** User-managed providers in registration order, each with its fit for the
 *  scenario — unfit ones are shown greyed with the reason, never hidden. */
export function ownKeyOptions(scenario: ScenarioId): ProviderOption[] {
  const preset = getScenario(scenario);
  return ProviderConfigFactory.getAvailableProviders()
    .filter((id) => !isKizunaManagedProvider(id) && !OFFLINE_PROVIDERS.includes(id))
    .map((id) => ({
      id,
      fit: providerFitForScenario(ProviderConfigFactory.getConfig(id).capabilities.textOnlyCapability, preset),
    }));
}

/** The in-app engine; LocalNative returns with Stage 2. */
export function offlineOptions(): ProviderType[] {
  return [Provider.LOCAL_INFERENCE];
}

/** Whether a stored setup's path and provider are still on offer, so a Help
 *  re-run may pre-fill them (1e-3 ruling 15). A record whose card is gone —
 *  managed or own-key until Stage 2 — starts the re-run blank: seeded, the
 *  wizard would advance on the old provider and Finish into one this build
 *  lacks. */
export function offersRecord(record: { scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: string }): boolean {
  const { scenario, providerPath, provider } = record;
  if (!scenario || !providerPath || !availablePaths().includes(providerPath)) return false;
  switch (providerPath) {
    case 'offline': return offlineOptions().includes(provider as ProviderType);
    case 'managed': return managedProvider() === provider;
    case 'own-key': return ownKeyOptions(scenario).some((option) => option.id === provider);
  }
}
