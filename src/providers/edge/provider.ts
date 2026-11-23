/**
 * Edge (Microsoft's online text-to-speech) as a provider of its own: online, free, nothing to set up. Its one unit
 * speaks what another provider's unit translated; it never runs a session whole.
 */
import { EdgeIcon } from '../../components/Icons/ProviderIcons';
import { identityWire } from '../../lib/language/wire';
import { SP } from '../../lib/lineup/types';
import { EDGE_TTS_LANGUAGES } from '../../lib/local-inference/languageSupport';
import type { LocalSpeechConfig } from '../../lib/local-inference/sessions/speechSession';
import type { CredentialsMissing, Provider } from '../../lib/provider/types';
import { EdgeSettingsView } from './EdgeSettings';
import { EdgeVoiceSummary } from './EdgeVoiceSummary';
import { EDGE_DEFAULTS, migrateEdgeSettings, LOCAL_SPEED_KEY, LOCAL_VOICES_KEY, type EdgeSettings } from './settings';
import { edgeSpeechUnit, type EdgeCredentials } from './unit';

export type { EdgeCredentials, EdgeSettings };

const options = EDGE_TTS_LANGUAGES.map((value) => ({ value }));

export const edgeProvider: Provider<EdgeSettings, EdgeCredentials, LocalSpeechConfig> & { id: 'edge' } = {
  id: 'edge',
  kind: 'online',
  platforms: ['electron', 'extension', 'web'],
  icon: EdgeIcon,

  settings: {
    key: 'edge',
    defaults: EDGE_DEFAULTS,
    // Edge's own `voices` and `speed` (told from their defaults by being read with none), then the local provider's.
    legacyKeys: ['voices', 'speed', LOCAL_VOICES_KEY, LOCAL_SPEED_KEY],
    migrate: migrateEdgeSettings,
  },
  Settings: EdgeSettingsView,
  settingsStages: [SP],
  VoiceSummary: EdgeVoiceSummary,

  credentials: {
    keys: [],
    fields: () => [],
    // Annotated: an inferred return would not be told from a `missing` answer.
    read: (): EdgeCredentials | CredentialsMissing => ({}),
  },
  check: async () => ({ ok: true }),

  languages: {
    sources: () => options,
    targets: (source) => options.filter((o) => o.value !== source),
    wire: identityWire(),
  },

  units: [edgeSpeechUnit],
};
