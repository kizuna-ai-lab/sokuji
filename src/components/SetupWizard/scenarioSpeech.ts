// src/components/SetupWizard/scenarioSpeech.ts
//
// What decides whether the run a scenario would start speaks, for the pair
// step's language offer and both of the wizard's sentences.
import { heardFromStores, speechInputsFromStores } from '../../lib/session/appShape';
import { participantSpeechInput, type SpeechInputs } from '../../lib/session/shape';
import type { ScenarioPreset } from '../../lib/setup/scenarios';

/** The scenario's Text Only, and Translation I hear as the preset sets it (two-way-text offers as silent), or the stores' answer when the preset leaves it alone. */
export function scenarioSpeechInputs(preset: Pick<ScenarioPreset, 'textOnly' | 'otherSide' | 'participantSpeech'>): SpeechInputs {
  const beside = preset.otherSide === 'beside';
  return {
    textOnly: preset.textOnly,
    participantSpeech: preset.participantSpeech === undefined
      ? speechInputsFromStores().participantSpeech
      : participantSpeechInput({ participantSpeech: preset.participantSpeech, faceToFace: beside, heard: heardFromStores(beside) }),
  };
}
