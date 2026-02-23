import { ProviderConfig, LanguageOption, ModelOption } from './ProviderConfig';

/**
 * Provider configuration for Local (Offline) inference.
 * Uses sherpa-onnx ASR + Opus-MT translation + Piper TTS.
 *
 * Source languages are constrained by ASR model support (SenseVoice: ja/zh/en/ko).
 * Target languages are constrained by available Opus-MT translation pairs.
 */
export class LocalInferenceProviderConfig {
  // Source languages supported by SenseVoice ASR
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Français', value: 'fr', englishName: 'French' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
  ];

  private static readonly MODELS: ModelOption[] = [
    { id: 'local-asr-translate', type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'local_inference',
      displayName: 'Local (Offline)',

      apiKeyLabel: '',
      apiKeyPlaceholder: '',

      languages: LocalInferenceProviderConfig.LANGUAGES,
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
