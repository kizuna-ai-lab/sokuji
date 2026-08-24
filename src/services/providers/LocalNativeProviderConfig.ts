import { ProviderConfig, ModelOption } from './ProviderConfig';
import { getTranslationSourceLanguages } from '../../lib/local-inference/modelManifest';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { BaseProviderDescriptor, Credentials, CredentialCtx, ClientOptions, ParticipantNotice, ParticipantSessionResult, PreparePorts, PrepareOutcome, type CredentialField } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, LocalNativeSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { LocalNativeClient } from '../clients/LocalNativeClient';
// nativeModelStore imports no provider modules, so this store read introduces
// no cycle; the descriptor needs it for resolve() (catalog + download status).
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { createParticipantLocalNativeConfig } from './localParticipantConfig';
import type { DirectionResult, Selections } from '../../lib/local-inference/selection/types';
import i18n from '../../locales';

/**
 * Native (Electron sidecar) provider settings. Keeps field parity with
 * LocalInferenceSettings where the shared local settings UI components
 * (speech mode, VAD, prompt, TTS speed) need it.
 */
export interface LocalNativeSettings {
  /** Per-direction model choices, keyed `src→tgt`. '' in any stage means auto,
   *  and `selections[dir][stage].variant` is the pinned quant for that stage's
   *  chosen model — the direction/stage-scoped replacement for the old global
   *  `translationVariantByModel` map. */
  selections: Selections;
  sourceLanguage: string;
  targetLanguage: string;
  // Parity with LocalInferenceSettings — same fields/defaults so the shared
  // settings UI components work for both providers.
  ttsSpeed: number;                    // 0.5-2.0 piper speed (sherpa OfflineTts)
  turnDetectionMode: 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';
  vadThreshold: number;                // 0.0-1.0 silero speech threshold
  vadMinSilenceDuration: number;       // seconds — silero min_silence_duration
  vadMinSpeechDuration: number;        // seconds — silero min_speech_duration
  useTemplateMode: boolean;            // true = Simple (default), false = Advanced
  systemPrompt: string;                // Advanced-mode prompt (Qwen path only; '' = default)
  asrDevice: 'auto' | 'cpu' | 'cuda'; // override the sidecar's device selection
  translationDevice: 'auto' | 'cpu' | 'cuda'; // override the sidecar's translation device selection
  ttsDevice: 'auto' | 'cpu' | 'cuda'; // override the sidecar's tts device selection
  ttsVoice: string;                   // override the sidecar's tts voice selection ('' = per-language default)
}

export const defaultLocalNativeSettings: LocalNativeSettings = {
  selections: {},
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  ttsSpeed: 1.0,
  turnDetectionMode: 'Auto',
  vadThreshold: 0.3,
  vadMinSilenceDuration: 1.4,
  vadMinSpeechDuration: 0.4,
  useTemplateMode: true,
  systemPrompt: '',
  asrDevice: 'auto',
  translationDevice: 'auto',
  ttsDevice: 'auto',
  ttsVoice: '',
};

/**
 * wrapTranscript must match the instructions actually in use. The default prompt
 * (buildDefaultLocalPrompt) references "<transcript> tags", so if the instructions
 * came from it the user message MUST be wrapped. This also catches the Advanced-mode
 * empty-field fallback where the selector returns the default prompt but
 * useTemplateMode is still false. (LocalInferenceProviderConfig inlines the same rule.)
 */
export function resolveWrapTranscript(
  sourceLanguage: string, targetLanguage: string, useTemplateMode: boolean, systemInstructions: string
): boolean {
  const defaultFwd = buildDefaultLocalPrompt(sourceLanguage, targetLanguage);
  const defaultRev = buildDefaultLocalPrompt(targetLanguage, sourceLanguage);
  return useTemplateMode || systemInstructions === defaultFwd || systemInstructions === defaultRev;
}

/**
 * Build the native (Electron sidecar) session config. ASR + translation, plus
 * piper TTS when a model is available for the target language. `resolved` is
 * the direction's already-computed `resolve()` output (catalog membership,
 * download status, and hardware gating all folded in) — this function stays
 * pure/data-in, no store reads of its own. The engine defaults the translate
 * prompt, so instructions are advisory.
 */
export function createLocalNativeSessionConfig(
  settings: LocalNativeSettings,
  systemInstructions: string,
  resolved: DirectionResult,
): LocalNativeSessionConfig {
  const wrapTranscript = resolveWrapTranscript(
    settings.sourceLanguage, settings.targetLanguage, settings.useTemplateMode, systemInstructions);

  return {
    provider: 'local_native',
    model: 'native-asr-translate',
    instructions: systemInstructions,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    // asrModelId is non-optional on LocalNativeSessionConfig — a missing
    // resolution becomes '' exactly like the old empty-string field did; the
    // Start gate already blocks a session whose speaker ASR can't resolve.
    asrModelId: resolved.asr?.modelId ?? '',
    translationModelId: resolved.translation?.modelId,
    // Manual variant pin → load's select_variant(pin=...) so LOAD resolves the same
    // variant DOWNLOAD fetched (else local_files_only load fails on a missing repo).
    // resolve() only carries a variant for an EXPLICIT, currently-usable pick
    // (a stage's variant is always absent under auto) — replaces the old
    // global `translationVariantByModel[modelId]` lookup.
    translationVariant: resolved.translation?.variant,
    // Same per-stage variant contract as translationVariant above.
    asrVariant: resolved.asr?.variant,
    ttsModelId: resolved.tts?.modelId,
    ttsVariant: resolved.tts?.variant,
    ttsSpeed: settings.ttsSpeed,
    vadThreshold: settings.vadThreshold,
    vadMinSilenceDuration: settings.vadMinSilenceDuration,
    vadMinSpeechDuration: settings.vadMinSpeechDuration,
    turnDetectionMode: settings.turnDetectionMode,
    wrapTranscript,
    asrDevice: settings.asrDevice,
    translationDevice: settings.translationDevice,
    ttsDevice: settings.ttsDevice,
    ttsVoice: settings.ttsVoice,
  };
}

