// src/lib/lineup/catalog.ts
//
// What each option can serve, who runs it and which stages go together, the
// line-up each host runs by default, the one host a line-up runs on by this
// data alone, and the ids that served a run's stages. Pure data and pure
// functions; the stores read it, nothing here reads a store.
import { RUN_STAGES, TR_TL } from './types';
import type { LineUp, ProviderCaps, RunStage, StageIds } from './types';

const ALL: readonly RunStage[] = RUN_STAGES;
const JOINT: readonly RunStage[] = TR_TL;

/**
 * One provider that does every stage over one connection (an end-to-end service), run by itself. Its voice reads
 * only its own translation, and its translation is read only by its own voice: it is not known, per vendor, to stop
 * making and charging for audio when asked for text alone.
 */
const endToEnd = (id: string, account: ProviderCaps['account']): ProviderCaps => ({ id, stages: ALL, host: id, joint: ALL, account, voiceAlone: false, takesVoice: false });

export const CAPS: readonly ProviderCaps[] = [
  // Its text may be read by another voice (a text-only session of it), and its voice may read another provider's
  // text (a session of it that holds speech keys only). It translates only what it transcribes, and may transcribe
  // alone for another option to translate (Soniox's connection asked for no translation); so does Soniox below.
  { id: 'kizunaai_soniox', stages: ALL, host: 'kizunaai_soniox', translatesOwn: true, account: 'kizuna', voiceAlone: true, takesVoice: true },
  endToEnd('kizunaai_qwen', 'kizuna'),
  { id: 'local_inference', stages: ALL, host: 'local_inference', account: 'none', voiceAlone: true, takesVoice: true },
  { id: 'bing', stages: ['translation'], host: 'local_inference', account: 'none', voiceAlone: false, takesVoice: true },
  { id: 'edge', stages: ['speech'], host: 'local_inference', account: 'none', voiceAlone: true, takesVoice: false },
  { id: 'soniox', stages: ALL, host: 'soniox', translatesOwn: true, account: 'key', voiceAlone: true, takesVoice: true },
  endToEnd('gemini', 'key'),
  endToEnd('volcengine_ast2', 'key'),
  endToEnd('openai', 'key'),
  endToEnd('openai_translate', 'key'),
  endToEnd('openai_live', 'key'),
  endToEnd('qwen_livetranslate', 'key'),
  endToEnd('palabraai', 'key'),
  // A text model translates what another option transcribed (spec 2026-11-22 §5): translation alone, on the user's
  // own key (the compatible service's address and optional key), and any voice that stands alone may read it. Its
  // provider is offered in the desktop app only, so elsewhere the line-up page lists it nowhere and a stored line-up
  // that names it is not offered.
  { id: 'openai_text', stages: ['translation'], host: 'openai_text', account: 'key', voiceAlone: false, takesVoice: true },
  { id: 'gemini_text', stages: ['translation'], host: 'gemini_text', account: 'key', voiceAlone: false, takesVoice: true },
  { id: 'openai_compatible', stages: ['translation'], host: 'openai_compatible', account: 'key', voiceAlone: false, takesVoice: true },
  // The E2E build (`--mode e2e`) runs its sessions on the fake providers, so there a line-up may name them.
  // Elsewhere they stay out: a development build reaches the fake through the stored provider alone.
  // The fake transcribes and translates together, never apart (it has no unit that transcribes alone, so its two
  // stages stay a joint group), and may be read by another voice; the fake voice serves speech
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
 * Whether a provider may be the one a stored selection runs while no line-up is stored: one whose option serves every
 * stage by itself, or one the catalog does not know (a development build's fake). A text model only translates
 * another provider's transcription, so a stored selection of its id (the retired OpenAI Compatible's) does not run.
 */
export function runsByItself(id: string, catalog: readonly ProviderCaps[] = CAPS): boolean {
  const own = caps(id, catalog);
  return own === undefined || own.stages.length === RUN_STAGES.length;
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
 * The stages an option must serve itself when it serves `stage`: its joint group when the stage is in it; its
 * transcription with its translation when it translates only what it transcribes (not the other way round: its
 * transcription stands alone); otherwise the stage alone.
 */
export function goesWith(option: Pick<ProviderCaps, 'joint' | 'translatesOwn'>, stage: RunStage): readonly RunStage[] {
  if (option.joint?.includes(stage)) return option.joint;
  if (option.translatesOwn && stage === 'translation') return TR_TL;
  return [stage];
}

/**
 * The stages one connection of an option carries when the line-up gives it all of them: its joint group, or its
 * transcription and translation when it translates only what it transcribes. Undefined: each stage on its own.
 */
export function carriedTogether(option: Pick<ProviderCaps, 'joint' | 'translatesOwn'>): readonly RunStage[] | undefined {
  return option.joint ?? (option.translatesOwn ? TR_TL : undefined);
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

/** This device's line-up: its recognition, Bing's translation and Edge's voice, free and with no account. */
const ON_THIS_DEVICE: Pick<LineUp, RunStage> = { transcription: 'local_inference', translation: 'bing', speech: 'edge' };

/**
 * The line-up a host runs when nothing finer is chosen. A host that serves only some stages (a text model, which only
 * translates) has no default of its own for the others: they are this device's, which needs no key and no
 * sign-in, so choosing such a host where another provider must give up its stages leaves a line-up that runs.
 */
export function hostDefaults(host: string, catalog: readonly ProviderCaps[] = CAPS): Pick<LineUp, RunStage> {
  if (host === 'local_inference') return ON_THIS_DEVICE;
  const own = caps(host, catalog);
  if (!own || own.host !== host || own.stages.length === RUN_STAGES.length) return { transcription: host, translation: host, speech: host };
  return { transcription: own.stages.includes('transcription') ? host : ON_THIS_DEVICE.transcription, translation: own.stages.includes('translation') ? host : ON_THIS_DEVICE.translation, speech: own.stages.includes('speech') ? host : ON_THIS_DEVICE.speech };
}

/** Today's default for a new user: Kizuna AI where the build offers it, otherwise the free set. */
export function defaultLineUp(o: { managedOffered: boolean }): LineUp {
  return { ...hostDefaults(o.managedOffered ? 'kizunaai_soniox' : 'local_inference'), summarisation: null };
}
