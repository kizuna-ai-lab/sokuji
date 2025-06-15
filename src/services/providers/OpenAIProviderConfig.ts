import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';

export class OpenAIProviderConfig {
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: 'العربية', value: 'ar' },
    { name: 'አማርኛ', value: 'am' },
    { name: 'Български', value: 'bg' },
    { name: 'বাংলা', value: 'bn' },
    { name: 'Català', value: 'ca' },
    { name: 'Čeština', value: 'cs' },
    { name: 'Dansk', value: 'da' },
    { name: 'Deutsch', value: 'de' },
    { name: 'Ελληνικά', value: 'el' },
    { name: 'English', value: 'en' },
    { name: 'English (Australia)', value: 'en_AU' },
    { name: 'English (Great Britain)', value: 'en_GB' },
    { name: 'English (USA)', value: 'en_US' },
    { name: 'Español', value: 'es' },
    { name: 'Español (Latinoamérica)', value: 'es_419' },
    { name: 'Eesti', value: 'et' },
    { name: 'فارسی', value: 'fa' },
    { name: 'Suomi', value: 'fi' },
    { name: 'Filipino', value: 'fil' },
    { name: 'Français', value: 'fr' },
    { name: 'ગુજરાતી', value: 'gu' },
    { name: 'עברית', value: 'he' },
    { name: 'हिन्दी', value: 'hi' },
    { name: 'Hrvatski', value: 'hr' },
    { name: 'Magyar', value: 'hu' },
    { name: 'Bahasa Indonesia', value: 'id' },
    { name: 'Italiano', value: 'it' },
    { name: '日本語', value: 'ja' },
    { name: 'ಕನ್ನಡ', value: 'kn' },
    { name: '한국어', value: 'ko' },
    { name: 'Lietuvių', value: 'lt' },
    { name: 'Latviešu', value: 'lv' },
    { name: 'മലയാളം', value: 'ml' },
    { name: 'मराठी', value: 'mr' },
    { name: 'Bahasa Melayu', value: 'ms' },
    { name: 'Nederlands', value: 'nl' },
    { name: 'Norsk', value: 'no' },
    { name: 'Polski', value: 'pl' },
    { name: 'Português (Brasil)', value: 'pt_BR' },
    { name: 'Português (Portugal)', value: 'pt_PT' },
    { name: 'Română', value: 'ro' },
    { name: 'Русский', value: 'ru' },
    { name: 'Slovenčina', value: 'sk' },
    { name: 'Slovenščina', value: 'sl' },
    { name: 'Српски', value: 'sr' },
    { name: 'Svenska', value: 'sv' },
    { name: 'Kiswahili', value: 'sw' },
    { name: 'தமிழ்', value: 'ta' },
    { name: 'తెలుగు', value: 'te' },
    { name: 'ไทย', value: 'th' },
    { name: 'Türkçe', value: 'tr' },
    { name: 'Українська', value: 'uk' },
    { name: 'Tiếng Việt', value: 'vi' },
    { name: '中文 (中国)', value: 'zh_CN' },
    { name: '中文 (台灣)', value: 'zh_TW' },
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