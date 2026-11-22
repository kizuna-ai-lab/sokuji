/**
 * Edge's voice as a unit that only speaks: Microsoft's online text-to-speech reads the translations of whichever
 * unit makes them. The session is the shared engine-backed one (`startLocalSpeech`); this file is its definition:
 * what it declares, which languages it speaks, and the config it builds (the Edge model, the direction's voice).
 */
import { canonicalTag } from '../../lib/language/code';
import { SP } from '../../lib/lineup/types';
import { EDGE_TTS_LANGUAGES } from '../../lib/local-inference/languageSupport';
import { TtsEngine } from '../../lib/local-inference/engine/TtsEngine';
import { directionKey } from '../../lib/local-inference/selection/types';
import { isOff, startLocalSpeech, type LocalSpeechConfig } from '../../lib/local-inference/sessions/speechSession';
import { sameStages, type UnitDefinition } from '../../lib/plan/types';
import type { EdgeSettings } from './settings';

/** Edge has no credentials. */
export type EdgeCredentials = Record<string, never>;

/** A language's base, as the voice list writes it ("pt" of "pt-BR"). */
function baseOf(language: string): string {
  try {
    return canonicalTag(language).split('-')[0];
  } catch {
    return language;
  }
}

/** Whether Edge has voices for `language`: its base is one of Edge's. */
export function edgeSpeaks(language: string): boolean {
  const base = baseOf(language);
  return EDGE_TTS_LANGUAGES.some((l) => baseOf(l) === base);
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
    return { modelId: 'edge-tts', speakerId: 0, speed: s.speed, ...(edgeVoice ? { edgeVoice } : {}) };
  },
  describe: (c) => (isOff(c) ? {} : { ttsModel: 'edge-tts' }),
  startSpeech: (request, events) => startLocalSpeech(() => new TtsEngine(), request, events),
};
