/**
 * A notice put into the user's words (spec: "Notices reach the user
 * localized"): `message` is diagnostic English; a surface looks the text up
 * by `code`, under `notices.<code>` — or, for a code in `NOTICE_ALIASES`,
 * under the existing key it names. `{{detail}}` is the notice's own
 * message — the provider's error text, which today's error bubbles show.
 */
import type { TFunction } from 'i18next';
import i18next from 'i18next';
import { languageLabel } from '../language/label';
import { stageInSentence } from '../lineup/stageWords';

export interface NoticeWords {
  code?: string;
  params?: Record<string, string | number>;
  message: string;
}

/** Params that carry a language code: shown by the name every language menu uses (`no_asr`'s `{{source}}`, roadmap 1e-2 → 1e-3). */
const LANGUAGE_PARAMS = new Set(['source', 'target', 'language']);

/** The English of a line-up stage, where a catalog lacks it. */
const STAGE_NAMES: Readonly<Record<string, string>> = { transcription: 'Transcription', translation: 'Translation', speech: 'Speech' };
/** The names of the two options no provider definition carries: they run on this device's provider. */
const OPTION_NAMES: Readonly<Record<string, string>> = { bing: 'Bing', edge: 'Edge' };

/**
 * A refusal of the line-up names a stage and a service the way the line-up page does: the stage as it reads
 * inside a sentence, the service by its name, with its engine where two services share a name (`vendor`).
 */
function lineUpNamed(t: TFunction, params: Record<string, string | number>): Record<string, string | number> {
  const out = { ...params };
  const { stage, provider, vendor } = params;
  if (typeof stage === 'string') out.stage = stageInSentence(String(t(`settingsPage.lineup.stages.${stage}`, { defaultValue: STAGE_NAMES[stage] ?? stage })), i18next.language ?? 'en');
  if (typeof provider === 'string') {
    const name = String(t(`providers.${provider}.name`, { defaultValue: OPTION_NAMES[provider] ?? provider }));
    out.provider = typeof vendor === 'string' && vendor !== '' ? `${name} (${vendor})` : name;
  }
  return out;
}

