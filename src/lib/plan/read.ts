// src/lib/plan/read.ts
//
// Reading a run plan: its providers, the unit that serves a stage, whether a
// provider is the one that speaks, the one
// provider that stands for the run where a single id is asked for and its
// account, a provider's account as the run froze it, and what a stage's unit
// can do.
// Pure; nothing here reads a store or the registry.
import { RUN_STAGES } from '../lineup/types';
import type { RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { RunShape } from '../session/types';
import type { PlanAccount, UnitCapabilities } from '../run/types';
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

/**
 * Whether the plan asks this provider for speech: a unit of it serves the speech stage. A managed provider's lease,
 * floor and voice claim read this, not whether the run speaks: with another provider's voice it is asked for text.
 */
export function servesSpeech(plan: RunPlan, provider: Pick<AnyProvider, 'id'>): boolean {
  return plan.byStage.speech.provider.id === provider.id;
}

/**
 * Whether the plan asks this provider to transcribe: a unit of it serves the transcription stage. With
 * `servesSpeech` it tells a provider that only speaks in a plan (another provider's text, read by its voice) from
 * one that runs the whole session.
 */
export function servesTranscription(plan: RunPlan, provider: Pick<AnyProvider, 'id'>): boolean {
  return plan.byStage.transcription.provider.id === provider.id;
}

/** The stages a provider serves in a plan, in stage order; none for a provider that is not in it. */
export function stagesOf(plan: RunPlan, provider: Pick<AnyProvider, 'id'>): readonly RunStage[] {
  return RUN_STAGES.filter((stage) => plan.byStage[stage].provider.id === provider.id);
}

/**
 * What a provider's readiness check is told it serves (`CheckContext.stages`): its stages in the plan while
 * another provider serves the rest. Undefined when it serves every stage, or none: its check then reads all it
 * can serve.
 */
export function checkStagesOf(plan: RunPlan, provider: Pick<AnyProvider, 'id'>): readonly RunStage[] | undefined {
  const stages = stagesOf(plan, provider);
  return stages.length === 0 || stages.length === RUN_STAGES.length ? undefined : stages;
}

/** The provider that transcribes: the run's identity where one provider id is asked for. */
export function transcriptionProvider(plan: RunPlan): AnyProvider {
  return plan.byStage.transcription.provider;
}

/**
 * The transcription provider's entry in a plan's accounts: the run's pair and settings where one provider's are asked
 * for. Throws when the accounts hold none for it.
 */
export function transcriptionAccount<A>(found: { plan: RunPlan; accounts: Readonly<Record<string, A>> }): A {
  const { id } = transcriptionProvider(found.plan);
  const account: A | undefined = found.accounts[id];
  if (account === undefined) throw new Error(`No account was found for ${id}, the plan's transcription provider.`);
  return account;
}

/** A provider's settings and saved credential values at start. Throws for a provider that is not in the plan. */
export function accountOf(shape: Pick<RunShape, 'accounts'>, p: Pick<AnyProvider, 'id'>): PlanAccount {
  const account: PlanAccount | undefined = shape.accounts[p.id];
  if (!account) throw new Error(`No account was frozen for ${p.id}: it is not a provider of this run's plan.`);
  return account;
}

/** What the unit that serves `stage` can do, under its provider's settings in `accounts`. */
export function capabilitiesOf(shape: Pick<RunShape, 'plan' | 'accounts'>, stage: RunStage): UnitCapabilities {
  const { provider, unit } = unitFor(shape.plan, stage);
  return unit.capabilities(accountOf(shape, provider).settings);
}
