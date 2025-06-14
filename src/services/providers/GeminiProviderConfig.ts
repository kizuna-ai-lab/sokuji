import { BaseProviderConfig, ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';

export class GeminiProviderConfig extends BaseProviderConfig {
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: 'English (United States)', value: 'en-US' },
    { name: 'English (Australia)', value: 'en-AU' },
    { name: 'English (United Kingdom)', value: 'en-GB' },
    { name: 'English (India)', value: 'en-IN' },
    { name: 'Español (Estados Unidos)', value: 'es-US' },
    { name: 'Deutsch (Deutschland)', value: 'de-DE' },
    { name: 'Français (France)', value: 'fr-FR' },
    { name: 'हिन्दी (भारत)', value: 'hi-IN' },
    { name: 'Português (Brasil)', value: 'pt-BR' },
    { name: 'العربية (عام)', value: 'ar-XA' },
    { name: 'Español (España)', value: 'es-ES' },
    { name: 'Français (Canada)', value: 'fr-CA' },
    { name: 'Bahasa Indonesia (Indonesia)', value: 'id-ID' },
    { name: 'Italiano (Italia)', value: 'it-IT' },
    { name: '日本語 (日本)', value: 'ja-JP' },
    { name: 'Türkçe (Türkiye)', value: 'tr-TR' },
    { name: 'Tiếng Việt (Việt Nam)', value: 'vi-VN' },
    { name: 'বাংলা (ভারত)', value: 'bn-IN' },
    { name: 'ગુજરાતી (ભારત)', value: 'gu-IN' },
    { name: 'ಕನ್ನಡ (ಭಾರತ)', value: 'kn-IN' },
    { name: 'മലയാളം (ഇന്ത്യ)', value: 'ml-IN' },
    { name: 'मराठी (भारत)', value: 'mr-IN' },
    { name: 'தமிழ் (இந்தியா)', value: 'ta-IN' },
    { name: 'తెలుగు (భారతదేశం)', value: 'te-IN' },
    { name: 'Nederlands (België)', value: 'nl-BE' },
    { name: 'Nederlands (Nederland)', value: 'nl-NL' },
    { name: '한국어 (대한민국)', value: 'ko-KR' },
    { name: '普通话 (中国)', value: 'cmn-CN' },
    { name: 'Polski (Polska)', value: 'pl-PL' },
    { name: 'Русский (Россия)', value: 'ru-RU' },
    { name: 'Kiswahili (Kenya)', value: 'sw-KE' },
    { name: 'ไทย (ประเทศไทย)', value: 'th-TH' },
    { name: 'اردو (ہندوستان)', value: 'ur-IN' },
    { name: 'Українська (Україна)', value: 'uk-UA' },
  ];

  private static readonly VOICES: VoiceOption[] = [
    { name: 'Aoede', value: 'Aoede' },
    { name: 'Puck', value: 'Puck' },
    { name: 'Charon', value: 'Charon' },
    { name: 'Kore', value: 'Kore' },
    { name: 'Fenrir', value: 'Fenrir' },
    { name: 'Leda', value: 'Leda' },
    { name: 'Orus', value: 'Orus' },
    { name: 'Zephyr', value: 'Zephyr' },
    { name: 'Achird', value: 'Achird' },
    { name: 'Algenib', value: 'Algenib' },
    { name: 'Algieba', value: 'Algieba' },
    { name: 'Alnilam', value: 'Alnilam' },
    { name: 'Autonoe', value: 'Autonoe' },
    { name: 'Callirrhoe', value: 'Callirrhoe' },
    { name: 'Despina', value: 'Despina' },
    { name: 'Enceladus', value: 'Enceladus' },
    { name: 'Erinome', value: 'Erinome' },
    { name: 'Gacrux', value: 'Gacrux' },
    { name: 'Iapetus', value: 'Iapetus' },
    { name: 'Laomedeia', value: 'Laomedeia' },
    { name: 'Pulcherrima', value: 'Pulcherrima' },
    { name: 'Rasalgethi', value: 'Rasalgethi' },
    { name: 'Sadachbia', value: 'Sadachbia' },
    { name: 'Sadaltager', value: 'Sadaltager' },
    { name: 'Schedar', value: 'Schedar' },
    { name: 'Sulafat', value: 'Sulafat' },
    { name: 'Umbriel', value: 'Umbriel' },
    { name: 'Vindemiatrix', value: 'Vindemiatrix' },
    { name: 'Zubenelgenubi', value: 'Zubenelgenubi' },
    { name: 'Achernar', value: 'Achernar' },
  ];

  private static readonly MODELS: ModelOption[] = [
    { id: 'gemini-2.0-flash-exp', type: 'realtime' },
    { id: 'gemini-2.0-flash-thinking-exp', type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'gemini',
      displayName: 'Gemini',
      
      apiKeyLabel: 'Gemini API Key',
      apiKeyPlaceholder: 'Enter your Gemini API key',
      
      languages: GeminiProviderConfig.LANGUAGES,
      voices: GeminiProviderConfig.VOICES,
      models: GeminiProviderConfig.MODELS,
      noiseReductionModes: [], // Gemini doesn't support noise reduction
      transcriptModels: [], // Gemini uses built-in transcription
      
      capabilities: {
        hasTemplateMode: true,
        hasTurnDetection: false, // Gemini handles turn detection automatically
        hasVoiceSettings: true,
        hasNoiseReduction: false,
        hasModelConfiguration: false, // Gemini has fewer model configuration options
        
        turnDetection: {
          modes: [], // Gemini handles this automatically
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },
        
        temperatureRange: { min: 0.0, max: 2.0, step: 0.1 },
        maxTokensRange: { min: 1, max: 8192, step: 1 },
      },
      
      defaults: {
        model: 'gemini-2.0-flash-exp',
        voice: 'Aoede',
        temperature: 1.0,
        maxTokens: 8192,
        sourceLanguage: 'en-US',
        targetLanguage: 'cmn-CN',
        turnDetectionMode: 'Auto', // Gemini handles automatically
        threshold: 0.5,
        prefixPadding: 0.0,
        silenceDuration: 0.0,
        semanticEagerness: 'Auto',
        noiseReduction: 'None',
        transcriptModel: 'auto', // Gemini uses built-in transcription
      },
    };
  }
} 