function named(t: TFunction, code: string | undefined, params: Record<string, string | number> | undefined): Record<string, string | number> | undefined {
  if (!params) return params;
  const languages = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, LANGUAGE_PARAMS.has(key) && typeof value === 'string' ? languageLabel(value, i18next.language) : value]));
  return code?.startsWith('lineup_') ? lineUpNamed(t, languages) : languages;
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
  connection_restored: 'Connection lost and restored',
  // A line-up that cannot run (the composer's refusals): the stage and the service by the line-up page's names.
  lineup_incomplete: 'Choose a service for {{stage}} first.',
  lineup_not_offered: '{{provider}} is not available in this version. Choose another service for {{stage}}.',
  lineup_stage_split: '{{provider}} must also do {{stage}}. Choose {{provider}} for {{stage}}, or use another service instead of {{provider}}.',
  // A translation bound to its own transcription (Soniox's), beside another service's: which stage to change.
  lineup_translation_bound: '{{provider}} translation requires {{provider}} transcription. Choose {{provider}} for transcription, or choose another translation service.',
  lineup_no_unit: '{{provider}} cannot do {{stage}} on its own here. Choose it for the stages it does together, or choose another service.',
  lineup_voice_not_alone: 'Use {{provider}} for transcription and translation, or choose another speech service.',
  lineup_voice_not_taken: 'Choose {{provider}} for speech too, or choose another service for transcription and translation.',
  lineup_two_managed: 'Two Kizuna AI services cannot run in one session yet. Choose one of them.',
  lineup_language_not_spoken: '{{provider}} has no voice for {{language}}. Choose another speech service, or turn speech off for this session.',
  // Another service translates what one heard: it needs a stated language, it translates some pairs only, and it
  // cannot run face-to-face. The quoted words are the language menu's and the Both popover's own.
  lineup_source_not_fixed: '{{provider}} needs to know the spoken language. Choose it instead of “Auto Detect”, or choose another translation service.',
  lineup_pair_not_translated: '{{provider}} does not translate {{source}} into {{target}}. Choose other languages, or another translation service.',
  lineup_face_to_face_apart: 'Face-to-face needs one service to transcribe and translate. Choose {{provider}} for translation too, or set “Other side” to “In a meeting”.',
  // A managed lease refused a start, by what blocks the account (its 409's `blocker`).
  session_in_use: 'Another window or device is using this account. Stop the session there, or if Sokuji just closed unexpectedly, try again in a minute.',
  previous_session_ending: 'Your previous session is still ending. Please try again in a minute.',
  // A managed lease or the start gate refused an organization-paid start, or a running session's organization ended it. `_owner` is the owner's
  // wording of the row, and `_unnamed` the sentence for a stale quota that no longer names the organization.
  org_balance_held: "Your organization's balance is held by sessions in progress. Try again when one ends, or use your own balance.",
  org_insufficient_balance: "Ask the organization's owner to top up, or use your own balance.",
  org_insufficient_balance_owner: 'Top up {{organization}}, or use your own balance.',
  org_insufficient_balance_owner_unnamed: 'Top up your organization, or use your own balance.',
  not_org_member: "You're no longer in {{organization}}.",
  not_org_member_unnamed: "You're no longer in your organization.",
  org_wallet_frozen: "{{organization}}'s account is paused. Contact its owner, or use your own balance.",
  org_wallet_frozen_unnamed: "The organization's account is paused. Contact its owner, or use your own balance.",
  org_wallet_frozen_owner: "{{organization}}'s account is paused. Contact Sokuji support, or use your own balance.",
  org_wallet_frozen_owner_unnamed: "The organization's account is paused. Contact Sokuji support, or use your own balance.",
  // The capture's degradations.
  app_capture_lost_using_system_audio: 'The app capture stopped, so all system audio is being translated instead.',
  app_capture_monitor_missing: "The app capture didn't start, so all system audio is being translated instead.",
  silent_no_permission: 'No audio has come through from the selected source yet. If it is playing and nothing is translated, allow Sokuji under System Settings > Privacy & Security > System Audio Recording Only (macOS), then start the session again.',
  loopback_denied: "Other's audio requires Screen Recording permission to capture system audio.",
  // The microphone's device changing under it (#593).
  mic_lost_using_other: 'The microphone “{{lost}}” went away, so “{{device}}” is being used instead.',
  mic_lost_waiting: 'The microphone went away. Translation of your speech resumes when a microphone is connected.',
  mic_now_using: 'Now using the microphone “{{device}}”.',
  // A Windows microphone that would not open at Start (spec 2026-10-13 §3).
  mic_in_use: 'The microphone “{{device}}” is in use by {{apps}}. Close {{apps}} and start again, or choose another microphone.',
  mic_unreadable: 'Windows could not open the microphone “{{device}}”. Another app may be holding it, or its driver stopped responding. Close apps that use it or reconnect it, then start again.',
  mic_blocked: 'Windows is not letting Sokuji use the microphone. Turn on microphone access for desktop apps in Settings › Privacy & security › Microphone, then start again.',
  no_microphone: 'Configure devices for this mode to start.',
  // Readiness (a provider's check).
  local_models_missing: 'Please download the required models in Settings to start.',
  // The adapters' degradations (CLIENT_DIAGNOSTICS).
  parse_error: "A message from the provider couldn't be read; the session continues.",
  tts_degraded: 'Speech playback is degraded; the translated text still arrives.',
  resume_attempt_failed: 'Reconnecting failed; trying again.',
  voice_fallback: 'The chosen voice was unavailable, so another voice is used.',
  // The screen the Qwen engine was reading is gone (spec 2026-10-22): the sentence names no window and no button (the
  // extension has none; the desktop's chip offers Choose again).
  screen_context_lost: 'The screen you chose is no longer available; translation continues on audio alone.',
  // A failed leg's API error type (the adapter's code).
  auth: 'The provider did not accept the credentials: {{detail}}',
  rate_limit: 'The provider is limiting requests; try again shortly: {{detail}}',
  network: 'The connection to the provider failed: {{detail}}',
  server: 'The provider had a problem: {{detail}}',
  client: 'The provider rejected the request: {{detail}}',
  // A text model's service (spec 2026-11-22 §9): a model it does not offer, an account with no credit left, no model
  // chosen, and a compatible service's address missing or unusable.
  model_missing: 'The service does not offer this model: {{detail}}',
  quota: 'The service account has no credit left: {{detail}}',
  text_model_unset: 'Choose a model for the translation, or type its name, in “Languages and line-up”.',
  address_missing: "Enter the compatible service's address in “Accounts and keys” before starting.",
  address_invalid: "The compatible service's address cannot be used: {{detail}}",
  // The key is good, its account has not enabled the model in the key's region (Qwen's AccessDenied.Unpurchased, probe 2026-10-23).
  model_access_denied: "The key works, but its account can't use this model in the key's region. Enable the model for that region in the provider's console, or use a key from a region where it is enabled: {{detail}}",
  // Local engines (LocalInference).
  no_asr: 'No speech recognition model is installed for {{source}}.',
  memory_exceeded: 'These models together need more memory than this device has.',
  gpu_out_of_memory: 'GPU out of memory — the selected model is too large for your GPU. Please switch to a smaller model.',
  transcription_failed: 'Some speech could not be transcribed: {{detail}}',
  translation_failed: 'A translation failed: {{detail}}',
  translation_unavailable: 'No translation model for this direction: its speech is transcribed only.',
  // A leg that should speak but cannot (#619).
  speaker_tts_missing: 'Translation the other side hears is text only: no speech model speaks {{target}}.',
  participant_tts_missing: 'Translation I hear is text only: no speech model speaks {{target}}.',
  participant_tts_over_budget: "Translation I hear is text only: not enough memory to load the other side's speech model too.",
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
  // Qwen's request rate passed (a reconnect retries it; a quota spent is `rate_limit`): the limit's own sentence, in every locale.
  throttled: 'notices.rate_limit',
  // A provider ended the session under the user, and a new Start continues it.
  segment_ended: 'mainPanel.sonioxSegmentEnded',
  connection_lost: 'mainPanel.sonioxConnectionLost',
  // Kizuna Soniox's lease refused a start (Stage 2 Kizuna Soniox, ruling 11): the sentences name Soniox, so the codes keep it.
  soniox_service_unavailable: 'mainPanel.sonioxServiceUnavailable',
  soniox_service_busy: 'mainPanel.sonioxServiceBusy',
  // Kizuna Qwen's lease refused a start: the sentences name Qwen, so the codes keep it.
  qwen_service_unavailable: 'mainPanel.qwenServiceUnavailable',
  qwen_service_busy: 'mainPanel.qwenServiceBusy',
  // The region picked has no backend behind it yet, or the backend answered another: the sentence says to pick again.
  qwen_region_unavailable: 'mainPanel.qwenRegionUnavailable',
  // Its voice claim fell back to a built-in voice (choice 17): the sentences name no vendor.
  voice_clip_missing: 'mainPanel.sonioxVoiceClipMissing',
  voice_pool_busy: 'mainPanel.sonioxVoicePoolBusy',
  voice_build_failed: 'mainPanel.sonioxVoiceBuildFailed',
  voice_unavailable: 'mainPanel.sonioxVoiceUnavailable',
  // The start gate's balance floor (ruling 6): the old gate's sentence, with the balance.
  balance_below_floor: 'mainPanel.insufficientBalance',
  // A managed provider while the sign-in still loads at launch (choice 10): a generic word every locale has.
  sign_in_pending: 'update.checking',
  // The wallet (ruling 5): still loading at launch, no failure words; failed to load, the old gate's sentence (`oldGate:254-261`).
  quota_pending: 'update.checking',
  quota_unknown: 'tokenUsage.unableToLoadQuota',
  // A leg's speech failed (Stage 2 Soniox, choice 9): the sentences name no vendor.
  tts_segment_lost: 'mainPanel.sonioxTtsSegmentLost',
  tts_stopped: 'mainPanel.sonioxTtsFailed',
  // A text model's service refused the request for another reason (a reasoning value its model does not take): the
  // sentence of any other rejected request, with the service's own words.
  refused: 'notices.client',
  // Gemini (Stage 2 Gemini, ruling 13): a key that lists no Live model, and a start with no model to run — the old client's sentences, which name no vendor.
  no_realtime_model: 'settings.realtimeModelNotAvailable',
  models_required: 'mainPanel.modelsRequired',
  // OpenAI Translate (Stage 2 OpenAI Translate, choice 11): a key that lists no gpt-realtime-translate model, and a region OpenAI does not serve — the old validation's sentences, which every locale already has.
  no_translate_model: 'settings.translateModelNotAvailable',
  region_unsupported: 'settings.regionNotSupported',
  // The panel notes (spec 2026-10-05 §5): a result about the conversation,
  // worded by the export menu's own sentences.
  export_copied: 'mainPanel.export.copySuccess',
  export_copy_failed: 'mainPanel.export.copyFailed',
  autosave_saved: 'mainPanel.export.autoSave.saved',
  autosave_failed: 'mainPanel.export.autoSave.failed',
  history_recording_stopped: 'history.recordingStopped',
  history_transcript_stopped: 'history.transcriptStopped',
};

