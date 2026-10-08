import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createLiveAdapter } from './adapter';
import { checkLive } from './check';
import { buildLive, describeLive, type LiveConfig } from './config';
import { LiveSettingsView } from './LiveSettings';
import {
  LIVE_DEFAULTS,
  LIVE_LEGACY_KEYS,
  liveCredentials,
  liveLanguages,
  migrateLiveSettings,
  type LiveCredentials,
  type LiveSettings,
} from './settings';

const adapter = createLiveAdapter();

/**
 * OpenAI Live with the user's own key (Stage 2 OpenAI Live): `gpt-live-1`, a
 * simultaneous interpreter made one by its instructions, one WebSocket per
 * leg. The old enum's id and slice, so a stored selection, the key, the pair
 * and the voice carry over. Its upgrade needs a real `Authorization` header
 * and no `Origin`, which only the desktop app and the extension can set — the
 * header seam (F14; ruling 7) — so it is the first definition without the
 * web (choice 17). The extension's manifest already lists its host and CSP
 * origin (PR #552). Released after OpenAI Translate, unflagged, as the old
 * provider was (ruling 9).
 */
export const openaiLiveProvider: Provider<LiveSettings, LiveCredentials, LiveConfig> & { id: 'openai_live' } = {
  id: 'openai_live',
  kind: 'own-key',
  platforms: ['electron', 'extension'],
  icon: OpenAIIcon,
  // The OpenAI setup guide: the same kind of key. Today's TUTORIAL_URLS value for OpenAI, as a literal (no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',

  settings: { key: 'openaiLive', defaults: LIVE_DEFAULTS, legacyKeys: LIVE_LEGACY_KEYS, migrate: migrateLiveSettings },
  Settings: LiveSettingsView,

  credentials: liveCredentials,
  check: (k, s, ctx) => checkLive(k, s, ctx),
  // The model list reads no setting: a voice or a prompt edit keeps Start on.
  checkReads: [],

  languages: liveLanguages,

  // Text only is offered (ruling 1): the API always speaks — and bills the audio — and a leg that does not speak drops it; the participant speaks on its switch.
  speech: 'optional',
  // Transcription only: the runner keeps the translation side and the audio out of the conversation.
  transcribeOnly: true,
  // An interpreter takes no typed text (ruling 9).
  textInput: () => false,
  // Our own silence timers end segments (the old offer: pause, no auto, sizes).
  boundaries: () => 'silence',
  // Both turn modes: a release mutes the session, a press unmutes it (ruling 5).
  turns: () => ['auto', 'manual'],

  build: buildLive,
  describe: describeLive,
  start: adapter.start,
};
