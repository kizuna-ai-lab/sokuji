import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, CredentialCtx, ClientOptions, ParticipantSessionResult, type CredentialField } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, PalabraAISessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { PalabraAIClient, PalabraCredentials } from '../clients/PalabraAIClient';

// PalabraAI Settings
export interface PalabraAISettings {
  authMode: 'app' | 'platform';
  apiKey: string;
  clientId: string;
  clientSecret: string;
  sourceLanguage: string;
  targetLanguage: string;
  voiceId: string;
  subscriberCount: number;
  publisherCanSubscribe: boolean;
  segmentConfirmationSilenceThreshold: number;
  sentenceSplitterEnabled: boolean;
  translatePartialTranscriptions: boolean;
  desiredQueueLevelMs: number;
  maxQueueLevelMs: number;
  autoTempo: boolean;
}

export const defaultPalabraAISettings: PalabraAISettings = {
  authMode: 'platform',
  apiKey: '',
  clientId: '',
  clientSecret: '',
  sourceLanguage: 'en',
  targetLanguage: 'es',
  voiceId: 'default_low',
  subscriberCount: 0,
  publisherCanSubscribe: true,
  segmentConfirmationSilenceThreshold: 0.7,
  sentenceSplitterEnabled: true,
  translatePartialTranscriptions: false,
  desiredQueueLevelMs: 8000,
  maxQueueLevelMs: 24000,
  autoTempo: false,
};