/**
 * The row an organization's refusal is worded by: the owner's (`_owner`) when its role says owner, and the one for a
 * stale quota (`_unnamed`) when no organization name came with it. Any other code is its own row.
 */
function wordsKey(code: string, params: Record<string, string | number> | undefined): string {
  let key = code;
  const named = Boolean(params?.organization);
  // The owner's row; one that interpolates the name is used only when the name is there.
  if (params?.role === 'owner') {
    if (named && `${key}_owner` in NOTICE_WORDS) key = `${key}_owner`;
    else if (!named && `${key}_owner_unnamed` in NOTICE_WORDS) key = `${key}_owner_unnamed`;
  }
  if (!named && !key.endsWith('_unnamed') && `${key}_unnamed` in NOTICE_WORDS) key = `${key}_unnamed`;
  return key;
}

/** The notice in the user's words; the message itself for a code with no words, as today's bubbles show it. */
export function noticeText(t: TFunction, notice: NoticeWords): string {
  const alias = notice.code === undefined ? undefined : NOTICE_ALIASES[notice.code];
  // A catalog lacking the key shows the diagnostic English, as a code with no words does.
  if (alias !== undefined) return t(alias, { defaultValue: notice.message, ...named(t, notice.code, notice.params), detail: notice.message });
  const key = notice.code === undefined ? undefined : wordsKey(notice.code, notice.params);
  const words = key === undefined ? undefined : NOTICE_WORDS[key];
  if (key === undefined || words === undefined) return notice.message;
  return t(`notices.${key}`, { defaultValue: words, ...named(t, notice.code, notice.params), detail: notice.message });
}
