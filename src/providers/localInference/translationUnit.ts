/**
 * The local provider's translation as a unit that only translates: a
 * translation model on this machine, or Bing, translating what another
 * provider's unit heard. Its config names the model for the leg's direction
 * and what that model is told; its session is `translationSession.ts`.
 *
 * A line-up that is all on this device does not come here: it runs the whole
 * local session, as before.
 */
import { BING_SUPPORTED_LANGUAGES, isSupportedByBing, mapToBingCode } from '../../lib/bing-translator/languageMap';
import type { LegName } from '../../lib/conversation/types';
import { AUTO, canonicalTag } from '../../lib/language/code';
import { localTranslationStagesOf, type LocalStages } from '../../lib/lineup/localStages';
import { TL } from '../../lib/lineup/types';
import { getManifestByType, getManifestEntry, isTranslationModelCompatible, type ModelManifestEntry } from '../../lib/local-inference/modelManifest';
import { sameStages, type UnitDefinition } from '../../lib/plan/types';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { storedLocalStages } from '../../stores/lineUpStore';
import type { LocalCredentials } from './adapter';
import { LOCAL_MODELS_MISSING } from './check';
import { fitsBudget, localTranslationPrompt, resolveLocal } from './config';
import { defaultEngines, type LocalEngines } from './engines';
import type { LocalInferenceSettings } from './settings';
import { BING_TRANSLATOR, localTranslationRefusal, startLocalTranslation, type LocalTranslationConfig } from './translationSession';

export { BING_TRANSLATOR } from './translationSession';
export type { LocalTranslationConfig } from './translationSession';

export type LocalTranslationUnit = UnitDefinition<LocalInferenceSettings, LocalCredentials, LocalTranslationConfig>;

export interface LocalTranslationUnitDeps {
  /** Today's `TranslationEngine` by default; a fake in tests. */
  engines?: Pick<LocalEngines, 'translation'>;
}

/** The line-up's two options whose translation runs here: Bing, or a translation model on this machine. */
export type LocalTranslationOption = 'bing' | 'local_inference';

/** The translation models of this machine: every one of the catalog, downloaded or not; never Bing. */
function localModels(): ModelManifestEntry[] {
  return getManifestByType('translation').filter((m) => !m.isCloudModel);
}

/** Two codes Bing reads as one language (`no` and `nb`, `zh` and `zh-CN`). */
function sameForBing(a: string, b: string): boolean {
  try {
    return mapToBingCode(a) === mapToBingCode(b);
  } catch {
    return false;
  }
}

/**
 * Whether a translation option of this device translates from `source` into `target` (app codes). Bing: both are
 * on Bing's own list. This machine's models: some model of the catalog takes the pair, downloaded or not (one not
 * downloaded is a matter of readiness, and can be downloaded). A source that is not known yet (`auto`) is never
 * translated: every engine here is loaded for one fixed pair. A code is read as it is written: a regional code a
 * model does not name is not folded onto its base language.
 */
export function localTranslates(option: LocalTranslationOption, source: string, target: string): boolean {
  if (source === AUTO || target === AUTO || source === target) return false;
  if (option === 'bing') return isSupportedByBing(source) && isSupportedByBing(target) && !sameForBing(source, target);
  return localModels().some((m) => isTranslationModelCompatible(m, source, target));
}

/** A list of codes as app codes, each once; one that is no language tag is left out. */
function appCodes(codes: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const code of codes) {
    try {
      out.add(canonicalTag(code));
    } catch {
      // Not a language tag (a model's "multilingual" marker): no language of its own.
    }
  }
  return [...out];
}

/**
 * The languages a translation option names (app codes): Bing's list, or every language some model of this machine
 * names. A model that takes any language names none, so this is not all the local models translate: hand the
 * lists below the languages in question (`among`) to have each one asked about.
 */
export function localTranslationLanguages(option: LocalTranslationOption): string[] {
  if (option === 'bing') return appCodes(BING_SUPPORTED_LANGUAGES).filter(isSupportedByBing);
  return appCodes(localModels().flatMap((m) => [...m.languages, ...(m.sourceLang ? [m.sourceLang] : []), ...(m.targetLang ? [m.targetLang] : [])]));
}

/** The targets a translation option translates `source` into, among `among` (the option's own languages by default). */
export function localTranslationTargets(option: LocalTranslationOption, source: string, among: readonly string[] = localTranslationLanguages(option)): string[] {
  return among.filter((target) => localTranslates(option, source, target));
}

/** The sources a translation option translates into `target`, among `among` (the option's own languages by default). */
export function localTranslationSources(option: LocalTranslationOption, target: string, among: readonly string[] = localTranslationLanguages(option)): string[] {
  return among.filter((source) => localTranslates(option, source, target));
}

/**
 * Whether the unit translates a pair under a stored line-up's local stages: Bing's pairs where the line-up gives
 * translation to Bing, else this machine's models'. With no line-up stored, either.
 */
