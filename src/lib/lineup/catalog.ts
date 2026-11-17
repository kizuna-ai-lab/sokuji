// src/lib/lineup/catalog.ts
//
// What each provider can serve and what it binds together, and which of
// today's providers runs a line-up. Pure data and pure functions; the stores
// read it, nothing here reads a store.
import { RUN_STAGES } from './types';
import type { LineUp, ProviderCaps, RunStage, RunTarget } from './types';

const ALL: readonly RunStage[] = RUN_STAGES;
const JOINT: readonly RunStage[] = ['transcription', 'translation'];

/** One provider that does every stage over one connection (an end-to-end service), in its own family. */
const endToEnd = (id: string, account: ProviderCaps['account']): ProviderCaps => ({ id, stages: ALL, binds: [ALL], family: id, account });

export const CAPS: readonly ProviderCaps[] = [
  { id: 'kizunaai_soniox', stages: ALL, binds: [JOINT], family: 'kizunaai_soniox', account: 'kizuna' },
  endToEnd('kizunaai_qwen', 'kizuna'),
  { id: 'local_inference', stages: ALL, binds: [], family: 'local_inference', account: 'none' },
  { id: 'bing', stages: ['translation'], binds: [], family: 'local_inference', account: 'none' },
  { id: 'edge', stages: ['speech'], binds: [], family: 'local_inference', account: 'none' },
  { id: 'soniox', stages: ALL, binds: [JOINT], family: 'soniox', account: 'key' },
  endToEnd('gemini', 'key'),
  endToEnd('volcengine_ast2', 'key'),
  endToEnd('openai', 'key'),
  endToEnd('openai_translate', 'key'),
  endToEnd('openai_live', 'key'),
  endToEnd('qwen_livetranslate', 'key'),
  endToEnd('palabraai', 'key'),
  // The E2E build (`--mode e2e`) runs its sessions on the fake providers, so there a line-up may name them.
  // Elsewhere they stay out: a development build reaches the fake through the stored provider alone.
  ...(import.meta.env.MODE === 'e2e' ? [endToEnd('fake', 'none'), endToEnd('fake_leased', 'none')] : []),
];

export function caps(id: string): ProviderCaps | undefined {
  return CAPS.find((c) => c.id === id);
}

/** The provider of today's code that runs this line-up, or why none can. */
export function runOf(lineUp: LineUp): RunTarget {
  const used = RUN_STAGES.map((stage) => ({ stage, c: lineUp[stage] === null ? undefined : caps(lineUp[stage]!) }));
  if (used.some(({ stage, c }) => !c || !c.stages.includes(stage))) return { ok: false, reason: 'incomplete' };
  const family = used[0].c!.family;
  if (used.some(({ c }) => c!.family !== family)) return { ok: false, reason: 'mixed' };
  for (const { c } of used) {
    for (const group of c!.binds) {
      const usedHere = group.filter((stage) => lineUp[stage] === c!.id);
      if (usedHere.length > 0 && usedHere.length < group.length) return { ok: false, reason: 'unbound' };
    }
  }
  return { ok: true, provider: family };
}

/** The line-up a family runs when nothing finer is chosen. */
export function familyDefaults(family: string): Pick<LineUp, RunStage> {
  if (family === 'local_inference') return { transcription: 'local_inference', translation: 'bing', speech: 'edge' };
  return { transcription: family, translation: family, speech: family };
}

/** Today's default for a new user: Kizuna AI where the build offers it, otherwise the free set. */
export function defaultLineUp(o: { managedOffered: boolean }): LineUp {
  return { ...familyDefaults(o.managedOffered ? 'kizunaai_soniox' : 'local_inference'), summarisation: null };
}
