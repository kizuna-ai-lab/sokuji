// src/lib/lineup/oldRules.testing.ts
//
// The line-up rule as it was before the composer: which one provider ran a
// line-up (`oldRunOf`). It reads today's catalog data (`caps`), so a test that
// holds the composer to it pins the rule, not the catalog's data. Imported by
// tests only.
import { caps } from './catalog';
import { RUN_STAGES } from './types';
import type { LineUp } from './types';

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
