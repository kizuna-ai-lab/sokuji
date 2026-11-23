import { KizunaAIIcon } from '../../components/Icons/ProviderIcons';
import { SP, TL, TR } from '../../lib/lineup/types';
import { wholeUnitOf } from '../../lib/plan/wholeUnit';
import type { Provider } from '../../lib/provider/types';
import { LOCAL_NATIVE_DEBUG_KEY } from '../../utils/environment';
import { createLocalNativeAdapter, type LocalNativeCredentials } from './adapter';
import { checkLocalNative } from './check';
import { admitLocalNative, buildLocalNative, describeLocalNative, type LocalNativeConfig } from './config';
import { LocalNativeEngine } from './LocalNativeEngine';
import { LocalNativeSettingsView } from './LocalNativeSettings';
import { LocalNativeTurnDetectionControls, LocalNativeTurnDetectionHelp, LocalNativeTurnDetectionSummary } from './LocalNativeTurnDetection';
import { LOCAL_NATIVE_DEFAULTS, localNativeLanguages, type LocalNativeSettings } from './settings';

const adapter = createLocalNativeAdapter();

/** Local Native's definition: LocalInference's sibling on the Electron sidecar, flagged until it ships (#578 ruling 1). */
export const localNativeProvider: Provider<LocalNativeSettings, LocalNativeCredentials, LocalNativeConfig> & { id: 'local_native' } = {
  id: 'local_native',
  kind: 'local',
  platforms: ['electron'],
  flagged: true,
  testerSwitch: LOCAL_NATIVE_DEBUG_KEY,
  icon: KizunaAIIcon,
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/local-native-setup',

  settings: { key: 'localNative', defaults: LOCAL_NATIVE_DEFAULTS },
  Settings: LocalNativeSettingsView,
  // The engine's three slots, the speech speed and the translation prompt; the VAD is its turn detection.
  settingsStages: [TR, TL, SP],
  Engine: LocalNativeEngine,
  TurnDetection: { Summary: LocalNativeTurnDetectionSummary, Controls: LocalNativeTurnDetectionControls, Help: LocalNativeTurnDetectionHelp },

  credentials: { keys: [], fields: () => [], read: () => ({}) },
  check: (_k, s, ctx) => checkLocalNative(s, ctx),
  // Its models are per direction and its gate reads the audio mode: a pick or a mode switch is a new answer.
  checkReadsDirection: true,
  // Its check reads this device's native facts: a download, a delete or the engine's lifecycle can change its answer.
  watchReadiness: (onChange, _local, native) => native.watch(onChange),
  languages: localNativeLanguages,

  units: [wholeUnitOf<LocalNativeSettings, LocalNativeCredentials, LocalNativeConfig>({
    speech: 'optional',
    textInput: () => true,
    boundaries: () => 'provider',
    turns: () => ['auto', 'manual'],
    build: buildLocalNative,
    describe: describeLocalNative,
    start: adapter.start,
  })],

  session: { admit: (configs) => admitLocalNative(configs) },
};
