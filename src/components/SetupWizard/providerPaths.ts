// src/components/SetupWizard/providerPaths.ts
//
// The wizard asks "what do you have" (spec §1.2 step 2) and resolves the answer
// to a provider. Reads the same registry and gates the rest of the app does, so
// it can never offer a provider ProviderConfigFactory did not register.
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { Provider, isKizunaManagedProvider } from '../../types/Provider';
import type { ProviderType } from '../../types/Provider';
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import { getScenario, providerFitForScenario } from '../../lib/setup/scenarios';
import type { ProviderFit } from '../../lib/setup/scenarios';

export interface ProviderOption {
  id: ProviderType;
  fit: ProviderFit;
}

const LOCAL: ProviderType[] = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];

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

/** User-managed providers in registration order, each with its fit for the
 *  scenario — unfit ones are shown greyed with the reason, never hidden. */
export function ownKeyOptions(scenario: ScenarioId): ProviderOption[] {
  const preset = getScenario(scenario);
  return ProviderConfigFactory.getAvailableProviders()
    .filter((id) => !isKizunaManagedProvider(id) && !LOCAL.includes(id))
    .map((id) => ({
      id,
      fit: providerFitForScenario(ProviderConfigFactory.getConfig(id).capabilities.textOnlyCapability, preset),
    }));
}

/** WASM everywhere; Native only where its gate (Electron) registered it. */
export function offlineOptions(): ProviderType[] {
  return LOCAL.filter((id) => ProviderConfigFactory.isProviderSupported(id));
}
