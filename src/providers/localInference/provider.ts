import { SP, TL, TR } from '../../lib/lineup/types';
import { KizunaAIIcon } from '../../components/Icons/ProviderIcons';
import { wholeUnitOf } from '../../lib/plan/wholeUnit';
import type { Provider } from '../../lib/provider/types';
import { createLocalInferenceAdapter, type LocalCredentials } from './adapter';
import { checkLocalInference } from './check';
import { admitLocalInference, buildLocalInference, describeLocalInference, localModelsOf, type LocalInferenceConfig } from './config';
import { LocalInferenceEngine } from './LocalInferenceEngine';
import { LocalInferenceEngineSummary } from './LocalInferenceEngineSummary';
import { LocalInferenceVoiceSummary } from './LocalInferenceVoiceSummary';
import { LocalInferenceSettingsView } from './LocalInferenceSettings';
import { LocalInferenceTurnDetectionControls, LocalInferenceTurnDetectionHelp, LocalInferenceTurnDetectionSummary } from './LocalInferenceTurnDetection';
import { LOCAL_INFERENCE_DEFAULTS, localInferenceLanguages, type LocalInferenceSettings } from './settings';
import { admitLocalSpeech, areLocalSpeechConfigs, localSpeechUnit } from './speechUnit';
import { admitLocalTranscription, areLocalTranscriptionConfigs, localTranscriptionUnit } from './transcriptionUnit';
import { admitLocalTranslation, areLocalTranslationConfigs, localTranslationUnit } from './translationUnit';

const adapter = createLocalInferenceAdapter();

/**
 * LocalInference's definition (D18): its engines run entirely on-device, so
 * it needs no credentials (`kind: 'local'`) and offers itself on every
 * platform. Ruling 10: first in UI order among the released providers.
 */
export const localInferenceProvider: Provider<LocalInferenceSettings, LocalCredentials, LocalInferenceConfig> & { id: 'local_inference' } = {
  // The old enum's spelling, as every provider's id is (controller ruling 2
  // of the Stage 2 foundation): what every install stores, what analytics
  // report, and the segment its locale keys sit under. Stage 1 named it
  // `localInference` and mapped it; the rename retired the mapping. Its
  // settings keep the old slice key below.
  id: 'local_inference',
  kind: 'local',
  platforms: ['electron', 'extension', 'web'],
  icon: KizunaAIIcon,
  // Today's TUTORIAL_URLS value (`services/providers/tutorialUrls.ts`), as a
  // literal: that module is under `src/services`, the old provider layer
  // this rewrite is replacing, and this provider's own code should not
  // depend on it.
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/local-inference-setup',

  settings: { key: 'localInference', defaults: LOCAL_INFERENCE_DEFAULTS },
  Settings: LocalInferenceSettingsView,
  // The engine's three slots, the speech speed and the translation prompt (mock v19); the VAD is its turn detection.
  settingsStages: [TR, TL, SP],
  Engine: LocalInferenceEngine,
  EngineSummary: LocalInferenceEngineSummary,
  // Its voices sit with its TTS models, per direction (#619): the Speech section names them and opens the slot.
  VoiceSummary: LocalInferenceVoiceSummary,
  voicesInEngine: true,
  // Its VAD knobs: summarized in the Speech section under Auto, drawn on Advanced's Provider tab.
  TurnDetection: { Summary: LocalInferenceTurnDetectionSummary, Controls: LocalInferenceTurnDetectionControls, Help: LocalInferenceTurnDetectionHelp },

  credentials: { keys: [], fields: () => [], read: () => ({}) },
  check: (_k, s, ctx) => checkLocalInference(s, ctx),
  // Its models are per direction, and both legs need the participant's too: a pick or an audio-mode switch is a new answer.
  checkReadsDirection: true,
  // Its check reads this device's models: a download, a delete or their first scan can change its answer.
  watchReadiness: (onChange, models) => models.watch(onChange),

  languages: localInferenceLanguages,

  /**
   * Four units. Its whole session (`wholeUnitOf`), for a line-up in which this device transcribes and translates:
   * those stages together, as before, and the composer takes it there before any cut (fewest units first). Its
   * recognition alone, which transcribes for another provider to translate. Its translation alone (a local model),
   * which translates what another provider heard. And its voice alone (a local speech model), which reads another
   * provider's translations.
   */
  units: [
    wholeUnitOf<LocalInferenceSettings, LocalCredentials, LocalInferenceConfig>({
      speech: 'optional',
      textInput: () => true,
      boundaries: () => 'provider',
      turns: () => ['auto', 'manual'],
      build: buildLocalInference,
      describe: describeLocalInference,
      start: adapter.start,
    }),
    localTranscriptionUnit,
    localTranslationUnit,
    localSpeechUnit,
  ],

  session: {
    // Asked once per planned unit, with that unit's configs: the voice alone counts its own models only, and so
    // do the translation alone and the recognition alone.
    // Each budgets by this device's GPU features, read from the models the run hands it (`shared.localModels`).
    admit: (configs, shared) => {
      const features = localModelsOf(shared).deviceFeatures();
      if (areLocalSpeechConfigs(configs)) return admitLocalSpeech(configs, features);
      if (areLocalTranslationConfigs(configs)) return admitLocalTranslation(configs, features);
      if (areLocalTranscriptionConfigs(configs)) return admitLocalTranscription(configs, features);
      return admitLocalInference(configs, features);
    },
  },
};
