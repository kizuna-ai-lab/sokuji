import { ProviderConfig, ModelOption } from './ProviderConfig';
import { getTranslationSourceLanguages } from '../../lib/local-inference/modelManifest';

/**
 * Provider configuration for Local (Native) inference — Electron only.
 * Runs ASR + translation (+ optional TTS) in the Python sidecar over localhost
 * WebSocket. Separate from the WASM LOCAL_INFERENCE provider.
 */
export class LocalNativeProviderConfig {
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

      defaults: {
        model: 'native-asr-translate',
        voice: '',
        temperature: 0.8,
        maxTokens: 4096,
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        turnDetectionMode: 'Auto',
        threshold: 0.5,
        prefixPadding: 0.0,
        silenceDuration: 0.0,
        semanticEagerness: 'Auto',
        noiseReduction: 'None',
        transcriptModel: '',
      },
    };
  }
}
