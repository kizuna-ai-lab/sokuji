import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';

export class OpenAIProviderConfig {
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: 'العربية', value: 'ar', englishName: 'Arabic' },
    { name: 'አማርኛ', value: 'am', englishName: 'Amharic' },
    { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
    { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
    { name: 'Català', value: 'ca', englishName: 'Catalan' },
    { name: 'Čeština', value: 'cs', englishName: 'Czech' },
    { name: 'Dansk', value: 'da', englishName: 'Danish' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: 'English (Australia)', value: 'en_AU', englishName: 'English (Australia)' },
    { name: 'English (Great Britain)', value: 'en_GB', englishName: 'English (Great Britain)' },
    { name: 'English (USA)', value: 'en_US', englishName: 'English (USA)' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Español (Latinoamérica)', value: 'es_419', englishName: 'Spanish (Latin America and Caribbean)' },
    { name: 'Eesti', value: 'et', englishName: 'Estonian' },
    { name: 'فارسی', value: 'fa', englishName: 'Persian' },
    { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
    { name: 'Filipino', value: 'fil', englishName: 'Filipino' },
    { name: 'Français', value: 'fr', englishName: 'French' },
    { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
    { name: 'עברית', value: 'he', englishName: 'Hebrew' },
    { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
    { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
    { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Italiano', value: 'it', englishName: 'Italian' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'ಕನ್ನಡ', value: 'kn', englishName: 'Kannada' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
    { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
    { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
    { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
    { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
    { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
    { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
    { name: 'Polski', value: 'pl', englishName: 'Polish' },
    { name: 'Português (Brasil)', value: 'pt_BR', englishName: 'Portuguese (Brazil)' },
    { name: 'Português (Portugal)', value: 'pt_PT', englishName: 'Portuguese (Portugal)' },
    { name: 'Română', value: 'ro', englishName: 'Romanian' },
    { name: 'Русский', value: 'ru', englishName: 'Russian' },
    { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
    { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
    { name: 'Српски', value: 'sr', englishName: 'Serbian' },
    { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
    { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
    { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
    { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
    { name: 'ไทย', value: 'th', englishName: 'Thai' },
    { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
    { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
    { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
    { name: '中文 (中国)', value: 'zh_CN', englishName: 'Chinese (China)' },
    { name: '中文 (台灣)', value: 'zh_TW', englishName: 'Chinese (Taiwan)' },
  ];

  private static readonly VOICES: VoiceOption[] = [
    { name: 'Alloy', value: 'alloy' },
    { name: 'Ash', value: 'ash' },
    { name: 'Ballad', value: 'ballad' },
    { name: 'Coral', value: 'coral' },
    { name: 'Echo', value: 'echo' },
    { name: 'Sage', value: 'sage' },
    { name: 'Shimmer', value: 'shimmer' },
    { name: 'Verse', value: 'verse' },
  ];

  private static readonly MODELS: ModelOption[] = [
    { id: 'gpt-4o-realtime-preview', type: 'realtime' },
    { id: 'gpt-4o-mini-realtime-preview', type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'openai',
      displayName: 'OpenAI',
      
      apiKeyLabel: 'OpenAI API Key',
      apiKeyPlaceholder: 'Enter your OpenAI API key',
      
      languages: OpenAIProviderConfig.LANGUAGES,
      voices: OpenAIProviderConfig.VOICES,
      models: OpenAIProviderConfig.MODELS,
      noiseReductionModes: ['None', 'Near field', 'Far field'],
      transcriptModels: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
      
      capabilities: {
        hasTemplateMode: true,
        hasTurnDetection: true,
        hasVoiceSettings: true,
        hasNoiseReduction: true,
        hasModelConfiguration: true,
        
        turnDetection: {
          modes: ['Normal', 'Semantic', 'Disabled'],
          hasThreshold: true,
          hasPrefixPadding: true,
          hasSilenceDuration: true,
          hasSemanticEagerness: true,
        },
        
        temperatureRange: { min: 0.6, max: 1.2, step: 0.01 },
        maxTokensRange: { min: 1, max: 4096, step: 1 },
      },
      
      defaults: {
        model: 'gpt-4o-realtime-preview',
        voice: 'alloy',
        temperature: 0.8,
        maxTokens: 4096,
        sourceLanguage: 'en',
        targetLanguage: 'zh_CN',
        turnDetectionMode: 'Normal',
        threshold: 0.5,
        prefixPadding: 0.3,
        silenceDuration: 0.8,
        semanticEagerness: 'Auto',
        noiseReduction: 'None',
        transcriptModel: 'gpt-4o-mini-transcribe',
      },
    };
  }
} 