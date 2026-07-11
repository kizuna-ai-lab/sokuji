import { ProviderConfig, LanguageOption, VoiceOption, ModelOption, ReasoningEffort } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, ClientOptions, TransportType } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, OpenAISessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { OpenAIClient } from '../clients/OpenAIClient';
import { OpenAIGAClient } from '../clients/OpenAIGAClient';
import { OpenAIWebRTCClient } from '../clients/OpenAIWebRTCClient';

// OpenAI-compatible Settings (used by OpenAI and KizunaAI)
export interface OpenAICompatibleSettingsBase {
  apiKey: string;
  model: string;
  voice: string;
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Normal' | 'Semantic' | 'Disabled' | 'Push-to-Translate';
  threshold: number;
  prefixPadding: number;
  silenceDuration: number;
  semanticEagerness: 'Auto' | 'Low' | 'Medium' | 'High';
  temperature: number;
  maxTokens: number | 'inf';
  transcriptModel: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
  noiseReduction: 'None' | 'Near field' | 'Far field';
  transportType: TransportType;
  // Persisted across model switches so the user's preference is preserved
  // when toggling between gpt-realtime-2 and other models. Only forwarded
  // to the API when the active model supports it.
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

export type OpenAISettings = OpenAICompatibleSettingsBase;

export const defaultOpenAICompatibleSettingsBase: OpenAICompatibleSettingsBase = {
  apiKey: '',
  model: 'gpt-realtime-mini',
  voice: 'alloy',
  sourceLanguage: 'en',
  targetLanguage: 'zh_CN',
  turnDetectionMode: 'Normal',
  threshold: 0.49,
  prefixPadding: 0.5,
  silenceDuration: 0.5,
  semanticEagerness: 'Auto',
  temperature: 0.8,
  maxTokens: 'inf',
  transcriptModel: 'gpt-4o-mini-transcribe',
  noiseReduction: 'None',
  transportType: 'websocket',
  reasoningEffort: 'low',
};

export const defaultOpenAISettings: OpenAISettings = defaultOpenAICompatibleSettingsBase;

/**
 * Build the OpenAI realtime session config from an OpenAI(-compatible) slice.
 * Shared module-level helper: both OpenAIProviderConfig and its subclass
 * OpenAICompatibleProviderConfig emit the `openai` wire shape from this.
 */
export function buildOpenAISessionConfig(
  settings: OpenAISettings,
  systemInstructions: string
): OpenAISessionConfig {
  return {
    provider: 'openai',
    model: settings.model,
    voice: settings.voice,
    instructions: systemInstructions,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    // Push-to-Translate uses {type: 'none'} like Disabled — the client controls turns
    // manually via createResponse() on hold release. Falling through to semantic_vad here
    // would let the OpenAI server auto-translate any utterance, defeating manual control.
    turnDetection: (settings.turnDetectionMode === 'Disabled' || settings.turnDetectionMode === 'Push-to-Translate')
      ? {type: 'none'}
      : settings.turnDetectionMode === 'Normal'
        ? {
            type: 'server_vad',
            createResponse: true,
            interruptResponse: false,
            prefixPadding: settings.prefixPadding,
            silenceDuration: settings.silenceDuration,
            threshold: settings.threshold
          }
        : {
            type: 'semantic_vad',
            createResponse: true,
            interruptResponse: false,
            eagerness: settings.semanticEagerness?.toLowerCase() as any,
          },
    inputAudioNoiseReduction: settings.noiseReduction && settings.noiseReduction !== 'None' ? {
      type: settings.noiseReduction === 'Near field' ? 'near_field' : 'far_field'
    } : undefined,
    inputAudioTranscription: settings.transcriptModel ? {
      model: settings.transcriptModel
    } : undefined,
    // Forward reasoning effort unconditionally; the client gates by model name
    // before sending it to the API (older realtime models reject the field).
    reasoningEffort: settings.reasoningEffort,
  };
}

export class OpenAIProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'openai';
  readonly supportsWebRTC = true;

  createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient {
    if (options.transport === 'webrtc') {
      return new OpenAIWebRTCClient({
        apiKey: creds.primary,
        inputDeviceId: options.webrtcOptions?.inputDeviceId,
        outputDeviceId: options.webrtcOptions?.outputDeviceId,
      });
    }
    return new OpenAIGAClient(creds.primary);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return OpenAIClient.validateApiKeyAndFetchModels(creds.primary);
  }

  latestRealtimeModel(models: FilteredModel[]): string {
    return OpenAIClient.getLatestRealtimeModel(models);
  }

  // OpenAICompatibleProviderConfig inherits this method; both emit the `openai`
  // wire shape via the shared buildOpenAISessionConfig helper.
  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as OpenAISettings;
    return buildOpenAISessionConfig(settings, systemInstructions);
  }

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
    { name: 'Cedar', value: 'cedar' },
    { name: 'Coral', value: 'coral' },
    { name: 'Echo', value: 'echo' },
    { name: 'Marin', value: 'marin' },
    { name: 'Sage', value: 'sage' },
    { name: 'Shimmer', value: 'shimmer' },
    { name: 'Verse', value: 'verse' },
  ];

  /** Public accessor for the OpenAI source-language list, reused by sibling providers (e.g. OpenAITranslate). */
  static getSourceLanguages(): readonly LanguageOption[] {
    return OpenAIProviderConfig.LANGUAGES;
  }

  private static readonly MODELS: ModelOption[] = [
    { id: 'gpt-realtime-mini', type: 'realtime' },
    { id: 'gpt-realtime-1.5', type: 'realtime' },
    { id: 'gpt-realtime-2', type: 'realtime' },
  ];

  // Only models matching this prefix accept the `reasoning.effort` parameter.
  // Older realtime models (mini, 1.5) reject it.
  private static readonly REASONING_EFFORTS: ReasoningEffort[] = [
    'minimal', 'low', 'medium', 'high', 'xhigh',
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
      reasoningEfforts: OpenAIProviderConfig.REASONING_EFFORTS,

      capabilities: {
        hasTemplateMode: true,
        hasTurnDetection: true,
        hasVoiceSettings: true,
        hasNoiseReduction: true,
        hasModelConfiguration: true,
        hasReasoningEffort: true,
        textOnlyCapability: 'optional',

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
    };
  }
}