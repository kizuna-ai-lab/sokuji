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

/**
 * One provider that does every stage over one connection (an end-to-end service), run by itself. Its voice reads
 * only its own translation, and its translation is read only by its own voice: it is not known, per vendor, to stop
 * making and charging for audio when asked for text alone.
 */
const endToEnd = (id: string, account: ProviderCaps['account']): ProviderCaps => ({ id, stages: ALL, host: id, joint: ALL, account, voiceAlone: false, takesVoice: false });

export const CAPS: readonly ProviderCaps[] = [
  // Its text may be read by another voice (a text-only session of it), and its voice may read another provider's
  // text (a session of it that holds speech keys only).
  { id: 'kizunaai_soniox', stages: ALL, host: 'kizunaai_soniox', joint: JOINT, account: 'kizuna', voiceAlone: true, takesVoice: true },
  endToEnd('kizunaai_qwen', 'kizuna'),
  { id: 'local_inference', stages: ALL, host: 'local_inference', account: 'none', voiceAlone: true, takesVoice: true },
  { id: 'bing', stages: ['translation'], host: 'local_inference', account: 'none', voiceAlone: false, takesVoice: true },
  { id: 'edge', stages: ['speech'], host: 'local_inference', account: 'none', voiceAlone: true, takesVoice: false },
  { id: 'soniox', stages: ALL, host: 'soniox', joint: JOINT, account: 'key', voiceAlone: true, takesVoice: true },
  endToEnd('gemini', 'key'),
  endToEnd('volcengine_ast2', 'key'),
  endToEnd('openai', 'key'),
  endToEnd('openai_translate', 'key'),
  endToEnd('openai_live', 'key'),
  endToEnd('qwen_livetranslate', 'key'),
  endToEnd('palabraai', 'key'),
  // The E2E build (`--mode e2e`) runs its sessions on the fake providers, so there a line-up may name them.
  // Elsewhere they stay out: a development build reaches the fake through the stored provider alone.
  // The fake transcribes and translates together and may be read by another voice; the fake voice serves speech
  // alone, beside another provider's transcription and translation. The fake transcriber and the fake translator
  // each serve their one stage, each a host of its own, so a line-up of the three runs every stage apart.
  ...(import.meta.env.MODE === 'e2e'
    ? [
        { id: 'fake', stages: ALL, host: 'fake', joint: JOINT, account: 'none', voiceAlone: false, takesVoice: true } satisfies ProviderCaps,
        endToEnd('fake_leased', 'none'),
        { id: 'fake_voice', stages: ['speech'], host: 'fake_voice', account: 'none', voiceAlone: true, takesVoice: false } satisfies ProviderCaps,
        { id: 'fake_transcriber', stages: ['transcription'], host: 'fake_transcriber', account: 'none', voiceAlone: false, takesVoice: true } satisfies ProviderCaps,
        { id: 'fake_translator', stages: ['translation'], host: 'fake_translator', account: 'none', voiceAlone: false, takesVoice: true } satisfies ProviderCaps,
      ]
    : []),
];

export function caps(id: string, catalog: readonly ProviderCaps[] = CAPS): ProviderCaps | undefined {
  return catalog.find((c) => c.id === id);
}

/**
 * The option a line-up names for a stage, when it is known and serves that stage; undefined otherwise (unset,
 * unknown, or not for that stage). `catalog`: the options read, the app's own by default.
 */
export function optionFor(lineUp: Pick<LineUp, RunStage>, stage: RunStage, catalog: readonly ProviderCaps[] = CAPS): ProviderCaps | undefined {
  const id = lineUp[stage];
  const option = id === null ? undefined : caps(id, catalog);
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

/**
 * Whether more than one host serves these stages: a run on two services. Bing and Edge run on this device's
 * provider, so a run on it with them is on one host; an id the catalog does not know is a host of its own.
 */
export function severalHosts(stages: StageIds): boolean {
  return new Set(RUN_STAGES.map((stage) => caps(stages[stage])?.host ?? stages[stage])).size > 1;
}

/** One provider's id on every run stage. */
export function allStagesBy(id: string): StageIds {
  return { transcription: id, translation: id, speech: id };
}

/**
 * The ids that serve the stages of a run: the stored line-up's, which is what runs; while none is stored, the id
 * of the provider that runs meanwhile (`providerId`) on every stage: a line-up that is only shown names nothing
 * about the run.
 */
export function stageIdsFor(lineUp: Pick<LineUp, RunStage> | null, stored: boolean, providerId: string): StageIds {
  if (!stored || lineUp === null) return allStagesBy(providerId);
  const { transcription, translation, speech } = lineUp;
  // A stored line-up that runs names every stage; one that leaves a stage out does not start.
  if (transcription === null || translation === null || speech === null) return allStagesBy(providerId);
  return { transcription, translation, speech };
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
