/**
 * A notice put into the user's words (spec: "Notices reach the user
 * localized"): `message` is diagnostic English; a surface looks the text up
 * by `code`, under `notices.<code>`. `{{detail}}` is the notice's own
 * message — the provider's error text, which today's error bubbles show.
 */
import type { TFunction } from 'i18next';

export interface NoticeWords {
  code?: string;
  params?: Record<string, string | number>;
  message: string;
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
};

/** The notice in the user's words; the message itself for a code with no words, as today's bubbles show it. */
export function noticeText(t: TFunction, notice: NoticeWords): string {
  const words = notice.code === undefined ? undefined : NOTICE_WORDS[notice.code];
  if (words === undefined) return notice.message;
  return t(`notices.${notice.code}`, { defaultValue: words, ...notice.params, detail: notice.message });
}
