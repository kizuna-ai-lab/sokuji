import { ProviderConfig, LanguageOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, ClientOptions, TransportType } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, OpenAITranslateSessionConfig, TranslateTargetLanguage } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { OpenAITranslateGAClient } from '../clients/OpenAITranslateGAClient';
import { OpenAITranslateWebRTCClient } from '../clients/OpenAITranslateWebRTCClient';

// OpenAI Translate Settings (gpt-realtime-translate model family)
export interface OpenAITranslateSettings {
  apiKey: string;
  // UI display only — not sent to API (auto-detected by model)
  sourceLanguage: string;
  // Sent to API as audio.output.language
  targetLanguage: TranslateTargetLanguage;
  // Currently the only valid value; UI dropdown shows it as a single option
  transcriptModel: 'gpt-realtime-whisper';
  noiseReduction: 'None' | 'Near field' | 'Far field';
  transportType: TransportType;
  // Client-side utterance segmentation thresholds in seconds. User (input)
  // and assistant (output) run independent state machines, so each has its
  // own threshold. Range 0.1–3.0s. Translate API has no server-side turn
  // detection, so these only control UI message splitting. Stored as
  // seconds; converted to ms when building the session config.
  userSilenceDuration: number;
  assistantSilenceDuration: number;
}

export const defaultOpenAITranslateSettings: OpenAITranslateSettings = {
  apiKey: '',
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  transcriptModel: 'gpt-realtime-whisper',
  noiseReduction: 'None',
  transportType: 'websocket',
  userSilenceDuration: 1.0,
  assistantSilenceDuration: 0.5,
};

/**
 * OpenAI Translate provider — dedicated speech-to-speech translation via
 * gpt-realtime-translate. Supports 75 source languages (auto-detected by
 * the model; the value here is used for transcript display + as the
 * participant client's translate target) and 13 target output languages.
 */
