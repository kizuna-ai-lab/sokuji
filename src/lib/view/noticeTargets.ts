/**
 * The Settings section a notice's code asks the user to visit —
 * `reasonToSettingsTarget`'s successor (spec: "Notices reach the user
 * localized"). A target is `navigateToSettings`'s: the section's element id
 * without `-section`.
 */
import { providerTarget } from './providerTarget';

export const NOTICE_TARGETS: Readonly<Record<string, string>> = {
  no_microphone: 'microphone',
  // A Windows microphone that would not open: besides closing the application holding it, choose another (spec 2026-10-13 §3).
  mic_in_use: 'microphone',
  mic_unreadable: 'microphone',
  // The settings page splits what the old provider section held: choosing a provider is the line-up's
  // stage rows, a key or a sign-in is "Accounts and keys" ('provider'), and models, memory and voices are
  // the provider's own options under the line-up ('provider-options').
  no_provider: 'lineup',
  // A line-up that cannot run is changed where it is chosen.
  lineup_incomplete: 'lineup',
  lineup_not_offered: 'lineup',
  lineup_stage_split: 'lineup',
  lineup_translation_bound: 'lineup',
  lineup_no_unit: 'lineup',
  lineup_voice_not_alone: 'lineup',
  lineup_voice_not_taken: 'lineup',
  lineup_two_managed: 'lineup',
  lineup_language_not_spoken: 'lineup',
  // What another service that translates refuses: the line-up's card says it, on the page that also holds the pair.
  lineup_source_not_fixed: 'lineup',
  lineup_pair_not_translated: 'lineup',
  lineup_face_to_face_apart: 'lineup',
  credentials_missing: 'provider',
  // A compatible service's address is entered beside its key (text models, part B).
  address_missing: 'provider',
  address_invalid: 'provider',
  // A text model's model is chosen on the line-up's Translation card.
  model_missing: 'lineup',
  text_model_unset: 'lineup',
  // A managed provider signed out: the provider section's account row carries the sign-in link (Stage 2 Kizuna Soniox).
  sign_in_required: 'provider',
  // A model that is missing is downloaded in Local models and storage (owner, 2026-11-28): the WASM/WebGPU engine's
  // library, at the stage the notice names (`modelTarget` narrows them).
  local_models_missing: 'models-asr',
  no_asr: 'models-asr',
  memory_exceeded: 'provider-options',
  gpu_out_of_memory: 'provider-options',
  // Local Native's readiness codes (#578 ruling 5). Its engine is downloaded and updated on its card at the top of its
  // tab in Local models and storage, and its models under it (owner, 2026-11-28); the line-up does neither. Starting, or
  // unavailable, it is the provider's options.
  native_engine_update_required: 'native-engine',
  native_engine_required: 'native-engine',
  native_unavailable: 'provider-options',
  native_starting: 'provider-options',
  native_asr_missing: 'native-models-asr',
  native_translation_missing: 'native-models-translation',
  // The leg's turn detection is tuned among the provider's options; a device that cannot keep up picks a lighter model there.
  turn_detection_overloaded: 'provider-options',
  turn_detection_unavailable: 'provider-options',
  turn_mode_unsupported: 'turn-detection',
  participant_unsupported: 'languages',
  // Gemini's and OpenAI's model codes say the key lists no model: the fix is another key, in "Accounts and keys".
  no_realtime_model: 'provider',
  models_required: 'provider',
  // OpenAI Translate's check codes (Stage 2 OpenAI Translate): the key's own limits, in "Accounts and keys".
  no_translate_model: 'provider',
  region_unsupported: 'provider',
  // The run continues on another voice (spec 2026-10-05 §2): the voices are the provider's own
  // options. Not `voice-settings`: that id is the prebuilt-voice fields' and Soniox's voice
  // section, and the local voices are not drawn there.
  voice_clip_missing: 'provider-options',
  voice_pool_busy: 'provider-options',
  voice_build_failed: 'provider-options',
  voice_unavailable: 'provider-options',
  voice_fallback: 'provider-options',
};

/**
 * The codes about an account that lead to its row only when the notice names the provider: a key refused, or an
 * account out of credit, said by a text model (its check, its session). Named by no one else, so the end-to-end
 * providers' notices of the same codes offer nothing, as before.
 */
const NAMED_ACCOUNT_TARGETS: Readonly<Record<string, string>> = { auth: 'provider', quota: 'provider' };

/**
 * A missing model's place in Local models and storage, by what its notice says: the stage the WASM/WebGPU engine lacks
 * (`params.stage`, recognition when not said), and the native engine's library for a recognizer Local Native lacks.
 */
function modelTarget(code: string, params?: Readonly<Record<string, string | number>>): string | undefined {
  if (code === 'local_models_missing') return params?.stage === 'translation' ? 'models-translation' : 'models-asr';
  if (code === 'no_asr') return params?.provider === 'local_native' ? 'native-models-asr' : 'models-asr';
  return undefined;
}

/**
 * Where Settings fixes a notice. One about a key or a sign-in that names its provider (`params.provider`) lands on
 * that provider's row in "Accounts and keys"; without a name, on the accounts as before.
 */
export function settingsTargetForCode(code: string | undefined, params?: Readonly<Record<string, string | number>>): string | null {
  if (code === undefined) return null;
  const model = modelTarget(code, params);
  if (model) return model;
  const named = typeof params?.provider === 'string' && params.provider !== '';
  const target = NOTICE_TARGETS[code] ?? (named ? NAMED_ACCOUNT_TARGETS[code] : undefined) ?? null;
  const provider = params?.provider;
  return target === 'provider' && typeof provider === 'string' && provider !== '' ? providerTarget(provider) : target;
}
