import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';

export class VolcengineAST2ProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'volcengineAST2';
  readonly supportsWebRTC = false;

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

  // AST 2.0 supported languages (s2s mode)
  private static readonly LANGUAGES: LanguageOption[] = [
    { name: '中文', value: 'zh', englishName: 'Chinese' },
    { name: 'English', value: 'en', englishName: 'English' },
    { name: '日本語', value: 'ja', englishName: 'Japanese' },
    { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
    { name: 'Español', value: 'es', englishName: 'Spanish' },
    { name: 'Português', value: 'pt', englishName: 'Portuguese' },
    { name: 'Deutsch', value: 'de', englishName: 'German' },
    { name: 'Français', value: 'fr', englishName: 'French' },
  ];

  // Bidirectional language pair
  private static readonly BIDIRECTIONAL_LANGUAGES: LanguageOption[] = [
    ...VolcengineAST2ProviderConfig.LANGUAGES,
    { name: '中英双语 (zh↔en)', value: 'zhen', englishName: 'Chinese-English Bidirectional' },
  ];

  // No voice selection - server auto-clones speaker voice in s2s mode
  private static readonly VOICES: VoiceOption[] = [];

  private static readonly MODELS: ModelOption[] = [
    { id: 'ast-v2-s2s', type: 'realtime' }
  ];

  static getSourceLanguages(): LanguageOption[] {
    return VolcengineAST2ProviderConfig.BIDIRECTIONAL_LANGUAGES;
  }

  static getTargetLanguages(): LanguageOption[] {
    return VolcengineAST2ProviderConfig.BIDIRECTIONAL_LANGUAGES;
  }

  getConfig(): ProviderConfig {
    return {
      id: 'volcengine_ast2',
      displayName: 'Doubao AST 2.0',

      apiKeyLabel: 'App Key',
      apiKeyPlaceholder: 'Enter your Volcengine App Key',

      languages: VolcengineAST2ProviderConfig.BIDIRECTIONAL_LANGUAGES,
      voices: VolcengineAST2ProviderConfig.VOICES,
      models: VolcengineAST2ProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: true,
        hasVoiceSettings: false,
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'optional',

        turnDetection: {
          modes: ['Auto', 'Push-to-Talk'],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },

        temperatureRange: { min: 0.0, max: 1.0, step: 0.1 },
        maxTokensRange: { min: 1, max: 4096, step: 1 },
      },

      defaults: {
        model: 'ast-v2-s2s',
        voice: '',
        temperature: 0.8,
        maxTokens: 4096,
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        turnDetectionMode: 'Auto',
        threshold: 0.5,
        prefixPadding: 0.0,
        silenceDuration: 0.0,
        semanticEagerness: 'Auto',
        noiseReduction: 'None',
        transcriptModel: 'auto',
      },
    };
  }
}
