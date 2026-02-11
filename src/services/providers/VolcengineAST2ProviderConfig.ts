import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';

export class VolcengineAST2ProviderConfig {
  // AST 2.0 supported languages (s2s mode)
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Français', value: 'fr', englishName: 'French' },
  ];

  // Bidirectional language pair
  private static readonly BIDIRECTIONAL_LANGUAGES: LanguageOption[] = [
    ...VolcengineAST2ProviderConfig.LANGUAGES,
    { name: '中英双语 (zh↔en)', value: 'zhen', englishName: 'Chinese-English Bidirectional' },
  ];

  // No voice selection - server auto-clones speaker voice in s2s mode
  private static readonly VOICES: VoiceOption[] = [];

  private static readonly MODELS: ModelOption[] = [
    { id: 'ast-v2-s2s', type: 'realtime' }
  ];

  static getSourceLanguages(): LanguageOption[] {
    return VolcengineAST2ProviderConfig.BIDIRECTIONAL_LANGUAGES;
  }

  static getTargetLanguages(): LanguageOption[] {
    return VolcengineAST2ProviderConfig.LANGUAGES;
  }

  getConfig(): ProviderConfig {
    return {
      id: 'volcengine_ast2',
      displayName: 'Volcengine AST',

      apiKeyLabel: 'App Key',
      apiKeyPlaceholder: 'Enter your Volcengine App Key',

      languages: VolcengineAST2ProviderConfig.LANGUAGES,
      voices: VolcengineAST2ProviderConfig.VOICES,
      models: VolcengineAST2ProviderConfig.MODELS,
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
        model: 'ast-v2-s2s',
        voice: '',
        temperature: 0.8,
        maxTokens: 4096,
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        turnDetectionMode: 'Auto',
        threshold: 0.5,
        prefixPadding: 0.0,
        silenceDuration: 0.0,
        semanticEagerness: 'Auto',
        noiseReduction: 'None',
        transcriptModel: 'auto',
      },
    };
  }
}
