import { BaseProviderConfig, ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';

export class GeminiProviderConfig extends BaseProviderConfig {
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: 'English (United States)', value: 'en-US' },
    { name: 'English (Australia)', value: 'en-AU' },
    { name: 'English (United Kingdom)', value: 'en-GB' },
    { name: 'English (India)', value: 'en-IN' },
    { name: 'Spanish (United States)', value: 'es-US' },
    { name: 'German (Germany)', value: 'de-DE' },
    { name: 'French (France)', value: 'fr-FR' },
    { name: 'Hindi (India)', value: 'hi-IN' },
    { name: 'Português (Brasil)', value: 'pt-BR' },
    { name: 'Arabic (Generic)', value: 'ar-XA' },
    { name: 'Spanish (Spain)', value: 'es-ES' },
    { name: 'French (Canada)', value: 'fr-CA' },
    { name: 'Indonesian (Indonesia)', value: 'id-ID' },
    { name: 'Italian (Italy)', value: 'it-IT' },
    { name: 'Japanese (Japan)', value: 'ja-JP' },
    { name: 'Turkish (Turkey)', value: 'tr-TR' },
    { name: 'Vietnamese (Vietnam)', value: 'vi-VN' },
    { name: 'Bengali (India)', value: 'bn-IN' },
    { name: 'Gujarati (India)', value: 'gu-IN' },
    { name: 'Kannada (India)', value: 'kn-IN' },
    { name: 'Malayalam (India)', value: 'ml-IN' },
    { name: 'Marathi (India)', value: 'mr-IN' },
    { name: 'Tamil (India)', value: 'ta-IN' },
    { name: 'Telugu (India)', value: 'te-IN' },
    { name: 'Dutch (Belgium)', value: 'nl-BE' },
    { name: 'Dutch (Netherlands)', value: 'nl-NL' },
    { name: 'Korean (South Korea)', value: 'ko-KR' },
    { name: 'Mandarin Chinese (China)', value: 'cmn-CN' },
    { name: 'Polish (Poland)', value: 'pl-PL' },
    { name: 'Russian (Russia)', value: 'ru-RU' },
    { name: 'Swahili (Kenya)', value: 'sw-KE' },
    { name: 'Thai (Thailand)', value: 'th-TH' },
    { name: 'Urdu (India)', value: 'ur-IN' },
    { name: 'Ukrainian (Ukraine)', value: 'uk-UA' },
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
    { id: 'gemini-2.0-flash-exp', displayName: 'Gemini 2.0 Flash (Experimental)', type: 'realtime' },
    { id: 'gemini-2.0-flash-thinking-exp', displayName: 'Gemini 2.0 Flash Thinking (Experimental)', type: 'realtime' },
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