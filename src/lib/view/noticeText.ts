/**
 * A notice put into the user's words (spec: "Notices reach the user
 * localized"): `message` is diagnostic English; a surface looks the text up
 * by `code`, under `notices.<code>` — or, for a code in `NOTICE_ALIASES`,
 * under the existing key it names. `{{detail}}` is the notice's own
 * message — the provider's error text, which today's error bubbles show.
 */
import type { TFunction } from 'i18next';
import { getLanguageOption } from '../../utils/languages';

export interface NoticeWords {
  code?: string;
  params?: Record<string, string | number>;
  message: string;
}

/** Params that carry a language code: shown by the name every language menu uses (`no_asr`'s `{{source}}`, roadmap 1e-2 → 1e-3). */
const LANGUAGE_PARAMS = new Set(['source', 'target']);

function named(params: Record<string, string | number> | undefined): Record<string, string | number> | undefined {
  if (!params) return params;
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, LANGUAGE_PARAMS.has(key) && typeof value === 'string' ? getLanguageOption(value).name : value]));
}

/** The English for every code a surface puts into words; `src/locales/en/translation.json`'s `notices` holds the same, word for word. */
export const NOTICE_WORDS: Readonly<Record<string, string>> = {
  // The runner's own (RUN_NOTICE_CODES).
  no_provider: 'Choose a provider in Settings before starting.',
  no_legs: 'Choose what to translate before starting.',
  turn_mode_unsupported: "This provider doesn't offer the chosen talk mode.",
  participant_source_unavailable: "Translating other participants isn't available here.",
  participant_unsupported: "This provider can't translate the other participants for this language pair.",
  credentials_missing: 'Enter your API key in Settings before starting.',
  not_ready: 'The provider is not ready: {{detail}}',
  build_refused: "The provider can't start with these settings: {{detail}}",
  admit_refused: "The provider can't run this combination: {{detail}}",
  start_failed: "The session didn't start: {{detail}}",
  leg_failed: 'The session stopped: {{detail}}',
  leg_closed: 'The provider ended the session.',
  source_ended: 'The audio source went away (unplugged, closed or stopped).',
  still_stopping: 'The last session is still stopping; try again in a moment.',
  // The capture's degradations.
  app_capture_lost_using_system_audio: 'The app capture stopped, so all system audio is being translated instead.',
  app_capture_monitor_missing: "The app capture didn't start, so all system audio is being translated instead.",
  silent_no_permission: 'No audio has come through from the selected source yet. If it is playing and nothing is translated, allow Sokuji under System Settings > Privacy & Security > System Audio Recording Only (macOS), then start the session again.',
  loopback_denied: "Other's audio requires Screen Recording permission to capture system audio.",
  no_microphone: 'Configure devices for this mode to start.',
  // Readiness (a provider's check).
  local_models_missing: 'Please download the required models in Settings to start.',
  // The adapters' degradations (CLIENT_DIAGNOSTICS).
  parse_error: "A message from the provider couldn't be read; the session continues.",
  cleanup_failed: 'A step while closing the session failed.',
  input_pipeline_failed: 'Audio capture stopped working; nothing further will be translated.',
  tts_degraded: 'Speech playback is degraded; the translated text still arrives.',
  resume_attempt_failed: 'Reconnecting failed; trying again.',
  send_dropped: "Some audio or text couldn't be sent and was dropped.",
  voice_fallback: 'The chosen voice was unavailable, so another voice is used.',
  lease_notify_failed: "The service couldn't be told about the session's state.",
  // A failed leg's API error type (the adapter's code).
  auth: 'The provider did not accept the credentials: {{detail}}',
  rate_limit: 'The provider is limiting requests; try again shortly: {{detail}}',
  network: 'The connection to the provider failed: {{detail}}',
  server: 'The provider had a problem: {{detail}}',
  client: 'The provider rejected the request: {{detail}}',
  // Local engines (LocalInference).
  no_asr: 'No speech recognition model is installed for {{source}}.',
  memory_exceeded: 'These models together need more memory than this device has.',
  gpu_out_of_memory: 'GPU out of memory — the selected model is too large for your GPU. Please switch to a smaller model.',
  transcription_failed: 'Some speech could not be transcribed: {{detail}}',
  translation_failed: 'A translation failed: {{detail}}',
  translation_unavailable: 'No translation model for this direction: its speech is transcribed only.',
};

/**
 * Codes worded by a sentence every locale already has (controller ruling
 * 4): the notice reuses that key rather than a `notices.<code>` of its own,
 * so no catalog changes. A code is here or in `NOTICE_WORDS`, never both. A
 * plan whose provider emits a new code with an existing sentence adds its
 * row; a sentence that names a vendor stays that vendor's (choice 9).
 */
export const NOTICE_ALIASES: Readonly<Record<string, string>> = {
  // A managed provider signed out: its `credentials.read` answers with this code (F3).
  sign_in_required: 'auth.signedOut',
  // A managed lease refused a start, or ended the run.
  insufficient_balance: 'mainPanel.sonioxInsufficientBalance',
  wallet_frozen: 'mainPanel.walletFrozen',
  session_conflict: 'mainPanel.sonioxSessionConflict',
  budget_exhausted: 'mainPanel.sonioxBudgetExhausted',
  // A provider ended the session under the user, and a new Start continues it.
  segment_ended: 'mainPanel.sonioxSegmentEnded',
  connection_lost: 'mainPanel.sonioxConnectionLost',
};

/** The notice in the user's words; the message itself for a code with no words, as today's bubbles show it. */
export function noticeText(t: TFunction, notice: NoticeWords): string {
  const alias = notice.code === undefined ? undefined : NOTICE_ALIASES[notice.code];
  // A catalog lacking the key shows the diagnostic English, as a code with no words does.
  if (alias !== undefined) return t(alias, { defaultValue: notice.message, ...named(notice.params), detail: notice.message });
  const words = notice.code === undefined ? undefined : NOTICE_WORDS[notice.code];
  if (words === undefined) return notice.message;
  return t(`notices.${notice.code}`, { defaultValue: words, ...named(notice.params), detail: notice.message });
}
