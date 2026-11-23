/**
 * The local provider's voice as a unit that only speaks: a speech model on
 * this machine, reading the translations of whichever unit makes
 * them. Its config is the leg's voice, resolved as the whole local session
 * resolves it; its session is `speechSession.ts`.
 */
import type { LegName } from '../../lib/conversation/types';
import { canonicalTag } from '../../lib/language/code';
import { localSpeechStagesOf } from '../../lib/lineup/localStages';
import { getTtsModelsForLanguage } from '../../lib/local-inference/modelManifest';
import { SP } from '../../lib/lineup/types';
import { sameStages } from '../../lib/plan/types';
import type { ProviderRefusal, UnitDefinition } from '../../lib/run/types';
import type { LocalCredentials } from './adapter';
import { fitsBudget, localModelsOf, localTts, resolveLocal, ttsMissingCode } from './config';
import { defaultEngines, type LocalEngines } from './engines';
import type { LocalInferenceSettings } from './settings';
import { isOff, startLocalSpeech, type LocalSpeechConfig } from '../../lib/local-inference/sessions/speechSession';

export type { LocalSpeechConfig, LocalSpeechOff } from '../../lib/local-inference/sessions/speechSession';

export type LocalSpeechUnit = UnitDefinition<LocalInferenceSettings, LocalCredentials, LocalSpeechConfig>;

export interface LocalSpeechUnitDeps {
  /** Today's `TtsEngine` by default; a fake in tests. */
  engines?: Pick<LocalEngines, 'tts'>;
}

/** A language's base, as the model lists write it ("pt" of "pt-BR"). */
function baseOf(language: string): string {
  try {
    return canonicalTag(language).split('-')[0];
  } catch {
    return language;
  }
}

/**
 * Whether the local provider's voice reads `language`: some speech model on this machine speaks it, downloaded or
 * not (one not downloaded is said when the session starts, and can be downloaded).
 */
export function localSpeaks(language: string): boolean {
  const base = baseOf(language);
  return [language, base].some((code) => getTtsModelsForLanguage(code).some((m) => !m.isCloudModel));
}

/**
 * The local provider's speech unit: speech, and only when asked for exactly that. The model is the direction's
 * local voice model, resolved as the whole local session resolves it. A leg that should speak and has no model for its target is
 * built silent and says so when it opens, as the whole local session does: its subtitles go on.
 */
export function createLocalSpeechUnit(deps: LocalSpeechUnitDeps = {}): LocalSpeechUnit {
  const makeTts = () => (deps.engines ?? defaultEngines).tts();
  return {
    id: 'speech',
    occupies: (_s, want) => (sameStages(SP, want) ? SP : null),
    capabilities: () => ({
      // Whether a leg is read aloud is the user's switch to say, as it is for the local provider as a whole.
      speech: 'optional',
      turns: ['auto', 'manual'],
      turnOwner: 'either',
      boundaries: 'silence',
      textInput: false,
      faceToFace: true,
      participantSpeech: true,
      speaks: localSpeaks,
    }),
    build: (context, s, shared) => {
      if (!context.speech) return { off: true };
      const { tts } = resolveLocal(context.direction, s, localSpeechStagesOf(shared.lineUp ?? null), localModelsOf(shared));
      if (!tts) return { off: true, unavailable: ttsMissingCode(context.direction, shared) };
      return localTts(context.direction, s, tts.modelId);
    },
    describe: (c) => (isOff(c) ? {} : { ttsModel: c.modelId }),
    startSpeech: (request, events) => startLocalSpeech(makeTts, request, events),
  };
}

export const localSpeechUnit: LocalSpeechUnit = createLocalSpeechUnit();

/**
 * Whether one leg's config is this unit's, told by the shape a speech config has: a leg built silent (`off`), or
 * a voice, which names its model and speed at the top and no recognition model. The whole local session's config
 * always names a recognition model (`asr`) and keeps its voice, when it has one, a level down (`tts`), so
 * neither is ever taken for the other.
 */
function isLocalSpeechConfig(config: unknown): config is LocalSpeechConfig {
  if (typeof config !== 'object' || config === null) return false;
  if (isOff(config as LocalSpeechConfig)) return (config as { off: unknown }).off === true;
  return 'modelId' in config && 'speed' in config && !('asr' in config);
}

/**
 * Whether the configs a provider's `admit` was handed are this unit's, not the whole local session's: some leg
 * has one, and every one given is a speech config. The one place that tells the two apart, for `admit` to choose
 * the budget by: the voice's own models, or the whole session's.
 */
export function areLocalSpeechConfigs(configs: Partial<Record<LegName, unknown>>): configs is Partial<Record<LegName, LocalSpeechConfig>> {
  const given = Object.values(configs).filter((c) => c !== undefined && c !== null);
  return given.length > 0 && given.every(isLocalSpeechConfig);
}

/**
 * The memory budget of a run in which the local provider only speaks: the voice models of the legs that speak,
 * and nothing else. Over budget, the start is refused.
 */
export function admitLocalSpeech(configs: Partial<Record<LegName, LocalSpeechConfig>>, deviceFeatures: readonly string[]): true | ProviderRefusal {
  const ids = Object.values(configs).flatMap((c) => (c && !isOff(c) ? [c.modelId] : []));
  if (fitsBudget(ids, deviceFeatures)) return true;
  return { refused: 'The models need more memory than this device has.', code: 'memory_exceeded' };
}
