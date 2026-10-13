// src/components/SetupWizard/scenarioSpeech.ts
//
// What decides whether the run a scenario would start speaks, for the pair
// step's language offer and both of the wizard's sentences.
import { heardFromStores } from '../../lib/session/appShape';
import { participantSpeechInput, type SpeechInputs } from '../../lib/session/shape';
import type { ScenarioPreset } from '../../lib/setup/scenarios';
import { useRoutingStore } from '../../stores/routingStore';

/**
 * The scenario's Text Only, and Translation I hear as applying it leaves the
 * switch (`applySetupDraft`): the preset's answer (two-way-text offers as
 * silent), else the stored one — auto included — resolved against the
 * scenario's own side, never the side the stores sit on now.
 */
export function scenarioSpeechInputs(preset: Pick<ScenarioPreset, 'textOnly' | 'otherSide' | 'participantSpeech'>): SpeechInputs {
  const beside = preset.otherSide === 'beside';
  return {
    textOnly: preset.textOnly,
    participantSpeech: participantSpeechInput({
      participantSpeech: preset.participantSpeech ?? useRoutingStore.getState().participantSpeech,
      faceToFace: beside,
      heard: heardFromStores(beside),
    }),
  };
}
