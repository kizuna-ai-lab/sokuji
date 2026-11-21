/**
 * The local provider's recognition as a unit of its own: a recognition model
 * on this machine transcribing what is said, for another provider's unit to
 * translate. It is the whole local session's adapter over a config that says
 * so (`transcribesAlone`): no translation engine and no voice load, and only
 * source segments are said, each final stating that all of it is stable.
 *
 * A line-up that is all on this device does not come here: the composer takes
 * the whole unit wherever this device transcribes and translates (fewest
 * units first), so its session and its timing are what they were.
 */
import { AdapterStartError, type Adapter } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import { localTranscriptionStagesOf } from '../../lib/lineup/localStages';
import { TR } from '../../lib/lineup/types';
import { sameStages, type UnitDefinition } from '../../lib/plan/types';
import type { ProviderRefusal } from '../../lib/provider/types';
import { createLocalInferenceAdapter, type LocalCredentials } from './adapter';
import { fitsBudget, localRecognition, noAsr, resolveLocal, type LocalInferenceConfig } from './config';
import { defaultEngines, type LocalEngines } from './engines';
import type { LocalInferenceSettings } from './settings';

/** The id of the unit that transcribes alone. */
export const LOCAL_TRANSCRIPTION_UNIT = 'transcription';

export type LocalTranscriptionUnit = UnitDefinition<LocalInferenceSettings, LocalCredentials, LocalInferenceConfig>;

export interface LocalTranscriptionUnitDeps {
  /** Today's engine classes by default; fakes in tests. Only the recognizer and Smart Turn are asked for. */
  engines?: LocalEngines;
}

/**
 * One leg's config: the recognition model its direction resolves to, with no translation model and no voice (both
 * are other units'), and the VAD and Smart Turn the whole session would give it. Nothing is translated, so a model
 * that can translate speech itself (Granite Speech) only transcribes here: the stage that would ask it to translate
 * does not resolve on this device. A direction with no recognition model is refused as the whole session refuses it.
 */
export function buildLocalTranscription(
  context: Parameters<LocalTranscriptionUnit['build']>[0],
  s: LocalInferenceSettings,
  shared: Parameters<LocalTranscriptionUnit['build']>[2],
): LocalInferenceConfig | ProviderRefusal {
  const resolved = resolveLocal(context.direction, s, localTranscriptionStagesOf(shared.lineUp ?? null));
  if (!resolved.asr) return noAsr(context.direction.source);
  return { ...localRecognition(s, resolved.asr.modelId), translation: { kind: 'none' }, transcribesAlone: true };
}

/**
 * Why a config cannot run in this unit: it would translate (an engine, or speech translation) or speak, which are
 * the leg's other units' to do, or it was not built to transcribe alone. Null: it can.
 */
function refusalOf(config: LocalInferenceConfig): string | null {
  if (config.translation.kind === 'ast') return 'A recognition model that translates speech gives no source for another unit to translate.';
  if (config.translation.kind !== 'none' || config.tts || !config.transcribesAlone) return 'This unit transcribes alone: its config may neither translate nor speak.';
  return null;
}

/**
 * The local provider's recognition unit: transcription, and only when asked for exactly that. The whole session's
 * adapter runs it, so its recognizer, its VAD, Smart Turn under automatic turns, a manual turn's flush and the times
 * its words were heard are the whole session's. Typed text is its own (R12): it is shown as a source, and the unit
 * that translates translates it.
 */
export function createLocalTranscriptionUnit(deps: LocalTranscriptionUnitDeps = {}): LocalTranscriptionUnit {
  const adapter: Adapter<LocalInferenceConfig, LocalCredentials> = createLocalInferenceAdapter(deps.engines ?? defaultEngines);
  return {
    id: LOCAL_TRANSCRIPTION_UNIT,
    occupies: (_s, want) => (sameStages(TR, want) ? TR : null),
    capabilities: () => ({
      speech: 'never',
      turns: ['auto', 'manual'],
      turnOwner: 'either',
      boundaries: 'provider',
      textInput: true,
      // The whole local session has none either: one connection per leg, and each leg's translation is its own.
      faceToFace: false,
      participantSpeech: true,
    }),
    build: buildLocalTranscription,
    describe: (c) => ({ asrModel: c.asr.modelId }),
    // Refused before any engine is made: a translation segment from here would be a second translation of a row.
    start: (request, events) => {
      const refusal = refusalOf(request.config);
      if (refusal) return Promise.reject(new AdapterStartError(refusal, 'build_refused'));
      return adapter.start(request, events);
    },
  };
}

export const localTranscriptionUnit: LocalTranscriptionUnit = createLocalTranscriptionUnit();

/**
 * Whether one leg's config is this unit's, told by its shape: it names a recognition model (`asr`) and says it
 * transcribes alone. The whole session's names a recognition model and does not say so; the voice's and the
 * translation's name no recognition model; so none is ever taken for another.
 */
function isLocalTranscriptionConfig(config: unknown): config is LocalInferenceConfig {
  return typeof config === 'object' && config !== null && 'asr' in config && (config as LocalInferenceConfig).transcribesAlone === true;
}

/** Whether the configs a provider's `admit` was handed are this unit's: some leg has one, and every one given is one. */
export function areLocalTranscriptionConfigs(configs: Partial<Record<LegName, unknown>>): configs is Partial<Record<LegName, LocalInferenceConfig>> {
  const given = Object.values(configs).filter((c) => c !== undefined && c !== null);
  return given.length > 0 && given.every(isLocalTranscriptionConfig);
}

/**
 * The memory budget of a run in which the local provider only transcribes: the recognition models of its legs, and
 * nothing else. Over budget, the start is refused: no voice of its own can be dropped to make room.
 */
export function admitLocalTranscription(configs: Partial<Record<LegName, LocalInferenceConfig>>): true | ProviderRefusal {
  const ids = Object.values(configs).flatMap((c) => (c ? [c.asr.modelId] : []));
  if (fitsBudget(ids)) return true;
  return { refused: 'The models need more memory than this device has.', code: 'memory_exceeded' };
}