export class OpenAITranslateProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'openaiTranslate';
  readonly supportsWebRTC = true;

  createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient {
    if (options.transport === 'webrtc') {
      return new OpenAITranslateWebRTCClient({
        apiKey: creds.primary,
        inputDeviceId: options.webrtcOptions?.inputDeviceId,
        outputDeviceId: options.webrtcOptions?.outputDeviceId,
      });
    }
    return new OpenAITranslateGAClient(creds.primary);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return OpenAITranslateGAClient.validateApiKeyAndFetchModels(creds.primary);
  }

  latestRealtimeModel(models: FilteredModel[]): string {
    // Translate has a single fixed model family; pick newest if multiple variants exist.
    return models[0]?.id ?? 'gpt-realtime-translate';
  }

  // The kizuna translate twin inherits this builder (reads its own slice).
  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as OpenAITranslateSettings;
    void systemInstructions;
    return {
      provider: 'openai_translate',
      model: 'gpt-realtime-translate',
      targetLanguage: settings.targetLanguage,
      sourceLanguage: settings.sourceLanguage,
      inputAudioTranscription: settings.transcriptModel
        ? { model: settings.transcriptModel }
        : undefined,
      inputAudioNoiseReduction: settings.noiseReduction !== 'None' ? {
        type: settings.noiseReduction === 'Near field' ? 'near_field' : 'far_field'
      } : undefined,
      userSilenceDurationMs: Math.round(settings.userSilenceDuration * 1000),
      assistantSilenceDurationMs: Math.round(settings.assistantSilenceDuration * 1000),
    } as OpenAITranslateSessionConfig;
  }

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

  // 75 source languages supported by gpt-realtime-translate (per cookbook).
  // Codes are coarse ISO 639-1 (zh — not zh_CN). Used for the source-language
  // dropdown UI; not forwarded to the API since source is auto-detected.
  // 13 of these overlap with TARGET_LANGUAGES; the other 62 are source-only.
  private static readonly SOURCE_LANGUAGES: LanguageOption[] = [
    { name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },
    { name: 'العربية', value: 'ar', englishName: 'Arabic' },
    { name: 'Azərbaycan', value: 'az', englishName: 'Azerbaijani' },
    { name: 'Беларуская', value: 'be', englishName: 'Belarusian' },
    { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
    { name: 'Bosanski', value: 'bs', englishName: 'Bosnian' },
    { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
    { name: 'Català', value: 'ca', englishName: 'Catalan' },
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
    { name: 'Čeština', value: 'cs', englishName: 'Czech' },
    { name: 'Dansk', value: 'da', englishName: 'Danish' },
    { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
    { name: 'རྫོང་ཁ', value: 'dz', englishName: 'Dzongkha' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: 'Esperanto', value: 'eo', englishName: 'Esperanto' },
    { name: 'Eesti', value: 'et', englishName: 'Estonian' },
    { name: 'Euskara', value: 'eu', englishName: 'Basque' },
    { name: 'فارسی', value: 'fa', englishName: 'Persian' },
    { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
    { name: 'Filipino', value: 'fil', englishName: 'Filipino' },
    { name: 'Français', value: 'fr', englishName: 'French' },
    { name: 'Galego', value: 'gl', englishName: 'Galician' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
    { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
    { name: 'Kreyòl Ayisyen', value: 'ht', englishName: 'Haitian Creole' },
    { name: 'ʻŌlelo Hawaiʻi', value: 'haw', englishName: 'Hawaiian' },
    { name: 'עברית', value: 'he', englishName: 'Hebrew' },
    { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
    { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
    { name: 'Հայերեն', value: 'hy', englishName: 'Armenian' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Italiano', value: 'it', englishName: 'Italian' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'Basa Jawa', value: 'jv', englishName: 'Javanese' },
    { name: 'ქართული', value: 'ka', englishName: 'Georgian' },
    { name: 'Қазақ', value: 'kk', englishName: 'Kazakh' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'Kurdî', value: 'ku', englishName: 'Kurdish' },
    { name: 'Latine', value: 'la', englishName: 'Latin' },
    { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
    { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
    { name: 'Македонски', value: 'mk', englishName: 'Macedonian' },
    { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
    { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
    { name: 'Māori', value: 'mi', englishName: 'Maori' },
    { name: 'Монгол', value: 'mn', englishName: 'Mongolian' },
    { name: 'မြန်မာ', value: 'my', englishName: 'Burmese' },
    { name: 'नेपाली', value: 'ne', englishName: 'Nepali' },
    { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
    { name: 'Nynorsk', value: 'nn', englishName: 'Nynorsk' },
    { name: 'Polski', value: 'pl', englishName: 'Polish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'ਪੰਜਾਬੀ', value: 'pa', englishName: 'Punjabi' },
    { name: 'Română', value: 'ro', englishName: 'Romanian' },
    { name: 'Русский', value: 'ru', englishName: 'Russian' },
    { name: 'Српски', value: 'sr', englishName: 'Serbian' },
    { name: 'ChiShona', value: 'sn', englishName: 'Shona' },
    { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
    { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
    { name: 'Shqip', value: 'sq', englishName: 'Albanian' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
    { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
    { name: 'Tagalog', value: 'tl', englishName: 'Tagalog' },
    { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
    { name: 'ไทย', value: 'th', englishName: 'Thai' },
    { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
    { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
    { name: 'Oʻzbek', value: 'uz', englishName: 'Uzbek' },
    { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
    { name: 'Cymraeg', value: 'cy', englishName: 'Welsh' },
    { name: 'Yorùbá', value: 'yo', englishName: 'Yoruba' },
  ];

  // Static fallback model list — runtime fetches the real list from /v1/models.
  private static readonly MODELS: ModelOption[] = [
    { id: 'gpt-realtime-translate', type: 'realtime' },
  ];

  // resolveTargetLanguages() uses the BaseProviderDescriptor default, which
  // reads getConfig().targetLanguages — always TARGET_LANGUAGES here regardless
  // of source, matching this class's former static getTargetLanguages().

  getConfig(): ProviderConfig {
    return {
      id: 'openai_translate',
      displayName: 'OpenAI Translate',
      apiKeyLabel: 'OpenAI API Key',
      apiKeyPlaceholder: 'sk-...',

      // Source-language dropdown shows the cookbook's 75 supported input
      // languages in coarse ISO-639-1 codes (no regional variants). The
      // value is auto-detected by the model server-side, but the UI value
      // is still meaningful: it's used for transcript display and as the
      // participant client's translate target.
      languages: [...OpenAITranslateProviderConfig.SOURCE_LANGUAGES],
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

        // Translate has no server-side turn detection; we expose only the
        // client-side silence-duration knob, which controls UI segmentation.
        // hasTurnDetection stays false to keep mode/threshold/prefix/eagerness
        // hidden — only hasSilenceDuration drives the slider rendering.
        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: true,
          hasSemanticEagerness: false,
        },

        // Unused — capability flags above hide the corresponding UI sections,
        // but the fields are required by the type.
        temperatureRange: { min: 0, max: 0, step: 0 },
        maxTokensRange: { min: 0, max: 0, step: 0 },
      },
    };
  }
}
