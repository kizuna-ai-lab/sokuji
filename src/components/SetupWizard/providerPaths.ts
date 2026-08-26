// src/components/SetupWizard/providerPaths.ts
//
// The wizard asks "what do you have" (spec §1.2 step 2) and resolves the answer
// to a provider. Reads the same registry and gates the rest of the app does, so
// it can never offer a provider ProviderConfigFactory did not register.
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { isKizunaManagedProvider } from '../../types/Provider';
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

/** The managed card is rendered only when a managed provider exists in this build. */
export function availablePaths(): ProviderPath[] {
  const paths: ProviderPath[] = [];
  if (managedProvider()) paths.push('managed');
  paths.push('own-key', 'offline');
  return paths;
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

/** WASM everywhere; Native only where its gate (Electron) registered it. */
export function offlineOptions(): ProviderType[] {
  return OFFLINE_PROVIDERS.filter((id) => ProviderConfigFactory.isProviderSupported(id));
}
