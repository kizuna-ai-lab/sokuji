import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createRealtimeAdapter } from './adapter';
import { checkRealtime } from './check';
import { buildRealtime, describeRealtime, type RealtimeConfig } from './config';
import { RealtimeSettingsView } from './RealtimeSettings';
import { RealtimeTurnDetectionControls, RealtimeTurnDetectionHelp, RealtimeTurnDetectionSummary } from './RealtimeTurnDetection';
import {
  migrateRealtimeSettings,
  REALTIME_DEFAULTS,
  REALTIME_LEGACY_KEYS,
  realtimeCredentials,
  realtimeLanguages,
  type RealtimeCredentials,
  type RealtimeSettings,
} from './settings';

const adapter = createRealtimeAdapter();

/**
 * OpenAI Realtime with the user's own key (Stage 2 OpenAI Realtime): a
 * GPT Realtime dialogue model made a translator by its instructions, one
 * WebSocket per leg, the only transport (the owner abandoned WebRTC for
 * this provider, 2026-09-29).
 * The old enum's id and slice (controller ruling 2 of the foundation), so a
 * stored selection, the key, the pair and every setting carry over. The
 * key rides in a subprotocol a browser sets itself, so it runs on every
 * platform, and the extension's manifest already lists its host and CSP
 * origin: no manifest or background change. Released between Doubao AST
 * 2.0 and OpenAI Translate, unflagged (ruling 18). OpenAI Compatible is
 * retired, not ported (ruling 1): a stored selection of it falls to the
 * first provider offered.
 */
export const openaiProvider: Provider<RealtimeSettings, RealtimeCredentials, RealtimeConfig> & { id: 'openai' } = {
  id: 'openai',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: OpenAIIcon,
  // The OpenAI setup guide (ruling 19): today's TUTORIAL_URLS value, as a literal (no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',

  settings: { key: 'openai', defaults: REALTIME_DEFAULTS, legacyKeys: REALTIME_LEGACY_KEYS, migrate: migrateRealtimeSettings },
  Settings: RealtimeSettingsView,
  TurnDetection: { Summary: RealtimeTurnDetectionSummary, Controls: RealtimeTurnDetectionControls, Help: RealtimeTurnDetectionHelp },

  credentials: realtimeCredentials,
  check: (k, s, ctx) => checkRealtime(k, s, ctx),
  // The model list reads no setting (ruling 9): a slider or a prompt edit keeps Start on.
  checkReads: [],

  languages: realtimeLanguages,

  // Text only is the API's own: a leg that does not speak asks for text alone.
  speech: 'optional',
  // Transcription only: the runner keeps the translation side and the audio out of the conversation.
  transcribeOnly: true,
  textInput: () => true,
  // The server's commits and responses end segments (the old offer: Auto); cutting by sentences is offered too.
  boundaries: () => 'provider',
  // WebSocket only, so both turn modes on every leg.
  turns: () => ['auto', 'manual'],

  build: buildRealtime,
  describe: describeRealtime,
  start: adapter.start,
};
