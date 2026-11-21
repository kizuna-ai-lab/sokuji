// src/components/SetupWizard/lineUpOf.ts
//
// The line-up the wizard writes for a provider: its host's defaults (Plan 6,
// ruling 1). Its own module, reading only the catalog, so Finish's writer
// stays testable without the providers' import graph.
import { caps, hostDefaults } from '../../lib/lineup/catalog';
import type { LineUp, RunStage } from '../../lib/lineup/types';

export function lineUpOf(provider: string): Pick<LineUp, RunStage> {
  return hostDefaults(caps(provider)?.host ?? provider);
}
