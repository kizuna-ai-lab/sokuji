// src/lib/lineup/catalog.ts
//
// What each option can serve, who runs it and which stages go together, the
// line-up each host runs by default, the one host a line-up runs on by this
// data alone, and the ids that served a run's stages. Pure data and pure
// functions; the stores read it, nothing here reads a store.
import { RUN_STAGES } from './types';
import type { LineUp, ProviderCaps, RunStage, StageIds } from './types';

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

/** The option a line-up names for a stage, when it is known and serves that stage; undefined otherwise (unset, unknown, or not for that stage). */
export function optionFor(lineUp: Pick<LineUp, RunStage>, stage: RunStage): ProviderCaps | undefined {
  const id = lineUp[stage];
  const option = id === null ? undefined : caps(id);
  return option?.stages.includes(stage) ? option : undefined;
}

/**
 * The host that runs this line-up by the catalog alone, for code that has no providers at hand: every run stage
 * names an option that serves it, and all three share one host. Null otherwise.
 */
export function soleHost(lineUp: Pick<LineUp, RunStage>): string | null {
  let host: string | null = null;
  for (const stage of RUN_STAGES) {
    const option = optionFor(lineUp, stage);
    if (!option || (host !== null && option.host !== host)) return null;
    host = option.host;
  }
  return host;
}

/** One provider's id on every run stage. */
export function allStagesBy(id: string): StageIds {
  return { transcription: id, translation: id, speech: id };
}

/**
 * The ids that served the stages of a run on `providerId`: the stored line-up's when one is stored and runs on that
 * provider, otherwise that provider's on every stage. While the provider store's selection runs the session, a
 * line-up not stored yet, or one the selection does not run, is not what ran, so it names nothing about the run.
 */
export function stageIdsFor(lineUp: Pick<LineUp, RunStage> | null, stored: boolean, providerId: string): StageIds {
  if (!stored || !lineUp || soleHost(lineUp) !== providerId) return allStagesBy(providerId);
  // A sole host means every stage names a known option, so none is null here.
  return { transcription: lineUp.transcription!, translation: lineUp.translation!, speech: lineUp.speech! };
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
