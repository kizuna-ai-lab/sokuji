import { KizunaAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { LOCAL_NATIVE_DEBUG_KEY } from '../../utils/environment';
import { createLocalNativeAdapter, type LocalNativeCredentials } from './adapter';
import { nativeStoreHost } from './bridge';
import { checkLocalNative, watchLocalNativeReadiness } from './check';
import { admitLocalNative, buildLocalNative, describeLocalNative, type LocalNativeConfig } from './config';
import { nativeEngines } from './engines';
import { LocalNativeEngine } from './LocalNativeEngine';
import { LocalNativeEngineSummary } from './LocalNativeEngineSummary';
import { LocalNativeSettingsView } from './LocalNativeSettings';
import { LocalNativeTurnDetectionControls, LocalNativeTurnDetectionHelp, LocalNativeTurnDetectionSummary } from './LocalNativeTurnDetection';
import { LOCAL_NATIVE_DEFAULTS, localNativeLanguages, type LocalNativeSettings } from './settings';

const adapter = createLocalNativeAdapter(nativeEngines, nativeStoreHost);

/**
 * Local Native's definition (spec: Migration item 10): LocalInference's
 * sibling on the Electron sidecar. Flagged and unlocked by its tester switch
 * until it ships (#578 ruling 1); its catalogs already spell it `local_native`.
 */
export const localNativeProvider: Provider<LocalNativeSettings, LocalNativeCredentials, LocalNativeConfig> & { id: 'local_native' } = {
  id: 'local_native',
  kind: 'local',
  platforms: ['electron'],
  flagged: true,
  testerSwitch: LOCAL_NATIVE_DEBUG_KEY,
  icon: KizunaAIIcon,
  // Today's TUTORIAL_URLS value, as a literal: that module is the old provider layer.
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/local-native-setup',

  settings: { key: 'localNative', defaults: LOCAL_NATIVE_DEFAULTS },
  Settings: LocalNativeSettingsView,
  Engine: LocalNativeEngine,
  EngineSummary: LocalNativeEngineSummary,
  TurnDetection: { Summary: LocalNativeTurnDetectionSummary, Controls: LocalNativeTurnDetectionControls, Help: LocalNativeTurnDetectionHelp },

  credentials: { keys: [], fields: () => [], read: () => ({}) },
  check: (_k, s, ctx) => checkLocalNative(s, ctx),
  watchReadiness: watchLocalNativeReadiness,

  languages: localNativeLanguages,

  speech: 'optional',
  textInput: () => true,
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildLocalNative,
  describe: describeLocalNative,
  start: adapter.start,

  session: { admit: admitLocalNative },
};
