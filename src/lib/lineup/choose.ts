// src/lib/lineup/choose.ts
//
// Choosing a provider for one stage keeps the line-up runnable: the provider
// takes the stages it holds jointly, a provider that loses part of a joint group
// loses all of it, and a choice the composer cannot run with the other stages
// moves them to the chosen provider's host (design section 11).
import { compose } from '../plan/compose';
import type { ComposeInput } from '../plan/compose';
import { isRefusal } from '../plan/types';
import { caps, hostDefaults } from './catalog';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage, StageName } from './types';

export interface Choice {
  lineUp: LineUp;
  /** The stages that changed besides the one chosen. */
  moved: readonly StageName[];
}

/** The line-up after choosing `providerId` for `stage`, and what else that moved; `input` is what the composer runs it on. */
export function choose(lineUp: LineUp, stage: StageName, providerId: string | null, input: ComposeInput): Choice {
  if (stage === 'summarisation') return { lineUp: { ...lineUp, summarisation: providerId }, moved: [] };
  if (providerId === null) throw new Error(`The ${stage} stage cannot be switched off.`);
  const chosen = caps(providerId);
  if (!chosen || !chosen.stages.includes(stage)) throw new Error(`${providerId} cannot serve ${stage}.`);

  const group: readonly RunStage[] = chosen.joint?.includes(stage) ? chosen.joint : [stage];
  const defaults = hostDefaults(chosen.host);
  const next: LineUp = { ...lineUp };
  for (const s of group) next[s] = providerId;

  // A provider that lost one stage of a joint group loses the whole group.
  for (const s of RUN_STAGES) {
    const previous = lineUp[s];
    if (group.includes(s) || previous === null) continue;
    const joint = caps(previous)?.joint;
    const lostPartner = !!joint && joint.includes(s) && joint.some((t) => group.includes(t) && lineUp[t] === previous);
    if (lostPartner) next[s] = defaults[s];
  }

  // A line-up the composer cannot run: the rest follows the chosen provider. A refusal for a provider this build
  // does not offer moves nothing: which providers are offered never moves a stage (the page lists only those).
  const plan = compose(next, input);
  if (isRefusal(plan) && plan.refused !== 'lineup_not_offered') for (const s of RUN_STAGES) if (!group.includes(s)) next[s] = defaults[s];

  return { lineUp: next, moved: RUN_STAGES.filter((s) => s !== stage && next[s] !== lineUp[s]) };
}
