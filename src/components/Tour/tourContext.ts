// src/components/Tour/tourContext.ts
//
// What the catalogue's predicates and copy variants read (spec §2.2). Built
// once at tour start from the setup record and the live stores; predicates
// read `mode`/`textOnly`, never the scenario id, so a migrated user with
// `scenario: null` still gets the right device steps. For the same reason the
// provider path is derived from the live provider rather than taken from the
// record: only the record's `scenario` is read here.
import { providerPathFor } from '../../lib/setup/providerPath';
import type { ProviderPath, ScenarioId } from '../../lib/setup/types';
import type { ProviderType } from '../../types/Provider';

export interface TourCtx {
  scenario: ScenarioId | null;
  /** Derived from `provider`, never from the setup record: the record's path is
   *  wizard-time history, while every step this gates points at a surface the
   *  LIVE provider renders. See providerPathFor. */
  providerPath: ProviderPath;
  provider: ProviderType;
  platform: 'electron' | 'extension' | 'web';
  os: 'linux' | 'mac' | 'windows' | 'other';
  mode: 'speaker' | 'participant' | 'both';
  textOnly: boolean;
  isSignedIn: boolean;
  /** settingsStore.isApiKeyValid — or, right after the wizard, its outcome. */
  apiKeyValid: boolean | null;
}

export function buildTourCtx(i: {
  record: { scenario: ScenarioId | null } | null;
  provider: ProviderType;
  mode: TourCtx['mode'];
  textOnly: boolean;
  isSignedIn: boolean;
  apiKeyValid: boolean | null;
  env: { isElectron: boolean; isExtension: boolean; isLinux: boolean; isMacOS: boolean; isWindows: boolean };
}): TourCtx {
  const os: TourCtx['os'] = i.env.isLinux ? 'linux' : i.env.isMacOS ? 'mac' : i.env.isWindows ? 'windows' : 'other';
  return {
    scenario: i.record?.scenario ?? null,
    providerPath: providerPathFor(i.provider),
    provider: i.provider,
    // Three, because a plain browser build is neither host: it renders no
    // subtitle button and no extension surfaces, so steps that need them
    // exclude it by predicate rather than waiting out an anchor timeout. Copy
    // variants still fall back to the extension wording — see steps.ts.
    platform: i.env.isElectron ? 'electron' : i.env.isExtension ? 'extension' : 'web',
    os,
    mode: i.mode,
    textOnly: i.textOnly,
    isSignedIn: i.isSignedIn,
    apiKeyValid: i.apiKeyValid,
  };
}
