import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';

export class VolcengineSTProviderConfig {
  // Volcengine Real-time Speech Translation supported source languages
  // Based on API documentation: zh, ja, en
  private static readonly SOURCE_LANGUAGES: LanguageOption[] = [
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'English', value: 'en', englishName: 'English' },
  ];

  // Volcengine supported target languages
  // Full list aligned with text translation API
  private static readonly TARGET_LANGUAGES: LanguageOption[] = [
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'Français', value: 'fr', englishName: 'French' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Italiano', value: 'it', englishName: 'Italian' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'Русский', value: 'ru', englishName: 'Russian' },
    { name: 'العربية', value: 'ar', englishName: 'Arabic' },
    { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
    { name: 'ไทย', value: 'th', englishName: 'Thai' },
    { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
    { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
    { name: 'Polski', value: 'pl', englishName: 'Polish' },
    { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
    { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
    { name: 'Čeština', value: 'cs', englishName: 'Czech' },
    { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
    { name: 'Dansk', value: 'da', englishName: 'Danish' },
    { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
    { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
    { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
    { name: 'עברית', value: 'he', englishName: 'Hebrew' },
    { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  ];

  // Combined languages for UI display (using source languages as base)
  private static readonly LANGUAGES: LanguageOption[] = VolcengineSTProviderConfig.SOURCE_LANGUAGES;

  // Helper method to get target languages
  static getTargetLanguages(): LanguageOption[] {
    return VolcengineSTProviderConfig.TARGET_LANGUAGES;
  }

  // Helper method to get source languages
  static getSourceLanguages(): LanguageOption[] {
    return VolcengineSTProviderConfig.SOURCE_LANGUAGES;
  }

  // Volcengine doesn't have voice selection for real-time translation (text output only)
  private static readonly VOICES: VoiceOption[] = [];

  // Volcengine real-time speech translation model
  private static readonly MODELS: ModelOption[] = [
    { id: 'speech-translate-v1', type: 'realtime' }
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'volcengine_st',
      displayName: 'Volcengine Speech Translate',

      apiKeyLabel: 'Access Key ID',
      apiKeyPlaceholder: 'Enter your Volcengine Access Key ID',

      languages: VolcengineSTProviderConfig.LANGUAGES,
      voices: VolcengineSTProviderConfig.VOICES,
      models: VolcengineSTProviderConfig.MODELS,
      noiseReductionModes: [], // Volcengine handles audio processing internally
      transcriptModels: [], // Volcengine handles transcription internally

      capabilities: {
        hasTemplateMode: false, // Volcengine doesn't use template mode - it's a dedicated translation service
        hasTurnDetection: false, // Volcengine handles turn detection automatically
        hasVoiceSettings: false, // Real-time translation outputs text only
        hasNoiseReduction: false, // Volcengine handles audio processing internally
        hasModelConfiguration: false, // Volcengine doesn't have temperature/tokens settings

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
        model: 'speech-translate-v1',
        voice: '',
        temperature: 0.8, // Not used by Volcengine
        maxTokens: 4096, // Not used by Volcengine
        sourceLanguage: 'zh', // Chinese for recognition
        targetLanguage: 'en', // English for translation
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
