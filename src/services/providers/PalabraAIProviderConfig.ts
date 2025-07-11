import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';

export class PalabraAIProviderConfig {
  // PalabraAI supported source languages (for recognition) based on their documentation
  private static readonly SOURCE_LANGUAGES: LanguageOption[] = [
    { name: 'العربية', value: 'ar', englishName: 'Arabic' },
    { name: 'Башҡорт теле', value: 'ba', englishName: 'Bashkir' },
    { name: 'Беларуская', value: 'be', englishName: 'Belarusian' },
    { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
    { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
    { name: 'Català', value: 'ca', englishName: 'Catalan' },
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'Čeština', value: 'cs', englishName: 'Czech' },
    { name: 'Cymraeg', value: 'cy', englishName: 'Welsh' },
    { name: 'Dansk', value: 'da', englishName: 'Danish' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: 'Esperanto', value: 'eo', englishName: 'Esperanto' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Eesti', value: 'et', englishName: 'Estonian' },
    { name: 'Euskera', value: 'eu', englishName: 'Basque' },
    { name: 'فارسی', value: 'fa', englishName: 'Persian' },
    { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
    { name: 'Français', value: 'fr', englishName: 'French' },
    { name: 'Gaeilge', value: 'ga', englishName: 'Irish' },
    { name: 'Galego', value: 'gl', englishName: 'Galician' },
    { name: 'עברית', value: 'he', englishName: 'Hebrew' },
    { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
    { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
    { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
    { name: 'Interlingua', value: 'ia', englishName: 'Interlingua' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Italiano', value: 'it', englishName: 'Italian' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
    { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
    { name: 'Монгол', value: 'mn', englishName: 'Mongolian' },
    { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
    { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
    { name: 'Malti', value: 'mt', englishName: 'Maltese' },
    { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
    { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
    { name: 'Polski', value: 'pl', englishName: 'Polish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'Română', value: 'ro', englishName: 'Romanian' },
    { name: 'Русский', value: 'ru', englishName: 'Russian' },
    { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
    { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
    { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
    { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
    { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
    { name: 'ไทย', value: 'th', englishName: 'Thai' },
    { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
    { name: 'ئۇيغۇرچە', value: 'ug', englishName: 'Uyghur' },
    { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
    { name: 'اردو', value: 'ur', englishName: 'Urdu' },
    { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  ];

  // PalabraAI supported target languages (for translation) based on their documentation
  private static readonly TARGET_LANGUAGES: LanguageOption[] = [
    { name: 'العربية (السعودية)', value: 'ar-sa', englishName: 'Arabic (Saudi)' },
    { name: 'العربية (الإمارات)', value: 'ar-ae', englishName: 'Arabic (UAE)' },
    { name: 'Azərbaycan', value: 'az', englishName: 'Azerbaijani' },
    { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
    { name: '中文 (简体)', value: 'zh', englishName: 'Chinese (Simplified)' },
    { name: '中文 (繁體)', value: 'zh-hant', englishName: 'Chinese (Traditional)' },
    { name: 'Čeština', value: 'cs', englishName: 'Czech' },
    { name: 'Dansk', value: 'da', englishName: 'Danish' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
    { name: 'English (US)', value: 'en-us', englishName: 'English (US)' },
    { name: 'English (Australia)', value: 'en-au', englishName: 'English (Australia)' },
    { name: 'English (Canada)', value: 'en-ca', englishName: 'English (Canada)' },
    { name: 'Español', value: 'es', englishName: 'Spanish (Spain)' },
    { name: 'Español (México)', value: 'es-mx', englishName: 'Spanish (Mexico)' },
    { name: 'Filipino', value: 'fil', englishName: 'Filipino' },
    { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
    { name: 'Français', value: 'fr', englishName: 'French (France)' },
    { name: 'Français (Canada)', value: 'fr-ca', englishName: 'French (Canada)' },
    { name: 'עברית', value: 'he', englishName: 'Hebrew' },
    { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
    { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
    { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Italiano', value: 'it', englishName: 'Italian' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
    { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
    { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
    { name: 'Polski', value: 'pl', englishName: 'Polish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese (Portugal)' },
    { name: 'Português (Brasil)', value: 'pt-br', englishName: 'Portuguese (Brazil)' },
    { name: 'Română', value: 'ro', englishName: 'Romanian' },
    { name: 'Русский', value: 'ru', englishName: 'Russian' },
    { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
    { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
    { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
    { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
    { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
    { name: 'Tiếng Việt', value: 'vn', englishName: 'Vietnamese' },
  ];

  // Combined languages for UI display (using source languages as base)
  private static readonly LANGUAGES: LanguageOption[] = PalabraAIProviderConfig.SOURCE_LANGUAGES;

  // Helper method to get target languages for a given source language
  static getTargetLanguagesForSource(sourceLanguage: string): LanguageOption[] {
    // Return all target languages - PalabraAI supports most language pairs
    return PalabraAIProviderConfig.TARGET_LANGUAGES;
  }

  // PalabraAI voice options based on their API documentation
  private static readonly VOICES: VoiceOption[] = [
    { name: 'Default Low', value: 'default_low' },
    { name: 'Default High', value: 'default_high' },
  ];

  // PalabraAI doesn't have model selection - it's a single WebRTC service
  private static readonly MODELS: ModelOption[] = [
    { id: 'realtime-translation', type: 'realtime' }
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'palabraai',
      displayName: 'PalabraAI',
      
      apiKeyLabel: 'Client ID',
      apiKeyPlaceholder: 'Enter your PalabraAI Client ID',
      
      languages: PalabraAIProviderConfig.LANGUAGES,
      voices: PalabraAIProviderConfig.VOICES,
      models: PalabraAIProviderConfig.MODELS,
      noiseReductionModes: [], // PalabraAI handles audio processing internally
      transcriptModels: [], // PalabraAI handles transcription internally
      
      capabilities: {
        hasTemplateMode: false, // PalabraAI doesn't use template mode
        hasTurnDetection: false, // PalabraAI handles turn detection automatically
        hasVoiceSettings: true, // PalabraAI has voice_id setting
        hasNoiseReduction: false, // PalabraAI handles audio processing internally
        hasModelConfiguration: false, // PalabraAI doesn't have temperature/tokens settings
        
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
        model: '', // PalabraAI doesn't use model selection
        voice: 'default_low',
        temperature: 0.8, // Not used by PalabraAI
        maxTokens: 4096, // Not used by PalabraAI
        sourceLanguage: 'en', // English for recognition
        targetLanguage: 'es', // Spanish for translation
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