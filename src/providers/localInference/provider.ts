import { KizunaAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createLocalInferenceAdapter, type LocalCredentials } from './adapter';
import { checkLocalInference, watchLocalInferenceReadiness } from './check';
import { admitLocalInference, buildLocalInference, describeLocalInference, type LocalInferenceConfig } from './config';
import { LocalInferenceEngine } from './LocalInferenceEngine';
import { LocalInferenceEngineSummary } from './LocalInferenceEngineSummary';
import { LocalInferenceSettingsView } from './LocalInferenceSettings';
import { LocalInferenceTurnDetectionControls, LocalInferenceTurnDetectionHelp, LocalInferenceTurnDetectionSummary } from './LocalInferenceTurnDetection';
import { LOCAL_INFERENCE_DEFAULTS, localInferenceLanguages, type LocalInferenceSettings } from './settings';

const adapter = createLocalInferenceAdapter();

/**
 * LocalInference's definition (D18): its engines run entirely on-device, so
 * it needs no credentials (`kind: 'local'`) and offers itself on every
 * platform. Ruling 10: first in UI order among the released providers.
 */
export const localInferenceProvider: Provider<LocalInferenceSettings, LocalCredentials, LocalInferenceConfig> & { id: 'localInference' } = {
  id: 'localInference',
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
  Engine: LocalInferenceEngine,
  EngineSummary: LocalInferenceEngineSummary,
  // Its VAD knobs: summarized in the Speech section under Auto, drawn on Advanced's Provider tab.
  TurnDetection: { Summary: LocalInferenceTurnDetectionSummary, Controls: LocalInferenceTurnDetectionControls, Help: LocalInferenceTurnDetectionHelp },

  credentials: { keys: [], fields: () => [], read: () => ({}) },
  check: (_k, s, ctx) => checkLocalInference(s, ctx),
  watchReadiness: watchLocalInferenceReadiness,

  languages: localInferenceLanguages,

  speech: 'optional',
  textInput: true,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildLocalInference,
  describe: describeLocalInference,
  start: adapter.start,

  session: { admit: admitLocalInference },
};
