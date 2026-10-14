import { QwenIcon } from '../../components/Icons/ProviderIcons';
import { platformHeaderSocket } from '../../lib/contract/headerSocket';
import type { Provider } from '../../lib/provider/types';
import { createQwenAdapter } from './adapter';
import { checkQwen, detectEndpoint } from './check';
import { buildQwen, describeQwen, type QwenConfig } from './config';
import { QwenSettingsView, QwenVoiceSummary } from './QwenSettings';
import { QwenTurnDetectionControls, QwenTurnDetectionSummary } from './QwenTurnDetection';
import { QWEN_DEFAULTS, qwenCredentials, qwenLanguages, type QwenCredentials, type QwenSettings } from './settings';

const adapter = createQwenAdapter({ openHeaderSocket: platformHeaderSocket, detect: detectEndpoint });

/**
 * Qwen LiveTranslate with the user's own key (spec 2026-10-13; issue
 * #620): `qwen3.8-livetranslate-flash-realtime`, one session per leg, at the
 * storefront the key belongs to — QwenCloud or 千问云, which the check finds.
 * Its socket needs an `Authorization` header, which only the desktop app and
 * the extension can set (the header seam), so it has no web build (D3).
 * Unflagged by the owner after his live test (2026-10-14; D9).
 */
export const qwenLiveTranslateProvider: Provider<QwenSettings, QwenCredentials, QwenConfig> & { id: 'qwen_livetranslate' } = {
  id: 'qwen_livetranslate',
  kind: 'own-key',
  platforms: ['electron', 'extension'],
  icon: QwenIcon,

  settings: { key: 'qwenLiveTranslate', defaults: QWEN_DEFAULTS },
  Settings: QwenSettingsView,
  // Each spoken leg's voice, or whose own voice is cloned, under its Speech row.
  VoiceSummary: QwenVoiceSummary,
  // The pause that ends a turn under automatic turns: summed up under Speech, tuned on the Provider tab.
  TurnDetection: { Summary: QwenTurnDetectionSummary, Controls: QwenTurnDetectionControls },

  credentials: qwenCredentials,
  check: checkQwen,
  // The storefront depends on the key alone: a voice edit keeps Start on.
  checkReads: [],

  languages: qwenLanguages,

  // Text only is offered: a leg that does not speak asks for text alone.
  speech: 'optional',
  // An interpreter takes no typed text.
  textInput: () => false,
  // The server cuts each turn: on a change of speaker or 2.5 s of silence, or at a push-to-talk release.
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildQwen,
  describe: describeQwen,
  start: adapter.start,
};
