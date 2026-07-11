import { ProviderConfig, LanguageOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';

/**
 * OpenAI Translate provider — dedicated speech-to-speech translation via
 * gpt-realtime-translate. Supports 75 source languages (auto-detected by
 * the model; the value here is used for transcript display + as the
 * participant client's translate target) and 13 target output languages.
 */
export class OpenAITranslateProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'openaiTranslate';
  readonly supportsWebRTC = true;

  // TODO(Task 2/3/6): replace with real implementation, migrated from ClientFactory/ClientOperations.
  createClient(_creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    throw new Error('not migrated yet: createClient');
  }

  // TODO(Task 2/3/6): replace with real implementation, migrated from ClientFactory/ClientOperations.
  async validateAndFetchModels(_creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    throw new Error('not migrated yet: validateAndFetchModels');
  }

  // TODO(Task 2/3/6): replace with real implementation, migrated from ClientFactory/ClientOperations.
  buildSessionConfig(_slice: unknown, _systemInstructions: string): SessionConfig {
    throw new Error('not migrated yet: buildSessionConfig');
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

  /** Public accessor for the target list — used by UI to test source membership. */
  static getTargetLanguages(): readonly LanguageOption[] {
    return OpenAITranslateProviderConfig.TARGET_LANGUAGES;
  }

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
        silenceDuration: 1500,
        semanticEagerness: '',
        noiseReduction: 'None',
        transcriptModel: 'gpt-realtime-whisper',
      },
    };
  }
}
