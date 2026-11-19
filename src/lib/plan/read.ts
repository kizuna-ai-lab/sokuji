// src/lib/plan/read.ts
//
// Reading a run plan: its providers, the unit that serves a stage, and the one
// provider that stands for the run where a single id is asked for. Also the
// question a line-up answers by the catalog alone, for code with no providers
// at hand. Pure; nothing here reads a store or the registry.
import { caps } from '../lineup/catalog';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { PlannedUnit, RunPlan } from './types';

/** The providers of a plan, each once, in the order of their units. */
export function providersIn(plan: RunPlan): readonly AnyProvider[] {
  const providers: AnyProvider[] = [];
  for (const { provider } of plan.units) if (!providers.some((p) => p.id === provider.id)) providers.push(provider);
  return providers;
}

/** The unit that serves this stage of the run. */
export function unitFor(plan: RunPlan, stage: RunStage): PlannedUnit {
  return plan.byStage[stage];
}

/** The provider that transcribes: the run's identity where one provider id is asked for. */
export function transcriptionProvider(plan: RunPlan): AnyProvider {
  return plan.byStage.transcription.provider;
}

/**
 * The host that runs this line-up by the catalog alone, for code that has no providers at hand: every run stage
 * names an option that serves it, and all three share one host. Null otherwise.
 */
export function soleHost(lineUp: Pick<LineUp, RunStage>): string | null {
  let host: string | null = null;
  for (const stage of RUN_STAGES) {
    const id = lineUp[stage];
    const option = id === null ? undefined : caps(id);
    if (!option || !option.stages.includes(stage) || (host !== null && option.host !== host)) return null;
    host = option.host;
  }
  return host;
}
