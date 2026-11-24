/**
 * Local Native's voice as a unit that only speaks: a speech model in the local engine reading another provider's
 * translations. Its config names the leg's voice, or says the leg is silent; its session is `speechSession.ts`.
 *
 * It declares no `speaks` (#578 ruling 19): which languages it speaks is the engine's runtime catalog, so a target no
 * voice speaks is built silent and said when the session opens.
 */
import type { LegName } from '../../lib/conversation/types';
import { voiceCapability } from '../../lib/local-inference/native/nativeCatalog';
import { SP } from '../../lib/lineup/types';
import { sameStages } from '../../lib/plan/types';
import type { ProviderRefusal, UnitDefinition } from '../../lib/run/types';
import type { LocalNativeCredentials } from './adapter';
import { nativeModelsOf, oneSideAtATime } from './config';
import { nativeEngines, type LocalNativeEngines } from './engines';
import type { LocalNativeSettings } from './settings';
import { startNativeSpeech, type NativeSpeechConfig } from './speechSession';

export type NativeSpeechUnit = UnitDefinition<LocalNativeSettings, LocalNativeCredentials, NativeSpeechConfig>;

/** Local Native's speech unit: speech, and only when asked for exactly that. */
export function createNativeSpeechUnit(deps: { engines?: Pick<LocalNativeEngines, 'tts'> } = {}): NativeSpeechUnit {
  const engines = deps.engines ?? nativeEngines;
  return {
    id: 'speech',
    occupies: (_s, want) => (sameStages(SP, want) ? SP : null),
    capabilities: () => ({
      speech: 'optional',
      turns: ['auto', 'manual'],
      boundaries: 'silence',
      textInput: false,
      faceToFace: false,
      participantSpeech: true,
    }),
    build: (context, s, shared): NativeSpeechConfig => {
      if (!context.speech) return { off: true };
      const facts = nativeModelsOf(shared);
      const { source, target } = context.direction;
      const tts = facts.resolve(source, target, s.selections).tts;
      if (!tts) return { off: true, unavailable: shared.reversed(context.direction) ? 'participant_tts_missing' : 'speaker_tts_missing' };
      const info = facts.catalog()[tts.modelId];
      return {
        modelId: tts.modelId,
        ...(tts.variant ? { variant: tts.variant } : {}),
        device: s.ttsDevice,
        speed: s.ttsSpeed,
        voice: s.ttsVoice,
        capability: info ? voiceCapability(info) : null,
        host: facts,
      };
    },
    describe: (c) => ('off' in c ? {} : { ttsModel: c.modelId }),
    startSpeech: (request, events) => startNativeSpeech((clock) => engines.tts(clock), request, events),
  };
}

export const nativeSpeechUnit: NativeSpeechUnit = createNativeSpeechUnit();

/** Whether one leg's config is this unit's, told by its shape: a silent leg, or a voice that names no recognition model. */
function isNativeSpeechConfig(config: unknown): config is NativeSpeechConfig {
  if (typeof config !== 'object' || config === null) return false;
  if ((config as { off?: unknown }).off === true) return true;
  return 'speed' in config && 'voice' in config && !('asr' in config);
}

/** Whether the configs a provider's `admit` was handed are this unit's: some leg has one, and every one given is one. */
export function areNativeSpeechConfigs(configs: Partial<Record<LegName, unknown>>): configs is Partial<Record<LegName, NativeSpeechConfig>> {
  const given = Object.values(configs).filter((c) => c !== undefined && c !== null);
  return given.length > 0 && given.every(isNativeSpeechConfig);
}

/** Local Native's voice reads one side at a time (#578 ruling 4). */
export function admitNativeSpeech(configs: Partial<Record<LegName, NativeSpeechConfig>>): true | ProviderRefusal {
  return oneSideAtATime(configs, "Local Native's voice reads one side at a time: choose Me or Other.");
}
