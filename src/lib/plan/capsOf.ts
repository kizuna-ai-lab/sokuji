// src/lib/plan/capsOf.ts
//
// The line-up catalog, read off the providers' units: what each provider can serve, which stages go together.
// Pure functions over provider definitions; reaches no provider module and no store.
import { sameStages } from './types';
import { unitsOf } from './wholeUnit';
import type { AnyProvider } from '../provider/types';
import { RUN_STAGES } from '../lineup/types';
import type { ProviderCaps, RunStage } from '../lineup/types';

/** Every non-empty subset of the run stages, each in `RUN_STAGES` order (the list itself in bitmask order). */
const SUBSETS: readonly (readonly RunStage[])[] = Array.from({ length: (1 << RUN_STAGES.length) - 1 }, (_, i) => RUN_STAGES.filter((_stage, bit) => ((i + 1) >> bit) & 1));

/** The sets of stages some unit of the provider occupies exactly, under settings `s`. */
export function occupationsOf(p: AnyProvider, s: unknown): readonly (readonly RunStage[])[] {
  const units = unitsOf(p);
  return SUBSETS.filter((w) => {
    const want = new Set(w);
    return units.some((u) => { const got = u.occupies(s, want); return got !== null && sameStages(got, want); });
  });
}

const ACCOUNT: Record<AnyProvider['kind'], ProviderCaps['account']> = { managed: 'kizuna', 'own-key': 'key', local: 'none', online: 'none' };

/** What a provider offers a line-up, from its units under its default settings. */
export function capsOf(p: AnyProvider): ProviderCaps {
  const occ = occupationsOf(p, p.settings.defaults);
  const has = (o: readonly RunStage[], stage: RunStage) => o.includes(stage);
  const stages = RUN_STAGES.filter((stage) => occ.some((o) => has(o, stage)));
  const withTl = occ.filter((o) => has(o, 'translation'));
  const translatesOwn = occ.some((o) => has(o, 'transcription') && !has(o, 'translation')) && withTl.length > 0 && withTl.every((o) => has(o, 'transcription'));
  // Only stages it serves: a stage no unit occupies is never "held together" with another.
  const joint = p.endToEnd
    ? RUN_STAGES
    : stages.filter((s) => stages.some((t) => t !== s && occ.every((o) => has(o, s) === has(o, t))));
  return {
    id: p.id,
    stages,
    host: p.id,
    ...(joint.length >= 2 ? { joint } : {}),
    ...(translatesOwn ? { translatesOwn: true } : {}),
    account: ACCOUNT[p.kind],
    voiceAlone: occ.some((o) => o.length === 1 && o[0] === 'speech'),
    takesVoice: p.endToEnd ? false : occ.some((o) => !has(o, 'speech')),
  };
}

/** One entry per provider, in their order. */
export function catalogOf(providers: readonly AnyProvider[]): readonly ProviderCaps[] {
  return providers.map(capsOf);
}
