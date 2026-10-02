import { SonioxIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createSonioxAdapter } from './adapter';
import { checkSoniox } from './check';
import { buildSoniox, describeSoniox, type SonioxConfig } from './config';
import { SonioxSettingsView } from './SonioxSettings';
import { SonioxTurnDetectionControls, SonioxTurnDetectionSummary } from './SonioxTurnDetection';
import { migrateSonioxSettings, SONIOX_DEFAULTS, sonioxCredentials, sonioxLanguages, type SonioxCredentials, type SonioxSettings } from './settings';

const adapter = createSonioxAdapter();

/**
 * Soniox with the user's own key (survey §2.1): real-time STT and
 * translation on one socket, its own TTS on a second, both legs on one
 * mixed socket in Both mode (D23). The old enum's id and slice (controller
 * ruling 2), so a stored selection and settings carry over. Released,
 * after LocalInference, not flagged (ruling 7). The extension manifest
 * already lists its twelve origins (survey §2.1): no manifest change.
 */
export const sonioxProvider: Provider<SonioxSettings, SonioxCredentials, SonioxConfig> & { id: 'soniox' } = {
  id: 'soniox',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: SonioxIcon,
  // Today's TUTORIAL_URLS value, as a literal (LocalInference's rule: no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/soniox-setup',

  settings: { key: 'soniox', defaults: SONIOX_DEFAULTS, migrate: migrateSonioxSettings },
  Settings: SonioxSettingsView,
  // The endpoint knobs: summarized in the Speech section under Auto, drawn on Advanced's Provider tab.
  TurnDetection: { Summary: SonioxTurnDetectionSummary, Controls: SonioxTurnDetectionControls },

  credentials: sonioxCredentials,
  check: (k, s, ctx) => checkSoniox(k, s, ctx),
  // The region picks the key field (`sonioxKeyField`); the check reads nothing else.
  checkReads: ['region'],

  languages: sonioxLanguages,

  speech: 'optional',
  // Soniox's STT socket takes no text.
  textInput: () => false,
  // The server's endpoint model ends a segment (`<end>`, `<fin>`).
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildSoniox,
  describe: describeSoniox,
  start: adapter.start,

  session: { startBoth: adapter.startBoth },
};
