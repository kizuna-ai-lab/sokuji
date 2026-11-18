import { SonioxIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createSonioxAdapter } from './adapter';
import { checkSoniox } from './check';
import { buildSoniox, describeSoniox, sonioxContext, type SonioxConfig } from './config';
import { SonioxSettingsView } from './SonioxSettings';
import { SonioxVoiceSummary } from './SonioxVoiceSummary';
import { SonioxTurnDetectionControls, SonioxTurnDetectionSummary } from './SonioxTurnDetection';
import { migrateSonioxSettings, SONIOX_DEFAULTS, sonioxCredentials, sonioxKeyField, sonioxLanguages, type SonioxCredentials, type SonioxSettings } from './settings';
import { asSonioxRegion } from '../../lib/soniox/regions';
import { SONIOX_LANGUAGES, sonioxWire } from './languages';
import { AUTO } from '../../lib/provider/languages';
import { ALL_STAGES, SP, TR, TR_TL } from '../../lib/lineup/types';

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
  // A saved recording through Soniox's file recognition, in the project of the region the settings name.
  fileRecognition(settings, credentials, words) {
    const region = asSonioxRegion(settings.region);
    const apiKey = String((credentials as unknown as Record<string, unknown>)[sonioxKeyField(region)] ?? '').trim();
    if (!apiKey) return { missing: 'no-key' };
    const languageHint = (code: string): string | null => {
      // "Automatic" is no language to hint or translate into.
      if (code === AUTO) return null;
      try {
        return sonioxWire.toWire(code);
      } catch {
        return null;
      }
    };
    const context = sonioxContext(words);
    return { service: 'soniox', apiKey, region, languageHint, languages: SONIOX_LANGUAGES.map((l) => l.value), ...(context ? { context } : {}) };
  },
  platforms: ['electron', 'extension', 'web'],
  icon: SonioxIcon,
  // Today's TUTORIAL_URLS value, as a literal (LocalInference's rule: no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/soniox-setup',

  settings: { key: 'soniox', defaults: SONIOX_DEFAULTS, migrate: migrateSonioxSettings },
  Settings: SonioxSettingsView,
  // The region on every stage, the voices on speech, the vocabulary, background and shared session on transcription
  // and translation, the read-aloud text and speaker labels on transcription (mock v19).
  optionStages: [ALL_STAGES, SP, TR_TL, TR],
  // The endpoint knobs: summarized in the Speech section under Auto, drawn on Advanced's Provider tab.
  TurnDetection: { Summary: SonioxTurnDetectionSummary, Controls: SonioxTurnDetectionControls },
  // Each spoken leg's voice, under its Speech row.
  VoiceSummary: SonioxVoiceSummary,

  credentials: sonioxCredentials,
  check: (k, s, ctx) => checkSoniox(k, s, ctx),
  // The region picks the key field (`sonioxKeyField`); the check reads nothing else.
  checkReads: ['region'],

  languages: sonioxLanguages,

  speech: 'optional',
  faceToFace: true,
  // Soniox's STT socket takes no typed text.
  textInput: () => false,
  // The server's endpoint model ends a segment (`<end>`, `<fin>`).
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildSoniox,
  describe: describeSoniox,
  start: adapter.start,

  session: { startBoth: adapter.startBoth },
};