/**
 * Provider descriptor for Local (Native) inference — Electron only.
 * Runs ASR + translation (+ optional TTS) in the Python sidecar over localhost
 * WebSocket. Separate from the WASM LOCAL_INFERENCE provider.
 */
export class LocalNativeProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'localNative';
  readonly supportsWebRTC = false;
  readonly credentialFields: CredentialField[] = [];

  // LocalNative has no credentials by design — settingsStore's LOCAL_NATIVE
  // arm short-circuits validateApiKey before extractCredentials is ever called
  // (gates on sidecar/model readiness), so this always reports ok with an
  // empty primary.
  async extractCredentials(_slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    return { ok: true, primary: '' };
  }

  peekPrimaryCredential(): string {
    return '';
  }

  createClient(_creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new LocalNativeClient();
  }

  // Readiness for LOCAL_NATIVE is model-based, not credential-based: settingsStore's
  // LOCAL_NATIVE arm short-circuits before ever calling this (it gates on the sidecar
  // lifecycle + nativeModelStore readiness).
  async validateAndFetchModels(_creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    return { validation: { valid: false, message: 'local native readiness is model-based', validating: false }, models: [] };
  }

  /** Pre-start model-readiness revalidation. validateApiKey is the single
   *  authority for session readiness — auto-select, model readiness, key
   *  validation — and it must run as the STORE action (its isApiKeyValid
   *  write is what closes the Start gate and flips the subtitle window to
   *  'blocked' on failure), so it arrives here through ports.revalidate. */
  async prepareToStart(_slice: unknown, ports: PreparePorts): Promise<PrepareOutcome> {
    const result = await ports.revalidate();
    if (result.valid) return { ok: true };
    return {
      ok: false,
      message: result.message
        || i18n.t('settings.localInferenceModelsRequired', 'Required models not available for selected language pair.'),
    };
  }

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    // resolve() needs the sidecar's per-machine catalog + live download status;
    // read it at build time — before the sidecar responds, catalog/statuses
    // are both {} and every stage resolves to null, matching the builder's
    // old default-catalog (TTS-off) semantics.
    const settings = slice as LocalNativeSettings;
    const resolved = useNativeModelStore.getState().resolve(
      settings.sourceLanguage, settings.targetLanguage, settings.selections);
    return createLocalNativeSessionConfig(settings, systemInstructions, resolved);
  }

  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult {
    const base = super.buildParticipantSessionConfig(slice, swappedInstructions, shell);
    // Native ASR/translate carry the translation direction in
    // sourceLanguage/targetLanguage AND in the chosen model ids (a directional
    // Opus model bakes the direction in; a source-specific ASR only handles one
    // language). Reverse the direction and re-resolve both models for the
    // reversed pair — see createParticipantLocalNativeConfig.
    const result = createParticipantLocalNativeConfig(base.config as LocalNativeSessionConfig, (slice as LocalNativeSettings).selections);

    if (!result.success) {
      return { config: null, notices: [{ channel: 'error', message: result.detail }] };
    }

    const notices: ParticipantNotice[] = [];

    if (!result.translationAvailable) {
      notices.push({ channel: 'warning', message: `No translation model for ${result.config.sourceLanguage} → ${result.config.targetLanguage} — transcription only` });
    }

    return { config: result.config, notices };
  }

  private static readonly MODELS: ModelOption[] = [
    { id: 'native-asr-translate', type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'local_native',
      displayName: 'Local (Native, Electron)',

      apiKeyLabel: '',
      apiKeyPlaceholder: '',

      languages: getTranslationSourceLanguages(),
      voices: [],
      models: LocalNativeProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: false,
        hasVoiceSettings: false,
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'optional',

        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },

        temperatureRange: { min: 0.0, max: 1.0, step: 0.1 },
        maxTokensRange: { min: 1, max: 4096, step: 1 },

        pushGatedModes: ['Push-to-Talk', 'Push-to-Translate'],
        supportsTextInput: true,
        usesLocalPromptTemplate: true,
        // Silero VAD needs a 700 ms silence tail to detect end-of-speech;
        // createResponse always follows — for streaming ASR it flushes the
        // pending utterance, for offline ASR it is harmless.
        pttFinalization: { silenceTailFrames: 7, response: 'always' },
      },
    };
  }
}
