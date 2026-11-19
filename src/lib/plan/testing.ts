// src/lib/plan/testing.ts
//
// Fixtures for tests: stub providers, and plans built straight from a provider
// definition. Imported by tests only.
import { CAPS } from '../lineup/catalog';
import { RUN_STAGES } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { ComposeInput } from './compose';
import type { PlannedUnit, RunPlan } from './types';
import { unitsOf } from './wholeUnit';

/** A provider definition with only what its whole-provider unit reads, so the real registry stays out of the tests. */
export const stubProvider = (id: string, over: Record<string, unknown> = {}): AnyProvider => ({
  id,
  speech: 'optional',
  turns: () => ['auto'],
  boundaries: () => 'silence',
  textInput: () => false,
  build: () => ({}),
  describe: () => ({}),
  start: () => undefined,
  ...over,
}) as unknown as AnyProvider;

/** A composer input that offers a stub provider for every host in the catalog, so every option is offered. */
export function stubHosts(): ComposeInput {
  return { providers: [...new Set(CAPS.map((c) => c.host))].map((id) => stubProvider(id)), settings: () => undefined };
}

/** The plan of a line-up that names `p` on every stage, built without the catalog (a test's stub provider is not in it). */
export function planOf(p: AnyProvider): RunPlan {
  const u: PlannedUnit = { provider: p, unit: unitsOf(p)[0], stages: RUN_STAGES };
  return { units: [u], byStage: { transcription: u, translation: u, speech: u } };
}
