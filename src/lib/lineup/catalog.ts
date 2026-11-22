// src/lib/lineup/catalog.ts
//
// What each option can serve, who runs it and which stages go together, the
// line-up each host runs by default, the one host a line-up runs on by this
// data alone, and the ids that served a run's stages. Pure functions over the
// registered catalog; the stores read it, nothing here reads a store.
//
// Where the catalog comes from: it is read off the providers' units
// (`catalogOf`, `src/lib/plan/capsOf.ts`), and the provider registry registers it as it loads,
// from the providers a line-up may name. This module imports neither the
// registry nor a provider: the line-up store reads it, and the registry's own
// imports reach that store (the local provider reads it), so importing either
// from here would close a cycle. A test that keeps the registry out registers a
// catalog itself (`registerReleasedCatalog`, catalog.testing.ts).
import { RUN_STAGES, TR_TL } from './types';
import type { LineUp, ProviderCaps, RunStage, StageIds } from './types';

let registered: readonly ProviderCaps[] | null = null;

/** Called once by the registry with the catalog its providers declare; a test registers its own. */
export function registerCatalog(entries: readonly ProviderCaps[]): void {
  registered = entries;
}

/**
 * The catalog every reader asks: what each option can serve, read when asked. Throws while none is registered: an
 * empty catalog would turn every stored line-up away.
 */
export function allCaps(): readonly ProviderCaps[] {
  if (!registered) throw new Error('No line-up catalog is registered: load the provider registry (or, in a test, register one) first.');
  return registered;
}

export function caps(id: string, catalog: readonly ProviderCaps[] = allCaps()): ProviderCaps | undefined {
  return catalog.find((c) => c.id === id);
}

/**
 * Whether a provider may be the one a stored selection runs while no line-up is stored: one whose option serves every
 * stage by itself, or one the catalog does not know (a development build's fake). A text model only translates
 * another provider's transcription, so a stored selection of its id (the retired OpenAI Compatible's) does not run.
 */
export function runsByItself(id: string, catalog: readonly ProviderCaps[] = allCaps()): boolean {
  const own = caps(id, catalog);
  return own === undefined || own.stages.length === RUN_STAGES.length;
}

/**
 * The option a line-up names for a stage, when it is known and serves that stage; undefined otherwise (unset,
 * unknown, or not for that stage). `catalog`: the options read, the app's own by default.
 */
export function optionFor(lineUp: Pick<LineUp, RunStage>, stage: RunStage, catalog: readonly ProviderCaps[] = allCaps()): ProviderCaps | undefined {
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
 * Whether more than one host serves these stages: a run on two services. Every option is a host of its own, so
 * this device with Bing and Edge is a run on three; an id the catalog does not know is a host of its own.
 */
export function severalHosts(stages: StageIds): boolean {
  return new Set(RUN_STAGES.map((stage) => caps(stages[stage])?.host ?? stages[stage])).size > 1;
}

/**
 * Whether these stages are a provider's own line-up: each names an option that serves it, and that option's host is
 * the provider; for `local_inference` alone it is also Bing or Edge (its free line-up: this device with Bing and
 * Edge). For any other provider, the provider alone.
 */
export function belongsTo(stages: Pick<LineUp, RunStage>, provider: string): boolean {
  const hosts = new Set<string>(provider === 'local_inference' ? RUN_STAGES.map((stage) => caps(hostDefaults(provider)[stage]!)?.host ?? provider) : [provider]);
  return RUN_STAGES.every((stage) => {
    const option = optionFor(stages, stage);
    return option !== undefined && hosts.has(option.host);
  });
}

/** One provider's id on every run stage. */
export function allStagesBy(id: string): StageIds {
  return { transcription: id, translation: id, speech: id };
}

/**
 * The ids that serve the stages of a run: the line-up's when it is the one that runs (`stored`, as the line-up
 * store's `lineUpThatRuns` says: the stored one, or, before one is stored, the one shown where this device runs);
 * otherwise the id of the provider that runs meanwhile (`providerId`) on every stage: a line-up only shown beside
 * another provider names nothing about the run.
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
export function hostDefaults(host: string, catalog: readonly ProviderCaps[] = allCaps()): Pick<LineUp, RunStage> {
  if (host === 'local_inference') return ON_THIS_DEVICE;
  const own = caps(host, catalog);
  if (!own || own.host !== host || own.stages.length === RUN_STAGES.length) return { transcription: host, translation: host, speech: host };
  return { transcription: own.stages.includes('transcription') ? host : ON_THIS_DEVICE.transcription, translation: own.stages.includes('translation') ? host : ON_THIS_DEVICE.translation, speech: own.stages.includes('speech') ? host : ON_THIS_DEVICE.speech };
}

/** Today's default for a new user: Kizuna AI where the build offers it, otherwise the free set. */
export function defaultLineUp(o: { managedOffered: boolean }): LineUp {
  return { ...hostDefaults(o.managedOffered ? 'kizunaai_soniox' : 'local_inference'), summarisation: null };
}
