// src/lib/plan/read.ts
//
// Reading a run plan: its providers, the unit that serves a stage, the one
// provider that stands for the run where a single id is asked for, and a
// provider's account as the run froze it. Pure; nothing here reads a store or
// the registry.
import type { RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { PlanAccount, RunShape } from '../session/types';
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

/** A provider's settings and saved credential values at start. Throws for a provider that is not in the plan. */
export function accountOf(shape: Pick<RunShape, 'accounts'>, p: Pick<AnyProvider, 'id'>): PlanAccount {
  const account: PlanAccount | undefined = shape.accounts[p.id];
  if (!account) throw new Error(`No account was frozen for ${p.id}: it is not a provider of this run's plan.`);
  return account;
}
