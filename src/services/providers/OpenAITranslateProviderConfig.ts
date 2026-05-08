import { ProviderConfig, LanguageOption, ModelOption } from './ProviderConfig';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';

/**
 * OpenAI Translate provider — dedicated speech-to-speech translation via
 * gpt-realtime-translate. Supports 70+ source languages (auto-detected) and
 * 13 target output languages.
 */
export class OpenAITranslateProviderConfig {
  // 13 target languages supported by gpt-realtime-translate.
  // Codes are coarse (zh, pt — not zh_CN, pt_BR) per API requirement.
  private static readonly TARGET_LANGUAGES: LanguageOption[] = [
    { name: 'English', value: 'en', englishName: 'English' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'Français', value: 'fr', englishName: 'French' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'Русский', value: 'ru', englishName: 'Russian' },
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
    { name: 'Italiano', value: 'it', englishName: 'Italian' },
  ];

  // Static fallback model list — runtime fetches the real list from /v1/models.
  private static readonly MODELS: ModelOption[] = [
    { id: 'gpt-realtime-translate', type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    // Reuse OpenAI's full source language list (75-language API support is
    // covered by the existing list; remaining codes are unusual and degrade
    // gracefully — source language is UI-only anyway).
    const sourceLanguages = new OpenAIProviderConfig().getConfig().languages;

    return {
      id: 'openai_translate',
      displayName: 'OpenAI Translate',
      apiKeyLabel: 'OpenAI API Key',
      apiKeyPlaceholder: 'sk-...',

      languages: sourceLanguages,
      targetLanguages: OpenAITranslateProviderConfig.TARGET_LANGUAGES,
      voices: [],
      models: OpenAITranslateProviderConfig.MODELS,
      noiseReductionModes: ['None', 'Near field', 'Far field'],
      transcriptModels: ['gpt-realtime-whisper'],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: false,
        hasVoiceSettings: false,
        hasNoiseReduction: true,
        hasModelConfiguration: false,
        hasReasoningEffort: false,
        textOnlyCapability: 'never',

        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },

        // Unused — capability flags above hide the corresponding UI sections,
        // but the fields are required by the type.
        temperatureRange: { min: 0, max: 0, step: 0 },
        maxTokensRange: { min: 0, max: 0, step: 0 },
      },

      defaults: {
        model: 'gpt-realtime-translate',
        voice: '',
        temperature: 0,
        maxTokens: 0,
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        turnDetectionMode: '',
        threshold: 0,
        prefixPadding: 0,
        silenceDuration: 0,
        semanticEagerness: '',
        noiseReduction: 'None',
        transcriptModel: 'gpt-realtime-whisper',
      },
    };
  }
}
