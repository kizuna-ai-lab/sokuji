import { ProviderConfig, ModelOption } from './ProviderConfig';
import { getTranslationSourceLanguages } from '../../lib/local-inference/modelManifest';

/**
 * Provider configuration for Local (Offline) inference.
 * Uses sherpa-onnx ASR + Opus-MT translation + Piper TTS.
 *
 * Languages are derived dynamically from the model manifest.
 */
export class LocalInferenceProviderConfig {
  private static readonly MODELS: ModelOption[] = [
    { id: 'local-asr-translate', type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'local_inference',
      displayName: 'Local (Offline)',

      apiKeyLabel: '',
      apiKeyPlaceholder: '',

      languages: getTranslationSourceLanguages(),
      voices: [],
      models: LocalInferenceProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: false,
        hasVoiceSettings: false,
        hasNoiseReduction: false,
        hasModelConfiguration: false,

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
        model: 'local-asr-translate',
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
