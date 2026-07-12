import { ProviderConfig, ModelOption } from './ProviderConfig';
import { getTranslationSourceLanguages } from '../../lib/local-inference/modelManifest';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { BaseProviderDescriptor, Credentials, CredentialCtx, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, LocalNativeSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { LocalNativeClient } from '../clients/LocalNativeClient';
import { resolveNativeTts, resolveNativeTranslation } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
// nativeModelStore imports no provider modules, so this store read introduces
// no cycle; the descriptor needs the sidecar catalog for TTS auto-resolution.
import { useNativeModelStore } from '../../stores/nativeModelStore';

/**
 * Native (Electron sidecar) provider settings. Keeps field parity with
 * LocalInferenceSettings where the shared local settings UI components
 * (speech mode, VAD, prompt, TTS speed) need it.
 */
export interface LocalNativeSettings {
  asrModel: string;          // sidecar ASR model id (e.g. 'sense-voice', 'whisper-tiny')
  translationModel: string;  // '' (auto) | LLM id (e.g. 'qwen2.5-0.5b')
  // Per-model chosen quant variant (e.g. { 'hy-mt2-1.8b': 'fp8' }). A model with no
  // entry uses the sidecar's recommended variant. Keyed by model id (global across
  // language directions); drives which repo the card downloads AND the load pin.
  translationVariantByModel: Record<string, string>;
  ttsModel: string;          // '' = Auto (default voice) | a specific piper voice id
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
  asrModel: 'sense-voice',
  translationModel: 'qwen2.5-0.5b',  // explicit default LLM; opus-mt selectable per language pair
  ttsModel: '',          // '' = Auto (default voice for the target); text-only via the textOnly toggle
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
  translationVariantByModel: {},
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
 * piper TTS when a model is available for the target language. Model lists +
 * resolution live in nativeCatalog. The engine defaults the translate prompt,
 * so instructions are advisory.
 */
export function createLocalNativeSessionConfig(
  settings: LocalNativeSettings,
  systemInstructions: string,
  catalog: Record<string, NativeModelInfo> = {},
): LocalNativeSessionConfig {
  const wrapTranscript = resolveWrapTranscript(
    settings.sourceLanguage, settings.targetLanguage, settings.useTemplateMode, systemInstructions);

  return {
    provider: 'local_native',
    model: 'native-asr-translate',
    instructions: systemInstructions,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    asrModelId: settings.asrModel,
    translationModelId: resolveNativeTranslation(settings.translationModel),
    // Manual variant pin → load's select_variant(pin=...) so LOAD resolves the same
    // variant DOWNLOAD fetched (else local_files_only load fails on a missing repo).
    translationVariant: settings.translationVariantByModel[settings.translationModel],
    // translationVariantByModel is the GENERIC per-model quant-pin map (keyed
    // by model id — ids never collide across stages); ASR pins live there too.
    asrVariant: settings.translationVariantByModel[settings.asrModel],
    ttsModelId: resolveNativeTts(settings.ttsModel, settings.targetLanguage, catalog),
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

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    // TTS auto-resolution needs the sidecar's per-machine catalog; read it at
    // build time — before the sidecar responds it is {} and TTS stays off,
    // matching the builder's default-catalog semantics.
    const catalog = useNativeModelStore.getState().catalog;
    return createLocalNativeSessionConfig(slice as LocalNativeSettings, systemInstructions, catalog);
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
      },
    };
  }
}
