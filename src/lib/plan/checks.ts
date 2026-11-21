// src/lib/plan/checks.ts
//
// The composer's checks that are not about which unit serves a stage: a voice
// that is not offered alone, a text side that takes no other voice, two
// managed providers in one plan, and, for a run, a target language the voice
// does not speak. And a refusal as the notice every surface words. Pure;
// nothing here reads a store or the registry.
import type { SessionContext } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import { caps } from '../lineup/catalog';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, ProviderCaps, RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { PlanAccount, RunNotice } from '../session/types';
import type { PlannedUnit, PlanRefusal, RunPlan } from './types';

/**
 * A voice on another host than the transcription: refused when the voice is not offered alone, then when the
 * transcription's host takes no other voice. A line-up whose speech is on the transcription's host is never refused.
 */
export function voiceRefusal(options: Readonly<Record<RunStage, Pick<ProviderCaps, 'id' | 'host' | 'voiceAlone' | 'takesVoice'>>>): PlanRefusal | null {
  const { transcription, speech } = options;
  if (speech.host === transcription.host) return null;
  if (!speech.voiceAlone) return { refused: 'lineup_voice_not_alone', stage: 'speech', provider: speech.id };
  if (!transcription.takesVoice) return { refused: 'lineup_voice_not_taken', stage: 'speech', provider: transcription.id };
  return null;
}

/** Two managed providers in one plan: refused, at the first stage of the second one. */
export function twoManaged(units: readonly PlannedUnit[]): PlanRefusal | null {
  const first = units.find((u) => u.provider.kind === 'managed');
  const second = first && units.find((u) => u.provider.kind === 'managed' && u.provider.id !== first.provider.id);
  return second ? { refused: 'lineup_two_managed', stage: second.stages[0] } : null;
}

/** What `checkPlan` reads of a run besides its plan. */
export interface PlanCheckContext {
  /** Each provider's settings, by id: every provider of the plan. */
  accounts: Readonly<Record<string, Pick<PlanAccount, 'settings'>>>;
  /** The legs the run opens: each one's direction, and whether it is read aloud (`contextsFor`). */
  contexts: Partial<Record<LegName, Pick<SessionContext, 'direction' | 'speech'>>>;
  /** The line-up's ids, to name the option a refusal is about (Edge, not the provider that runs it). Absent: the provider's id. */
  lineUp?: Readonly<Pick<LineUp, 'speech'>>;
}

/**
 * The checks of a plan that need the run: its pair, its legs and who is read aloud. On a leg that speaks, the
 * leg's target must be a language the speech unit has a voice for; a unit that does not say speaks whatever its
 * provider translates into. Null when the plan can run this session.
 */
export function checkPlan(plan: RunPlan, context: PlanCheckContext): PlanRefusal | null {
  const { provider, unit } = plan.byStage.speech;
  const speaks = unit.capabilities(context.accounts[provider.id]?.settings).speaks;
  if (!speaks) return null;
  for (const leg of ['speaker', 'participant'] as const) {
    const told = context.contexts[leg];
    if (!told?.speech) continue;
    const { target } = told.direction;
    if (!speaks(target)) {
      return { refused: 'lineup_language_not_spoken', stage: 'speech', provider: context.lineUp?.speech ?? provider.id, language: target };
    }
  }
  return null;
}

/** The option a refusal is about: the one it names, else the one the line-up gives the refusal's stage or splits. */
function optionOf(refusal: PlanRefusal, lineUp: Readonly<Pick<LineUp, RunStage>> | null): string | undefined {
  if (refusal.provider !== undefined) return refusal.provider;
  if (!lineUp) return undefined;
  if (refusal.refused === 'lineup_no_unit') return lineUp[refusal.stage] ?? undefined;
  if (refusal.refused !== 'lineup_stage_split') return undefined;
  // The stage was given to another option than the one it goes with: that one, named on a partner stage.
  for (const stage of RUN_STAGES) {
    const id = lineUp[stage];
    if (id === null || id === lineUp[refusal.stage]) continue;
    const joint = caps(id)?.joint;
    if (joint?.includes(stage) && joint.includes(refusal.stage)) return id;
  }
  return undefined;
}

/**
 * A refusal as the notice every surface words: the refusal's code, diagnostic English, and what the words name:
 * the stage, the option the refusal is about (with the engine of a managed one, whose names are alike) and the
 * language. `lineUp` and `providers` only help to name the option; null and none, and the words name less.
 */
export function refusalNotice(refusal: PlanRefusal, lineUp: Readonly<Pick<LineUp, RunStage>> | null = null, providers: readonly AnyProvider[] = []): RunNotice {
  const { refused, stage, language } = refusal;
  const option = optionOf(refusal, lineUp);
  const host = option === undefined ? undefined : providers.find((p) => p.id === (caps(option)?.host ?? option));
  const vendor = host?.kind === 'managed' ? host.vendor : undefined;
  const named = option ?? 'a provider';
  const message: Record<PlanRefusal['refused'], string> = {
    lineup_incomplete: `The line-up names no provider for ${stage}.`,
    lineup_not_offered: `The line-up names ${named} for ${stage}, which is not offered here.`,
    lineup_stage_split: `The line-up gives ${stage} to another provider than the stage it goes with.`,
    lineup_no_unit: `The provider the line-up names for ${stage} cannot serve it beside the other stages.`,
    lineup_voice_not_alone: `The voice of ${named} is not offered beside another provider's transcription.`,
    lineup_voice_not_taken: `The translation of ${named} is not read by another provider's voice.`,
    lineup_two_managed: `The line-up names two managed providers; the second serves ${stage}.`,
    lineup_language_not_spoken: `${named} has no voice for ${language ?? 'the target language'}.`,
  };
  return {
    code: refused,
    message: message[refused],
    params: { stage, ...(option !== undefined ? { provider: option } : {}), ...(vendor ? { vendor } : {}), ...(language !== undefined ? { language } : {}) },
  };
}
