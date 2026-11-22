import { describe, it, expect } from 'vitest';
import { PLAN_REFUSAL_CODES } from '../plan/types';
import { NOTICE_TARGETS, settingsTargetForCode } from './noticeTargets';
import { NOTICE_ALIASES, NOTICE_WORDS } from './noticeText';

describe('settingsTargetForCode', () => {
  it('sends a missing microphone to the microphone section', () => {
    expect(settingsTargetForCode('no_microphone')).toBe('microphone');
  });

  // On the settings page a key is in "Accounts and keys"; models and the engine are the provider's own options in the line-up.
  it("sends a missing key to the accounts, a missing model to the provider's options, and no provider to the line-up", () => {
    expect(settingsTargetForCode('credentials_missing')).toBe('provider');
    expect(settingsTargetForCode('no_provider')).toBe('lineup');
    for (const code of ['no_asr', 'memory_exceeded', 'gpu_out_of_memory', 'local_models_missing']) {
      expect(settingsTargetForCode(code), code).toBe('provider-options');
    }
  });

  it("sends a key or a sign-in that names its provider to that provider's row", () => {
    expect(settingsTargetForCode('credentials_missing', { provider: 'soniox' })).toBe('provider:soniox');
    expect(settingsTargetForCode('sign_in_required', { provider: 'kizunaai_soniox' })).toBe('provider:kizunaai_soniox');
    expect(settingsTargetForCode('credentials_missing', {})).toBe('provider');
    expect(settingsTargetForCode('credentials_missing', { provider: '' })).toBe('provider');
    // Only a target in the accounts is narrowed to a row.
    expect(settingsTargetForCode('lineup_voice_not_alone', { provider: 'kizunaai_soniox', stage: 'speech' })).toBe('lineup');
    expect(settingsTargetForCode('no_asr', { provider: 'local_inference' })).toBe('provider-options');
  });

  it('sends every refusal of the line-up to the line-up', () => {
    for (const code of PLAN_REFUSAL_CODES) expect(settingsTargetForCode(code), code).toBe('lineup');
  });

  it('sends an unsupported turn mode to the turn-detection section', () => {
    expect(settingsTargetForCode('turn_mode_unsupported')).toBe('turn-detection');
  });

  it("sends an unsupported participant pair to the languages section", () => {
    expect(settingsTargetForCode('participant_unsupported')).toBe('languages');
  });

  it('has no target for a code with no fix in Settings, or no code at all', () => {
    expect(settingsTargetForCode('start_failed')).toBeNull();
    expect(settingsTargetForCode('loopback_denied')).toBeNull();
    expect(settingsTargetForCode(undefined)).toBeNull();
  });

  it("sends a signed-out managed provider to the provider section, where its account row's sign-in link is", () => {
    expect(settingsTargetForCode('sign_in_required')).toBe('provider');
    // Waiting, or the balance: nothing in Settings fixes them (the old gate's quota-unknown had no target either).
    for (const code of ['sign_in_pending', 'balance_below_floor', 'quota_pending', 'quota_unknown']) {
      expect(settingsTargetForCode(code), code).toBeNull();
    }
  });

  it("sends Gemini's model codes to the provider section, where its key and its model are", () => {
    expect(settingsTargetForCode('no_realtime_model')).toBe('provider');
    expect(settingsTargetForCode('models_required')).toBe('provider');
  });

  it("sends OpenAI Translate's check codes to the provider section, where its key and the provider choice are", () => {
    expect(settingsTargetForCode('no_translate_model')).toBe('provider');
    expect(settingsTargetForCode('region_unsupported')).toBe('provider');
  });

  it("a text model's codes (text models, part B): its address in its row, its model on the line-up, and a key refused or credit spent in its row only when the notice names it", () => {
    expect(settingsTargetForCode('address_missing', { provider: 'openai_compatible' })).toBe('provider:openai_compatible');
    expect(settingsTargetForCode('address_invalid', { provider: 'openai_compatible' })).toBe('provider:openai_compatible');
    expect(settingsTargetForCode('model_missing')).toBe('lineup');
    expect(settingsTargetForCode('text_model_unset')).toBe('lineup');
    expect(settingsTargetForCode('auth', { provider: 'gemini_text' })).toBe('provider:gemini_text');
    expect(settingsTargetForCode('quota', { provider: 'openai_text' })).toBe('provider:openai_text');
    // Unnamed, as every end-to-end provider's own, they lead nowhere, as before.
    expect(settingsTargetForCode('auth')).toBeNull();
    expect(settingsTargetForCode('quota')).toBeNull();
  });

  it('has words for every code it targets, its own or an alias — an action never sits beside an unworded notice', () => {
    for (const code of Object.keys(NOTICE_TARGETS)) {
      expect(NOTICE_WORDS[code] ?? NOTICE_ALIASES[code], code).toBeDefined();
    }
  });
});
