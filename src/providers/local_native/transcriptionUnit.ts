/**
 * Local Native's recognition as a unit of its own: a recognition model in the engine transcribing what is said, for
 * another provider's unit to translate. It is the whole session's adapter over a config that says so
 * (`transcribesAlone`): no translation engine and no voice load, and only source segments are said, each final
 * stating that all of it is stable.
 *
 * A line-up that is all on Local Native does not come here: the composer takes the whole unit wherever it transcribes
 * and translates (fewest units first).
 */
import { AdapterStartError, type Adapter } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import { TR } from '../../lib/lineup/types';
import { sameStages } from '../../lib/plan/types';
import type { ProviderRefusal, UnitDefinition } from '../../lib/run/types';
import { createLocalNativeAdapter, type LocalNativeCredentials } from './adapter';
import { nativeModelsOf, noAsr, oneSideAtATime, type LocalNativeConfig } from './config';
import { nativeEngines, type LocalNativeEngines } from './engines';
import type { LocalNativeSettings } from './settings';

/** The id of the unit that transcribes alone. */
export const NATIVE_TRANSCRIPTION_UNIT = 'transcription';

export type NativeTranscriptionUnit = UnitDefinition<LocalNativeSettings, LocalNativeCredentials, LocalNativeConfig>;

/** One leg's config: the recognition model its direction resolves to, with no translation model and no voice (both are other units'). */
export function buildNativeTranscription(
  context: Parameters<NativeTranscriptionUnit['build']>[0],
  s: LocalNativeSettings,
  shared: Parameters<NativeTranscriptionUnit['build']>[2],
): LocalNativeConfig | ProviderRefusal {
  const facts = nativeModelsOf(shared);
  const { source, target } = context.direction;
  const resolved = facts.resolve(source, target, s.selections);
  if (!resolved.asr) return noAsr(source);
  return {
    asr: { modelId: resolved.asr.modelId, ...(resolved.asr.variant ? { variant: resolved.asr.variant } : {}), device: s.asrDevice },
    vad: { threshold: s.vadThreshold, minSilenceDuration: s.vadMinSilenceDuration, minSpeechDuration: s.vadMinSpeechDuration },
    translation: null,
    asrFirst: true,
    transcribesAlone: true,
    host: facts,
  };
}

/** Why a config cannot run in this unit: it would translate or speak, which are the leg's other units' to do, or it was not built to transcribe alone. */
function refusalOf(config: LocalNativeConfig): string | null {
  if (config.translation || config.tts || !config.transcribesAlone) return 'This unit transcribes alone: its config may neither translate nor speak.';
  return null;
}

/**
 * Local Native's recognition unit: transcription, and only when asked for exactly that. The whole session's adapter
 * runs it, so its recognizer, its VAD, a manual turn's flush and its hardware probe are the whole session's. Typed
 * text is shown as a source, and the unit that translates translates it.
 */
export function createNativeTranscriptionUnit(deps: { engines?: LocalNativeEngines } = {}): NativeTranscriptionUnit {
  const adapter: Adapter<LocalNativeConfig, LocalNativeCredentials> = createLocalNativeAdapter(deps.engines ?? nativeEngines);
  return {
    id: NATIVE_TRANSCRIPTION_UNIT,
    occupies: (_s, want) => (sameStages(TR, want) ? TR : null),
    capabilities: () => ({
      speech: 'never',
      turns: ['auto', 'manual'],
      boundaries: 'provider',
      textInput: true,
      faceToFace: false,
      participantSpeech: true,
    }),
    build: buildNativeTranscription,
    describe: (c) => ({ asrModel: c.asr.modelId }),
    // Refused before any seam is made: a translation segment from here would be a second translation of a row.
    start: (request, events) => {
      const refusal = refusalOf(request.config);
      if (refusal) return Promise.reject(new AdapterStartError(refusal, 'build_refused'));
      return adapter.start(request, events);
    },
  };
}

export const nativeTranscriptionUnit: NativeTranscriptionUnit = createNativeTranscriptionUnit();

/** Whether one leg's config is this unit's, told by its shape: it names a recognition model and says it transcribes alone. */
function isNativeTranscriptionConfig(config: unknown): config is LocalNativeConfig {
  return typeof config === 'object' && config !== null && 'asr' in config && (config as LocalNativeConfig).transcribesAlone === true;
}

/** Whether the configs a provider's `admit` was handed are this unit's: some leg has one, and every one given is one. */
export function areNativeTranscriptionConfigs(configs: Partial<Record<LegName, unknown>>): configs is Partial<Record<LegName, LocalNativeConfig>> {
  const given = Object.values(configs).filter((c) => c !== undefined && c !== null);
  return given.length > 0 && given.every(isNativeTranscriptionConfig);
}

/** Local Native transcribes one side at a time (#578 ruling 4). */
export function admitNativeTranscription(configs: Partial<Record<LegName, LocalNativeConfig>>): true | ProviderRefusal {
  return oneSideAtATime(configs, 'Local Native transcribes one side at a time: choose Me or Other.');
}
