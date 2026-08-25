// src/components/Tour/tourContext.ts
//
// What the catalogue's predicates and copy variants read (spec §2.2). Built
// once at tour start from the setup record and the live stores; predicates
// read `mode`/`textOnly`, never the scenario id, so a migrated user with
// `scenario: null` still gets the right device steps.
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import type { ProviderType } from '../../types/Provider';

export interface TourCtx {
  scenario: ScenarioId | null;
  providerPath: ProviderPath | null;
  provider: ProviderType;
  platform: 'electron' | 'extension';
  os: 'linux' | 'mac' | 'windows' | 'other';
  mode: 'speaker' | 'participant' | 'both';
  textOnly: boolean;
  isSignedIn: boolean;
  /** settingsStore.isApiKeyValid — or, right after the wizard, its outcome. */
  apiKeyValid: boolean | null;
}

export function buildTourCtx(i: {
  record: { scenario: ScenarioId | null; providerPath: ProviderPath | null } | null;
  provider: ProviderType;
  mode: TourCtx['mode'];
  textOnly: boolean;
  isSignedIn: boolean;
  apiKeyValid: boolean | null;
  env: { isElectron: boolean; isLinux: boolean; isMacOS: boolean; isWindows: boolean };
}): TourCtx {
  const os: TourCtx['os'] = i.env.isLinux ? 'linux' : i.env.isMacOS ? 'mac' : i.env.isWindows ? 'windows' : 'other';
  return {
    scenario: i.record?.scenario ?? null,
    providerPath: i.record?.providerPath ?? null,
    provider: i.provider,
    platform: i.env.isElectron ? 'electron' : 'extension',
    os,
    mode: i.mode,
    textOnly: i.textOnly,
    isSignedIn: i.isSignedIn,
    apiKeyValid: i.apiKeyValid,
  };
}
