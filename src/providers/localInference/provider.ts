import { KizunaAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createLocalInferenceAdapter, type LocalCredentials } from './adapter';
import { checkLocalInference, watchLocalInferenceReadiness } from './check';
import { admitLocalInference, buildLocalInference, describeLocalInference, type LocalInferenceConfig } from './config';
import { LocalInferenceEngine } from './LocalInferenceEngine';
import { LocalInferenceSettingsView } from './LocalInferenceSettings';
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

  settings: { key: 'localInference', defaults: LOCAL_INFERENCE_DEFAULTS },
  Settings: LocalInferenceSettingsView,
  Engine: LocalInferenceEngine,

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
