import { PalabraAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createPalabraAdapter } from './adapter';
import { checkPalabra } from './check';
import { buildPalabra, describePalabra, type PalabraConfig } from './config';
import { PalabraSettingsView } from './PalabraSettings';
import { PalabraTurnDetectionControls, PalabraTurnDetectionSummary } from './PalabraTurnDetection';
import { migratePalabraSettings, PALABRA_DEFAULTS, palabraCredentials, palabraLanguages, type PalabraCredentials, type PalabraSettings } from './settings';

const adapter = createPalabraAdapter();

/**
 * Palabra AI with the user's own credentials (Stage 2 Palabra): speech to
 * speech, one WebSocket per leg — written anew, the old LiveKit client not
 * ported (the owner, 2026-09-29). The old enum's id and slice (controller
 * ruling 2 of the foundation), so a stored selection, the credentials, the
 * pair and every setting carry over. The platform key or the legacy app
 * pair, picked above the fields (ruling 1). Its REST calls are plain CORS
 * and its socket takes its credential in the query, so it runs on every
 * platform, and the extension's CSP already lists `*.palabra.ai`: no
 * manifest or background change. Released last, after Soniox, unflagged
 * (ruling 14): `VITE_ENABLE_PALABRA_AI` was the old code's, and went with it.
 */
export const palabraProvider: Provider<PalabraSettings, PalabraCredentials, PalabraConfig> & { id: 'palabraai' } = {
  id: 'palabraai',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: PalabraAIIcon,
  // Today's TUTORIAL_URLS value, as a literal (no import from src/services); its text is updated later (ruling 18).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/palabraai-setup',

  // No `legacyKeys`: nothing stored is converted (ruling 2).
  settings: { key: 'palabraai', defaults: PALABRA_DEFAULTS, migrate: migratePalabraSettings },
  Settings: PalabraSettingsView,
  TurnDetection: { Summary: PalabraTurnDetectionSummary, Controls: PalabraTurnDetectionControls },

  credentials: palabraCredentials,
  check: (k, s, ctx) => checkPalabra(k, s, ctx),
  // The session list reads the credentials alone; `authMode` decides which show. A slider or a switch keeps Start on.
  checkReads: ['authMode'],

  // Its documented tables, and its documented reverse (rulings 8, 9).
  languages: palabraLanguages,

  // A leg that does not speak asks for text alone (ruling 7): Text only is offered.
  speech: 'optional',
  // Transcription only: the runner keeps the translation side and the audio out of the conversation.
  transcribeOnly: true,
  // It takes audio only (parity).
  textInput: () => false,
  // A validated transcription ends a segment (the old offer: pause off, auto and sizes on).
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildPalabra,
  describe: describePalabra,
  start: adapter.start,
};
