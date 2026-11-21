// src/lib/lineup/choose.ts
//
// Choosing a provider for one stage: the provider takes the stages it holds
// jointly, and a provider that loses part of a joint group loses all of it.
// Nothing else moves. A choice the composer refuses is kept as chosen: the
// line-up page shows the refusal, and the user changes what they want
// (design section 8).
import { caps, hostDefaults } from './catalog';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage, StageName } from './types';

export interface Choice {
  lineUp: LineUp;
  /** The stages that changed besides the one chosen: its joint partners, and a joint group that lost a stage to it. */
  moved: readonly StageName[];
}

/** The line-up after choosing `providerId` for `stage`, and what else that moved. */
export function choose(lineUp: LineUp, stage: StageName, providerId: string | null): Choice {
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

  return { lineUp: next, moved: RUN_STAGES.filter((s) => s !== stage && next[s] !== lineUp[s]) };
}
