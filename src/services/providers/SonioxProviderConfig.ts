import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, SonioxSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { SonioxClient } from '../clients/SonioxClient';

// Soniox Settings — single BYOK API key (extractCredentials inherited from base)
export interface SonioxSettings {
  apiKey: string;
  sourceLanguage: string;     // 'auto' | ISO code
  targetLanguage: string;
  twoWayTranslation: boolean; // one_way ↔ two_way translation mode
  voice: string;              // TTS voice, one of VOICES
  model: string;
}

export const defaultSonioxSettings: SonioxSettings = {
  apiKey: '',
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  twoWayTranslation: false,
  voice: 'Maya',
  model: 'stt-rt-v5',
};

export class SonioxProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'soniox';
  readonly supportsWebRTC = false;

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new SonioxClient(creds.primary);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return SonioxClient.validateApiKeyAndFetchModels(creds.primary);
  }

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as SonioxSettings;
    return {
      provider: 'soniox',
      model: settings.model || 'stt-rt-v5',
      voice: settings.voice || 'Maya',
      instructions: systemInstructions,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      // two_way requires a concrete source language ('auto' would be ambiguous)
      twoWayTranslation: settings.twoWayTranslation && settings.sourceLanguage !== 'auto',
    } as SonioxSessionConfig;
  }

  // The 60 languages from Soniox's own STS demo app — translation is
  // any-to-any across this set, so source and target share one list
  // (the "Auto Detect" source option is injected by the generic UI).
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },
    { name: 'Shqip', value: 'sq', englishName: 'Albanian' },
    { name: 'العربية', value: 'ar', englishName: 'Arabic' },
    { name: 'Azərbaycan', value: 'az', englishName: 'Azerbaijani' },
    { name: 'Euskara', value: 'eu', englishName: 'Basque' },
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
    { name: 'English', value: 'en', englishName: 'English' },
    { name: 'Eesti', value: 'et', englishName: 'Estonian' },
    { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
    { name: 'Français', value: 'fr', englishName: 'French' },
    { name: 'Galego', value: 'gl', englishName: 'Galician' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
    { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
    { name: 'עברית', value: 'he', englishName: 'Hebrew' },
    { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
    { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Italiano', value: 'it', englishName: 'Italian' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'ಕನ್ನಡ', value: 'kn', englishName: 'Kannada' },
    { name: 'Қазақ', value: 'kk', englishName: 'Kazakh' },
    { name: '한국어', value: 'ko', englishName: 'Korean' },
    { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
    { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
    { name: 'Македонски', value: 'mk', englishName: 'Macedonian' },
    { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
    { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
    { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
    { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
    { name: 'فارسی', value: 'fa', englishName: 'Persian' },
    { name: 'Polski', value: 'pl', englishName: 'Polish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'ਪੰਜਾਬੀ', value: 'pa', englishName: 'Punjabi' },
    { name: 'Română', value: 'ro', englishName: 'Romanian' },
    { name: 'Русский', value: 'ru', englishName: 'Russian' },
    { name: 'Српски', value: 'sr', englishName: 'Serbian' },
    { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
    { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
    { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
    { name: 'Tagalog', value: 'tl', englishName: 'Tagalog' },
    { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
    { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
    { name: 'ไทย', value: 'th', englishName: 'Thai' },
    { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
    { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
    { name: 'اردو', value: 'ur', englishName: 'Urdu' },
    { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
    { name: 'Cymraeg', value: 'cy', englishName: 'Welsh' },
  ];

  // All 12 voices are multilingual (zh/ja/en verified live 2026-07-18):
  // one voice serves both two_way directions.
  private static readonly VOICES: VoiceOption[] = [
    { name: 'Adrian', value: 'Adrian' },
    { name: 'Claire', value: 'Claire' },
    { name: 'Daniel', value: 'Daniel' },
    { name: 'Emma', value: 'Emma' },
    { name: 'Grace', value: 'Grace' },
    { name: 'Jack', value: 'Jack' },
    { name: 'Kenji', value: 'Kenji' },
    { name: 'Maya', value: 'Maya' },
    { name: 'Mina', value: 'Mina' },
    { name: 'Nina', value: 'Nina' },
    { name: 'Noah', value: 'Noah' },
    { name: 'Owen', value: 'Owen' },
  ];

  private static readonly MODELS: ModelOption[] = [
    { id: 'stt-rt-v5', type: 'realtime' }
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'soniox',
      displayName: 'Soniox',

      apiKeyLabel: 'API Key',
      apiKeyPlaceholder: 'Enter your Soniox API Key',

      languages: SonioxProviderConfig.LANGUAGES,
      voices: SonioxProviderConfig.VOICES,
      models: SonioxProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false, // dedicated translation service — no prompt templates
        hasTurnDetection: false, // server-side endpoint detection, not user-configurable
        hasVoiceSettings: true, // TTS voice dropdown (12 multilingual voices)
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'optional', // toggle: subtitles-only vs spoken translation

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
    };
  }
}
