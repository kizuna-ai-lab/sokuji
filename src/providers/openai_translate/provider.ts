import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createTranslateAdapter } from './adapter';
import { checkTranslate } from './check';
import { buildTranslate, describeTranslate, type TranslateConfig } from './config';
import {
  migrateTranslateSettings,
  TRANSLATE_DEFAULTS,
  translateCredentials,
  translateLanguages,
  type TranslateCredentials,
  type TranslateSettings,
} from './settings';
import { TranslateSettingsView } from './TranslateSettings';

const adapter = createTranslateAdapter();

/**
 * OpenAI Translate with the user's own key (Stage 2 OpenAI Translate):
 * `gpt-realtime-translate`, speech to speech, one WebSocket per leg, the
 * only transport (WebRTC abandoned, 2026-09-29). The old enum's id and slice
 * (controller ruling 2 of the foundation), so a stored selection, the key,
 * the pair and the noise reduction carry over. The key rides in a
 * subprotocol a browser sets itself, so it runs on every platform, and the
 * extension's manifest already lists its host and CSP origin: no manifest
 * or background change. Released between Doubao AST 2.0 and Soniox,
 * unflagged (ruling 11).
 */
export const openaiTranslateProvider: Provider<TranslateSettings, TranslateCredentials, TranslateConfig> & { id: 'openai_translate' } = {
  id: 'openai_translate',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: OpenAIIcon,
  // The OpenAI setup guide: the same key (ruling 12). Today's TUTORIAL_URLS value for OpenAI, as a literal (no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',

  settings: { key: 'openaiTranslate', defaults: TRANSLATE_DEFAULTS, migrate: migrateTranslateSettings },
  Settings: TranslateSettingsView,

  credentials: translateCredentials,
  check: (k, s, ctx) => checkTranslate(k, s, ctx),
  // The model list reads the key alone.
  checkReads: [],

  languages: translateLanguages,

  // Text only is offered (ruling 4): the API still speaks, and a leg that does not speak drops the audio.
  speech: 'optional',
  // Transcription only: the runner keeps the translation side and the audio out of the conversation.
  transcribeOnly: true,
  // The endpoint takes audio only.
  textInput: () => false,
  // Our own silence timers end segments (the old offer: pause, no auto, sizes).
  boundaries: () => 'silence',
  turns: () => ['auto', 'manual'],

  build: buildTranslate,
  describe: describeTranslate,
  start: adapter.start,
};
