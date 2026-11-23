/**
 * Edge's voice as a unit that only speaks: Microsoft's online text-to-speech reads the translations of whichever
 * unit makes them. The session is the shared engine-backed one (`startLocalSpeech`); this file is its definition:
 * what it declares, which languages it speaks, and the config it builds (the Edge model, the direction's voice).
 */
import { edgeVoiceLanguagesFor } from '../../lib/edge-tts/voiceList';
import { SP } from '../../lib/lineup/types';
import { EDGE_TTS_LANGUAGES } from '../../lib/local-inference/languageSupport';
import { TtsEngine } from '../../lib/local-inference/engine/TtsEngine';
import { directionKey } from '../../lib/local-inference/selection/types';
import { isOff, startLocalSpeech, type LocalSpeechConfig } from '../../lib/local-inference/sessions/speechSession';
import { sameStages } from '../../lib/plan/types';
import type { UnitDefinition } from '../../lib/run/types';
import type { EdgeSettings } from './settings';

/** The Edge model the shared engine runs for Edge's voice. */
const EDGE_MODEL_ID = 'edge-tts';

/** Edge has no credentials. */
export type EdgeCredentials = Record<string, never>;

/**
 * Whether Edge has voices for `language`: exactly when its settings card offers one, by the card's own rules
 * (Cantonese in Hong Kong's voices, Norwegian in Bokmål's), asked of Edge's static language list.
 */
export function edgeSpeaks(language: string): boolean {
  return edgeVoiceLanguagesFor(language).some((l) => EDGE_TTS_LANGUAGES.includes(l));
}

/** Speech, and only when asked for exactly that. */
export const edgeSpeechUnit: UnitDefinition<EdgeSettings, EdgeCredentials, LocalSpeechConfig> = {
  id: 'speech',
  occupies: (_s, want) => (sameStages(SP, want) ? SP : null),
  capabilities: () => ({
    // Whether a leg is read aloud is the user's switch to say, as it is for the local provider.
    speech: 'optional',
    turns: ['auto', 'manual'],
    turnOwner: 'either',
    boundaries: 'silence',
    textInput: false,
    faceToFace: true,
    participantSpeech: true,
    speaks: edgeSpeaks,
  }),
  build: (context, s) => {
    if (!context.speech) return { off: true };
    const { source, target } = context.direction;
    const edgeVoice = s.voices[directionKey(source, target)];
    return { modelId: EDGE_MODEL_ID, speakerId: 0, speed: s.speed, ...(edgeVoice ? { edgeVoice } : {}) };
  },
  describe: (c) => (isOff(c) ? {} : { ttsModel: EDGE_MODEL_ID }),
  startSpeech: (request, events) => startLocalSpeech(() => new TtsEngine(), request, events),
};
