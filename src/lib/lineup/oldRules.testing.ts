// src/lib/lineup/oldRules.testing.ts
//
// The line-up rules from before the composer, frozen: which one provider ran a
// line-up, and what a choice moved. Copied verbatim from `catalog.ts` and
// `choose.ts` before their removal, so the tests can hold the composer's answers
// to them. Imported by tests only.
import { caps, hostDefaults } from './catalog';
import type { Choice } from './choose';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage, StageName } from './types';

export type RunTarget = { ok: true; provider: string } | { ok: false; reason: 'incomplete' | 'mixed' | 'unbound' };

/** The provider of today's code that runs this line-up, or why none can. */
export function oldRunOf(lineUp: LineUp): RunTarget {
  const used = RUN_STAGES.map((stage) => ({ stage, c: lineUp[stage] === null ? undefined : caps(lineUp[stage]!) }));
  if (used.some(({ stage, c }) => !c || !c.stages.includes(stage))) return { ok: false, reason: 'incomplete' };
  const host = used[0].c!.host;
  if (used.some(({ c }) => c!.host !== host)) return { ok: false, reason: 'mixed' };
  for (const { c } of used) {
    const group = c!.joint;
    if (!group) continue;
    const usedHere = group.filter((stage) => lineUp[stage] === c!.id);
    if (usedHere.length > 0 && usedHere.length < group.length) return { ok: false, reason: 'unbound' };
  }
  return { ok: true, provider: host };
}

/** What a choice did before it asked the composer. */
export function oldChoose(lineUp: LineUp, stage: StageName, providerId: string | null): Choice {
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

  // Phase 1 runs one host at a time: the rest follows the chosen provider.
  if (!oldRunOf(next).ok) for (const s of RUN_STAGES) if (!group.includes(s)) next[s] = defaults[s];

  return { lineUp: next, moved: RUN_STAGES.filter((s) => s !== stage && next[s] !== lineUp[s]) };
}
