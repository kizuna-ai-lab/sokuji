import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';

export class GeminiProviderConfig {
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: 'English (United States)', value: 'en-US', englishName: 'English (United States)' },
    { name: 'English (Australia)', value: 'en-AU', englishName: 'English (Australia)' },
    { name: 'English (United Kingdom)', value: 'en-GB', englishName: 'English (United Kingdom)' },
    { name: 'English (India)', value: 'en-IN', englishName: 'English (India)' },
    { name: 'Español (Estados Unidos)', value: 'es-US', englishName: 'Spanish (United States)' },
    { name: 'Deutsch (Deutschland)', value: 'de-DE', englishName: 'German (Germany)' },
    { name: 'Français (France)', value: 'fr-FR', englishName: 'French (France)' },
    { name: 'हिन्दी (भारत)', value: 'hi-IN', englishName: 'Hindi (India)' },
    { name: 'Português (Brasil)', value: 'pt-BR', englishName: 'Portuguese (Brazil)' },
    { name: 'العربية (عام)', value: 'ar-XA', englishName: 'Arabic (Standard)' },
    { name: 'Español (España)', value: 'es-ES', englishName: 'Spanish (Spain)' },
    { name: 'Français (Canada)', value: 'fr-CA', englishName: 'French (Canada)' },
    { name: 'Bahasa Indonesia (Indonesia)', value: 'id-ID', englishName: 'Indonesian (Indonesia)' },
    { name: 'Italiano (Italia)', value: 'it-IT', englishName: 'Italian (Italy)' },
    { name: '日本語 (日本)', value: 'ja-JP', englishName: 'Japanese (Japan)' },
    { name: 'Türkçe (Türkiye)', value: 'tr-TR', englishName: 'Turkish (Turkey)' },
    { name: 'Tiếng Việt (Việt Nam)', value: 'vi-VN', englishName: 'Vietnamese (Vietnam)' },
    { name: 'বাংলা (ভারত)', value: 'bn-IN', englishName: 'Bengali (India)' },
    { name: 'ગુજરાતી (ભારત)', value: 'gu-IN', englishName: 'Gujarati (India)' },
    { name: 'ಕನ್ನಡ (ಭಾರತ)', value: 'kn-IN', englishName: 'Kannada (India)' },
    { name: 'മലയാളം (ഇന്ത്യ)', value: 'ml-IN', englishName: 'Malayalam (India)' },
    { name: 'मराठी (भारत)', value: 'mr-IN', englishName: 'Marathi (India)' },
    { name: 'தமிழ் (இந்தியா)', value: 'ta-IN', englishName: 'Tamil (India)' },
    { name: 'తెలుగు (భారతదేశం)', value: 'te-IN', englishName: 'Telugu (India)' },
    { name: 'Nederlands (België)', value: 'nl-BE', englishName: 'Dutch (Belgium)' },
    { name: 'Nederlands (Nederland)', value: 'nl-NL', englishName: 'Dutch (Netherlands)' },
    { name: '한국어 (대한민국)', value: 'ko-KR', englishName: 'Korean (South Korea)' },
    { name: '普通话 (中国)', value: 'cmn-CN', englishName: 'Mandarin Chinese (China)' },
    { name: 'Polski (Polska)', value: 'pl-PL', englishName: 'Polish (Poland)' },
    { name: 'Русский (Россия)', value: 'ru-RU', englishName: 'Russian (Russia)' },
    { name: 'Kiswahili (Kenya)', value: 'sw-KE', englishName: 'Swahili (Kenya)' },
    { name: 'ไทย (ประเทศไทย)', value: 'th-TH', englishName: 'Thai (Thailand)' },
    { name: 'اردو (ہندوستان)', value: 'ur-IN', englishName: 'Urdu (India)' },
    { name: 'Українська (Україна)', value: 'uk-UA', englishName: 'Ukrainian (Ukraine)' },
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
    { id: 'gemini-2.0-flash-live-001', type: 'realtime' },
    { id: 'gemini-2.5-flash-preview-native-audio-dialog', type: 'realtime' },
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
        hasModelConfiguration: true, // Gemini supports temperature and max tokens configuration
        
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
        model: 'gemini-2.0-flash-live-001',
        voice: 'Aoede',
        temperature: 1.0,
        maxTokens: 'inf' as any,
        sourceLanguage: 'en-US',
        targetLanguage: 'ja-JP',
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