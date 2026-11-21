/**
 * The local provider's voice as a unit that only speaks: Edge, or a speech
 * model on this machine, reading the translations of whichever unit makes
 * them. Its config is the leg's voice, resolved as the whole local session
 * resolves it; its session is `speechSession.ts`.
 */
import type { LegName } from '../../lib/conversation/types';
import { localSpeechStagesOf } from '../../lib/lineup/localStages';
import { SP } from '../../lib/lineup/types';
import { sameStages, type UnitDefinition } from '../../lib/plan/types';
import type { ProviderRefusal } from '../../lib/provider/types';
import { storedLocalStages } from '../../stores/lineUpStore';
import type { LocalCredentials } from './adapter';
import { fitsBudget, localTts, resolveLocal, ttsMissingCode } from './config';
import { defaultEngines, type LocalEngines } from './engines';
import type { LocalInferenceSettings } from './settings';
import { isOff, startLocalSpeech, type LocalSpeechConfig } from './speechSession';

export type { LocalSpeechConfig } from './speechSession';

export type LocalSpeechUnit = UnitDefinition<LocalInferenceSettings, LocalCredentials, LocalSpeechConfig>;

export interface LocalSpeechUnitDeps {
  /** Today's `TtsEngine` by default; a fake in tests. */
  engines?: Pick<LocalEngines, 'tts'>;
}

/**
 * The local provider's speech unit: speech, and only when asked for exactly that. The model is Edge's when the
 * line-up gives speech to Edge, else the direction's local voice model; with no line-up handed over, what the
 * whole local session resolves for the direction. A leg that should speak and has no model for its target is
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
    }),
    build: (context, s, shared) => {
      if (!context.speech) return { off: true };
      const stages = shared.lineUp ? localSpeechStagesOf(shared.lineUp) : storedLocalStages();
      const { tts } = resolveLocal(context.direction, s, stages);
      if (!tts) return { off: true, unavailable: ttsMissingCode(context.direction, shared) };
      return localTts(context.direction, s, tts.modelId);
    },
    describe: (c) => (isOff(c) ? {} : { ttsModel: c.modelId }),
    startSpeech: (request, events) => startLocalSpeech(makeTts, request, events),
  };
}

export const localSpeechUnit: LocalSpeechUnit = createLocalSpeechUnit();

/** Whether the configs a provider's `admit` was handed are this unit's: some leg has one, and none names a recognition model. */
export function areLocalSpeechConfigs(configs: Partial<Record<LegName, unknown>>): configs is Partial<Record<LegName, LocalSpeechConfig>> {
  const given = Object.values(configs).filter((c) => c !== undefined && c !== null);
  return given.length > 0 && given.every((c) => typeof c === 'object' && !('asr' in (c as object)));
}

/**
 * The memory budget of a run in which the local provider only speaks: the voice models of the legs that speak,
 * and nothing else (Edge takes none). Over budget, the start is refused.
 */
export function admitLocalSpeech(configs: Partial<Record<LegName, LocalSpeechConfig>>): true | ProviderRefusal {
  const ids = Object.values(configs).flatMap((c) => (c && !isOff(c) ? [c.modelId] : []));
  if (fitsBudget(ids)) return true;
  return { refused: 'The models need more memory than this device has.', code: 'memory_exceeded' };
}
