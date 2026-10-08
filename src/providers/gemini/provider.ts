import { GeminiIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createGeminiAdapter } from './adapter';
import { checkGemini } from './check';
import { buildGemini, describeGemini, type GeminiConfig } from './config';
import { GeminiSettingsView } from './GeminiSettings';
import { GeminiTurnDetectionControls, GeminiTurnDetectionHelp, GeminiTurnDetectionSummary } from './GeminiTurnDetection';
import {
  GEMINI_DEFAULTS,
  GEMINI_LEGACY_KEYS,
  geminiCredentials,
  geminiLanguages,
  migrateGeminiSettings,
  offersTranslate,
  type GeminiCredentials,
  type GeminiSettings,
} from './settings';

const adapter = createGeminiAdapter();

/**
 * Google Gemini with the user's own key (Stage 2 Gemini): the Live API's
 * dialogue models and Live Translate, one socket per leg. The old enum's
 * id and slice (controller ruling 2 of the foundation), so a stored
 * selection and settings carry over; its system instructions are its own,
 * read from the old global copy until edited here (ruling 4). Released
 * between LocalInference and Soniox, unflagged (ruling 6). The extension's
 * CSP already lists its origin (survey §3.7.6): no manifest change.
 */
export const geminiProvider: Provider<GeminiSettings, GeminiCredentials, GeminiConfig> & { id: 'gemini' } = {
  id: 'gemini',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: GeminiIcon,
  // Today's TUTORIAL_URLS value, as a literal (no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/gemini-setup',

  settings: { key: 'gemini', defaults: GEMINI_DEFAULTS, legacyKeys: GEMINI_LEGACY_KEYS, migrate: migrateGeminiSettings },
  Settings: GeminiSettingsView,
  // The server's activity-detection knobs: summarized in the Speech section under Auto, drawn on Advanced's Provider tab.
  TurnDetection: { Summary: GeminiTurnDetectionSummary, Controls: GeminiTurnDetectionControls, Help: GeminiTurnDetectionHelp },

  credentials: geminiCredentials,
  check: checkGemini,
  // The model list reads the key alone.
  checkReads: [],

  languages: geminiLanguages,

  speech: 'optional',
  // Transcription only: the runner keeps the translation side and the audio out of the conversation.
  transcribeOnly: true,
  // The dialogue models answer typed text; Live Translate ignores it (the owner's live test, 2026-09-30), so it offers
  // none, the box hidden as on every other continuous interpreter. No model chosen reads as Live Translate, as the offer does.
  textInput: (s) => !offersTranslate(s),
  // Parity with the old offer (pause, not Auto): a dialogue turn ends at turnComplete, Live Translate on our own timers.
  boundaries: () => 'silence',
  turns: () => ['auto', 'manual'],

  build: buildGemini,
  describe: describeGemini,
  start: adapter.start,
};