export class PalabraAIProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'palabraai';
  readonly supportsWebRTC = false;
  readonly credentialFields: CredentialField[] = [
    { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true },
  ];

  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const s = slice as PalabraAISettings;
    if (s?.authMode === 'platform') {
      const apiKey = s.apiKey?.trim();
      if (!apiKey) {
        return { ok: false, missing: 'API Key is required for Palabra AI' };
      }
      // No `secret` key: createClient/validateAndFetchModels decode its absence
      // as platform mode. Both ends of that convention live in Palabra's own files.
      return { ok: true, primary: apiKey };
    }
    const clientId = s?.clientId?.trim();
    const clientSecret = s?.clientSecret?.trim();
    if (!clientId || !clientSecret) {
      return { ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' };
    }
    return { ok: true, primary: clientId, secret: clientSecret };
  }

  peekPrimaryCredential(slice: unknown): string {
    const s = slice as PalabraAISettings;
    return s?.authMode === 'platform' ? (s?.apiKey ?? '') : (s?.clientId ?? '');
  }

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new PalabraAIClient(PalabraAIProviderConfig.toPalabraCredentials(creds));
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    const validation = await PalabraAIClient.validateApiKey(
      PalabraAIProviderConfig.toPalabraCredentials(creds)
    );
    return {
      validation,
      models: [{ id: 'realtime-translation', type: 'realtime', created: Date.now() / 1000 }],
    };
  }

  /**
   * secret present = app pair, absent = platform key. A deprecated-façade caller
   * passing a clientId without its secret now gets a Bearer 401 from validation
   * instead of the old tailored both-required message — acceptable degradation;
   * the live path (extractCredentials) always sets secret for app mode.
   */
  private static toPalabraCredentials(creds: Credentials & { ok: true }): PalabraCredentials {
    return creds.secret !== undefined
      ? { kind: 'clientCredentials', clientId: creds.primary, clientSecret: creds.secret }
      : { kind: 'apiKey', apiKey: creds.primary };
  }

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as PalabraAISettings;
    return {
      provider: 'palabraai',
      model: 'realtime-translation',
      voice: settings.voiceId,
      instructions: systemInstructions,
      temperature: 0.8,
      maxTokens: 'inf',
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      voiceId: settings.voiceId,
      segmentConfirmationSilenceThreshold: settings.segmentConfirmationSilenceThreshold,
      sentenceSplitterEnabled: settings.sentenceSplitterEnabled,
      translatePartialTranscriptions: settings.translatePartialTranscriptions,
      desiredQueueLevelMs: settings.desiredQueueLevelMs,
      maxQueueLevelMs: settings.maxQueueLevelMs,
      autoTempo: settings.autoTempo,
    } as PalabraAISessionConfig;
  }

  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult {
    const result = super.buildParticipantSessionConfig(slice, swappedInstructions, shell);
    // PalabraAI ignores `instructions` entirely — set_task carries the direction
    // in pipeline.transcription.source_language and
    // pipeline.translations[0].target_language, built from these two fields. Without
    // this swap the participant session transcribes the other party's speech under
    // the *user's* language and "translates" it back to the other party's language,
    // so the other party's own language comes out on both lines.
    //
    // The two fields use different code spaces (targets carry region suffixes like
    // en-us, sources don't), but the API strips the suffix before validating a
    // source, so a plain swap holds for every target we offer. In the other
    // direction five source languages aren't valid targets (eu, ga, mn, mt, ug);
    // the guard below rejects those upfront — matched against TARGET_LANGUAGES
    // by exact value or by its bare (suffix-stripped) prefix — instead of
    // shipping a reversed task the API would only answer with a
    // VALIDATION_ERROR data message after connect.
    const pa = result.config as PalabraAISessionConfig;
    [pa.sourceLanguage, pa.targetLanguage] = [pa.targetLanguage, pa.sourceLanguage];

    const newTarget = pa.targetLanguage;
    const targetValid = PalabraAIProviderConfig.TARGET_LANGUAGES.some(
      t => t.value === newTarget || t.value.split('-')[0] === newTarget
    );
    if (!targetValid) {
      return {
        config: null,
        notices: [{
          channel: 'error',
          message: `Participant translation ${pa.sourceLanguage} → ${newTarget} is not supported — participant channel skipped`,
        }],
      };
    }

    return result;
  }

  // PalabraAI supported source languages (for recognition) based on their documentation
  private static readonly SOURCE_LANGUAGES: LanguageOption[] = [
    { name: 'العربية', value: 'ar', englishName: 'Arabic' },
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

  // PalabraAI supported target languages (for translation). Checked against the
  // API's own target enum — see palabraLanguageCodes.test.ts for the full list and
  // how to re-capture it. Every source language the API also accepts as a target
  // has to appear here: both the participant swap and the settings swap button move
  // a source code into targetLanguage, and a code missing from this list leaves the
  // dropdown blank even though the session still works.
  private static readonly TARGET_LANGUAGES: LanguageOption[] = [
    { name: 'العربية', value: 'ar', englishName: 'Arabic' },
    { name: 'العربية (السعودية)', value: 'ar-sa', englishName: 'Arabic (Saudi)' },
    { name: 'العربية (الإمارات)', value: 'ar-ae', englishName: 'Arabic (UAE)' },
    { name: 'Azərbaycan', value: 'az', englishName: 'Azerbaijani' },
    { name: 'Беларуская', value: 'be', englishName: 'Belarusian' },
    { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
    { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
    { name: 'Català', value: 'ca', englishName: 'Catalan' },
    { name: '中文 (简体)', value: 'zh', englishName: 'Chinese (Simplified)' },
    { name: '中文 (繁體)', value: 'zh-hant', englishName: 'Chinese (Traditional)' },
    { name: 'Čeština', value: 'cs', englishName: 'Czech' },
    { name: 'Dansk', value: 'da', englishName: 'Danish' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: 'Eesti', value: 'et', englishName: 'Estonian' },
    { name: 'Galego', value: 'gl', englishName: 'Galician' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
    { name: 'English (US)', value: 'en-us', englishName: 'English (US)' },
    { name: 'English (Australia)', value: 'en-au', englishName: 'English (Australia)' },
    { name: 'English (Canada)', value: 'en-ca', englishName: 'English (Canada)' },
    { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
    { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
    { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
    { name: 'فارسی', value: 'fa', englishName: 'Persian' },
    { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
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
    { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
    { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
    { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
    { name: 'ไทย', value: 'th', englishName: 'Thai' },
    { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
    { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
    { name: 'اردو', value: 'ur', englishName: 'Urdu' },
    { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
    { name: 'Cymraeg', value: 'cy', englishName: 'Welsh' },
  ];

  // Combined languages for UI display (using source languages as base)
  private static readonly LANGUAGES: LanguageOption[] = PalabraAIProviderConfig.SOURCE_LANGUAGES;

  // PalabraAI supports most language pairs, so the target list doesn't depend on
  // the source. The base default would fall back to `getConfig().languages` —
  // the source list — so return the target list explicitly. getConfig() declares
  // `targetLanguages` as well; both paths are live (this one feeds the swap
  // validation, that one feeds the settings dropdown).
  resolveTargetLanguages(_source: string): LanguageOption[] {
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
      // Must be declared, not left to the `targetLanguages ?? languages` fallback
      // in LanguageSection: `languages` is the *source* list, and offering it as
      // targets puts codes Palabra rejects (eu, ga, mn, mt, ug) in the dropdown.
      targetLanguages: PalabraAIProviderConfig.TARGET_LANGUAGES,
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
        textOnlyCapability: 'never',

        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },
        
        temperatureRange: { min: 0.0, max: 1.0, step: 0.1 },
        maxTokensRange: { min: 1, max: 4096, step: 1 },

        // LiveKit-based: always webrtc transport, regardless of the user's
        // transport preference. (Capture is still appendInputAudio — see
        // supportsWebRTC, which stays false.)
        forcedTransport: 'webrtc',
      },
    };
  }
}