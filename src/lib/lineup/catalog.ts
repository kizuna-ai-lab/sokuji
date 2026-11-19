// src/lib/lineup/catalog.ts
//
// What each option can serve, who runs it and which stages go together, and which of
// today's providers runs a line-up. Pure data and pure functions; the stores
// read it, nothing here reads a store.
import { RUN_STAGES } from './types';
import type { LineUp, ProviderCaps, RunStage, RunTarget } from './types';

const ALL: readonly RunStage[] = RUN_STAGES;
const JOINT: readonly RunStage[] = ['transcription', 'translation'];

/** One provider that does every stage over one connection (an end-to-end service), run by itself. */
const endToEnd = (id: string, account: ProviderCaps['account']): ProviderCaps => ({ id, stages: ALL, host: id, joint: ALL, account });

export const CAPS: readonly ProviderCaps[] = [
  { id: 'kizunaai_soniox', stages: ALL, host: 'kizunaai_soniox', joint: JOINT, account: 'kizuna' },
  endToEnd('kizunaai_qwen', 'kizuna'),
  { id: 'local_inference', stages: ALL, host: 'local_inference', account: 'none' },
  { id: 'bing', stages: ['translation'], host: 'local_inference', account: 'none' },
  { id: 'edge', stages: ['speech'], host: 'local_inference', account: 'none' },
  { id: 'soniox', stages: ALL, host: 'soniox', joint: JOINT, account: 'key' },
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

/** The line-up a host runs when nothing finer is chosen. */
export function hostDefaults(host: string): Pick<LineUp, RunStage> {
  if (host === 'local_inference') return { transcription: 'local_inference', translation: 'bing', speech: 'edge' };
  return { transcription: host, translation: host, speech: host };
}

/** Today's default for a new user: Kizuna AI where the build offers it, otherwise the free set. */
export function defaultLineUp(o: { managedOffered: boolean }): LineUp {
  return { ...hostDefaults(o.managedOffered ? 'kizunaai_soniox' : 'local_inference'), summarisation: null };
}
