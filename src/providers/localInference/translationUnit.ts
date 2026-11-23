/**
 * The local provider's translation as a unit that only translates: a
 * translation model on this machine, translating what another provider's
 * unit heard. Its config names the model for the leg's direction
 * and what that model is told; its session is `translationSession.ts`.
 *
 * A line-up that is all on this device does not come here: it runs the whole
 * local session, as before.
 */
import type { LegName } from '../../lib/conversation/types';
import { AUTO, canonicalTag } from '../../lib/language/code';
import { localTranslationStagesOf, type LocalStages } from '../../lib/lineup/localStages';
import { TL } from '../../lib/lineup/types';
import { getManifestByType, getManifestEntry, isTranslationModelCompatible, type ModelManifestEntry } from '../../lib/local-inference/modelManifest';
import { sameStages } from '../../lib/plan/types';
import type { ProviderRefusal, SharedSettings, UnitDefinition } from '../../lib/run/types';
import type { LocalCredentials } from './adapter';
import { LOCAL_MODELS_MISSING } from './check';
import { fitsBudget, localModelsOf, localTranslationPrompt, resolveLocal } from './config';
import { defaultEngines, type LocalEngines } from './engines';
import type { LocalInferenceSettings } from './settings';
import { localTranslationRefusal, startLocalTranslation, type LocalTranslationConfig } from '../../lib/local-inference/sessions/translationSession';

export type { LocalTranslationConfig } from '../../lib/local-inference/sessions/translationSession';

export type LocalTranslationUnit = UnitDefinition<LocalInferenceSettings, LocalCredentials, LocalTranslationConfig>;

export interface LocalTranslationUnitDeps {
  /** Today's `TranslationEngine` by default; a fake in tests. */
  engines?: Pick<LocalEngines, 'translation'>;
}

/** The translation models of this machine: every one of the catalog, downloaded or not. */
function localModels(): ModelManifestEntry[] {
  return getManifestByType('translation').filter((m) => !m.isCloudModel);
}

/**
 * Whether this machine's models translate from `source` into `target` (app codes): some model of the catalog takes
 * the pair, downloaded or not (one not downloaded is a matter of readiness, and can be downloaded). A source that
 * is not known yet (`auto`) is never translated: every engine here is loaded for one fixed pair. A code is read as
 * it is written: a regional code a model does not name is not folded onto its base language.
 */
export function localTranslates(source: string, target: string): boolean {
  if (source === AUTO || target === AUTO || source === target) return false;
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
 * The languages some model of this machine names (app codes). A model that takes any language names none, so this
 * is not all the local models translate: hand the lists below the languages in question (`among`) to have each
 * one asked about.
 */
export function localTranslationLanguages(): string[] {
  return appCodes(localModels().flatMap((m) => [...m.languages, ...(m.sourceLang ? [m.sourceLang] : []), ...(m.targetLang ? [m.targetLang] : [])]));
}

/** The targets this machine's models translate `source` into, among `among` (their own languages by default). */
export function localTranslationTargets(source: string, among: readonly string[] = localTranslationLanguages()): string[] {
  return among.filter((target) => localTranslates(source, target));
}

/** The sources this machine's models translate into `target`, among `among` (their own languages by default). */
export function localTranslationSources(target: string, among: readonly string[] = localTranslationLanguages()): string[] {
  return among.filter((source) => localTranslates(source, target));
}

/**
 * Which stages a build resolves under: from the line-up a run froze at its start when it hands one over; with none,
 * translation on this machine alone. Never null: a null reaches model resolution with Bing and Edge among the choices.
 */
function translationStagesFor(shared: Pick<SharedSettings, 'lineUp'>): LocalStages {
  return localTranslationStagesOf(shared.lineUp ?? null);
}

/**
 * The local provider's translation unit: translation, and only when asked for exactly that. The engine is the
 * model chosen for the direction among this machine's models; a pair none translates is refused. A local model
 * gets the prompt the whole local session gives it, word list and all.
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
      translates: localTranslates,
    }),
    build: (context, s, shared): LocalTranslationConfig | ProviderRefusal => {
      const { source, target } = context.direction;
      const stages = translationStagesFor(shared);
      const refused = (modelId: string): ProviderRefusal | null => {
        const refusal = localTranslationRefusal(modelId, source, target);
        return refusal === null ? null : { refused: refusal };
      };
      const unknown = refused('');
      if (unknown) return unknown;
      // Resolved as the whole local session resolves it, with no recognition model: a model that is chosen and
      // not downloaded does not resolve, and one that only translates speech itself is no translator of text.
      const modelId = resolveLocal(context.direction, s, stages, localModelsOf(shared)).translation?.modelId;
      if (!modelId || getManifestEntry(modelId)?.type !== 'translation') {
        return { refused: `No translation model for ${source} → ${target}.`, code: LOCAL_MODELS_MISSING };
      }
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
 * and no recognition model. Over budget, the start is refused.
 */
export function admitLocalTranslation(configs: Partial<Record<LegName, LocalTranslationConfig>>, deviceFeatures: readonly string[]): true | ProviderRefusal {
  const ids = Object.values(configs).flatMap((c) => (c ? [c.modelId] : []));
  if (fitsBudget(ids, deviceFeatures)) return true;
  return { refused: 'The models need more memory than this device has.', code: 'memory_exceeded' };
}
