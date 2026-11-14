// src/lib/lineup/choose.ts
//
// Choosing a provider for one stage keeps the line-up runnable: the provider
// takes the stages it binds, a provider that loses part of a bound group
// loses all of it, and in phase 1 a choice that cannot run with the other
// stages moves them to the chosen provider's family (design section 11).
import { caps, familyDefaults, runOf } from './catalog';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage, StageName } from './types';

export interface Choice {
  lineUp: LineUp;
  /** The stages that changed besides the one chosen. */
  moved: readonly StageName[];
}

export function choose(lineUp: LineUp, stage: StageName, providerId: string | null): Choice {
  if (stage === 'summarisation') return { lineUp: { ...lineUp, summarisation: providerId }, moved: [] };
  if (providerId === null) throw new Error(`The ${stage} stage cannot be switched off.`);
  const chosen = caps(providerId);
  if (!chosen || !chosen.stages.includes(stage)) throw new Error(`${providerId} cannot serve ${stage}.`);

  const group: readonly RunStage[] = chosen.binds.find((g) => g.includes(stage)) ?? [stage];
  const defaults = familyDefaults(chosen.family);
  const next: LineUp = { ...lineUp };
  for (const s of group) next[s] = providerId;

  // A provider that lost one stage of a bound group loses the whole group.
  for (const s of RUN_STAGES) {
    const previous = lineUp[s];
    if (group.includes(s) || previous === null) continue;
    const lostPartner = (caps(previous)?.binds ?? []).some((g) => g.includes(s) && g.some((t) => group.includes(t) && lineUp[t] === previous));
    if (lostPartner) next[s] = defaults[s];
  }

  // Phase 1 runs one family at a time: the rest follows the chosen provider.
  if (!runOf(next).ok) for (const s of RUN_STAGES) if (!group.includes(s)) next[s] = defaults[s];

  return { lineUp: next, moved: RUN_STAGES.filter((s) => s !== stage && next[s] !== lineUp[s]) };
}