export function localUnitTranslates(source: string, target: string, stages: LocalStages | null): boolean {
  if (stages?.translation === 'bing') return localTranslates('bing', source, target);
  if (stages === null) return localTranslates('bing', source, target) || localTranslates('local_inference', source, target);
  return localTranslates('local_inference', source, target);
}

/**
 * Which of Bing and this machine's models translates, for a build: from the line-up a run froze at its start when
 * it hands one over, else from the stored line-up where that gives translation to this device. Null: no line-up
 * says, and the direction resolves as the local provider does without one, Bing among its choices.
 */
function translationStagesFor(shared: Pick<SharedSettings, 'lineUp'>): LocalStages | null {
  if (shared.lineUp) return localTranslationStagesOf(shared.lineUp);
  const stored = storedLocalStages();
  return stored && stored.translation !== null ? { ...stored, transcription: null } : null;
}

const bingConfig = (): LocalTranslationConfig => ({ modelId: BING_TRANSLATOR, instructions: '', wrapTranscript: false });

/**
 * The local provider's translation unit: translation, and only when asked for exactly that. The line-up's
 * translation option says which engine: `bing` is Bing and nothing else, `local_inference` is the model chosen
 * for the direction among this machine's models and never Bing. Neither stands in for the other: a pair the
 * chosen one does not translate is refused. A local model gets the prompt the whole local session gives it, word
 * list and all; Bing is told nothing.
 */
export function createLocalTranslationUnit(deps: LocalTranslationUnitDeps = {}): LocalTranslationUnit {
  const makeEngine = () => (deps.engines ?? defaultEngines).translation();
  return {
    id: 'translation',
    occupies: (_s, want) => (sameStages(TL, want) ? TL : null),
    capabilities: () => ({
      speech: 'never',
      turns: ['auto', 'manual'],
      turnOwner: 'either',
      boundaries: 'provider',
      textInput: false,
      // One direction per session: a connection that carries both directions has no translator here.
      faceToFace: false,
      participantSpeech: true,
      translates: (source, target) => localUnitTranslates(source, target, storedLocalStages()),
    }),
    build: (context, s, shared): LocalTranslationConfig | ProviderRefusal => {
      const { source, target } = context.direction;
      const stages = translationStagesFor(shared);
      const refused = (modelId: string): ProviderRefusal | null => {
        const refusal = localTranslationRefusal(modelId, source, target);
        return refusal === null ? null : { refused: refusal };
      };
      if (stages?.translation === 'bing') return refused(BING_TRANSLATOR) ?? bingConfig();
      const unknown = refused('');
      if (unknown) return unknown;
      // Resolved as the whole local session resolves it, with no recognition model: a model that is chosen and
      // not downloaded does not resolve, and one that only translates speech itself is no translator of text.
      const modelId = resolveLocal(context.direction, s, stages).translation?.modelId;
      if (!modelId || getManifestEntry(modelId)?.type !== 'translation') {
        return { refused: `No translation model for ${source} → ${target}.`, code: LOCAL_MODELS_MISSING };
      }
      if (modelId === BING_TRANSLATOR) return refused(BING_TRANSLATOR) ?? bingConfig();
      return { modelId, ...localTranslationPrompt(context, s, shared) };
    },
    describe: (c) => ({ translationModel: c.modelId }),
    startTranslation: (request, events) => startLocalTranslation(makeEngine, request, events),
  };
}

export const localTranslationUnit: LocalTranslationUnit = createLocalTranslationUnit();

/**
 * Whether one leg's config is this unit's, told by its shape: a model and what it is told, at the top. The whole
 * local session's config names a recognition model (`asr`), and the voice's names a speed and no instructions, so
 * none is ever taken for another.
 */
function isLocalTranslationConfig(config: unknown): config is LocalTranslationConfig {
  return typeof config === 'object' && config !== null && 'modelId' in config && 'instructions' in config && !('asr' in config);
}

/** Whether the configs a provider's `admit` was handed are this unit's: some leg has one, and every one given is one. */
export function areLocalTranslationConfigs(configs: Partial<Record<LegName, unknown>>): configs is Partial<Record<LegName, LocalTranslationConfig>> {
  const given = Object.values(configs).filter((c) => c !== undefined && c !== null);
  return given.length > 0 && given.every(isLocalTranslationConfig);
}

/**
 * The memory budget of a run in which the local provider only translates: the translation models of its legs,
 * and no recognition model (Bing takes none). Over budget, the start is refused.
 */
export function admitLocalTranslation(configs: Partial<Record<LegName, LocalTranslationConfig>>): true | ProviderRefusal {
  const ids = Object.values(configs).flatMap((c) => (c && c.modelId !== BING_TRANSLATOR ? [c.modelId] : []));
  if (fitsBudget(ids)) return true;
  return { refused: 'The models need more memory than this device has.', code: 'memory_exceeded' };
}
