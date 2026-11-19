// src/lib/plan/testing.ts
//
// Fixtures for tests: plans built straight from a provider definition.
// Imported by tests only.
import { RUN_STAGES } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { PlannedUnit, RunPlan } from './types';
import { unitsOf } from './wholeUnit';

/** The plan of a line-up that names `p` on every stage, built without the catalog (a test's stub provider is not in it). */
export function planOf(p: AnyProvider): RunPlan {
  const u: PlannedUnit = { provider: p, unit: unitsOf(p)[0], stages: RUN_STAGES };
  return { units: [u], byStage: { transcription: u, translation: u, speech: u } };
}
