import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, CredentialCtx, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, VolcengineAST2SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { VolcengineAST2Client } from '../clients/VolcengineAST2Client';

// Volcengine AST 2.0 Settings
export interface VolcengineAST2Settings {
  appId: string;
  accessToken: string;
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';
  /** Library ID for Volcengine self-learning platform Hot Words. Empty = disabled. */
  hotWordTableId: string;
  /** Library ID for Volcengine self-learning platform Replacement. Empty = disabled. */
  replacementTableId: string;
  /** Library ID for Volcengine self-learning platform Glossary. Empty = disabled. */
  glossaryTableId: string;
}

export const defaultVolcengineAST2Settings: VolcengineAST2Settings = {
  appId: '',
  accessToken: '',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  turnDetectionMode: 'Auto',
  hotWordTableId: '',
  replacementTableId: '',
  glossaryTableId: '',
};

export class VolcengineAST2ProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'volcengineAST2';
  readonly supportsWebRTC = false;

  // appId may be numeric in old persisted state — String() it, matching the
  // legacy settingsStore.ts cast this replaces.
  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const s = slice as VolcengineAST2Settings;
    if (!s?.appId || !s?.accessToken) {
      return { ok: false, missing: 'Both APP ID and Access Token are required for Doubao AST 2.0' };
    }
    return { ok: true, primary: String(s.appId), secret: String(s.accessToken) };
  }

  peekPrimaryCredential(slice: unknown): string {
    return String((slice as VolcengineAST2Settings)?.appId ?? '');
  }

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    if (!creds.secret) throw new Error('Access Token is required for volcengine_ast2 provider');
    return new VolcengineAST2Client(creds.primary, creds.secret);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return VolcengineAST2Client.validateApiKeyAndFetchModels(creds.primary, creds.secret!);
  }

  // The kizuna doubao twin inherits this builder (reads its own slice).
  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as VolcengineAST2Settings;
    const hotWordTableId = settings.hotWordTableId?.trim() || undefined;
    const replacementTableId = settings.replacementTableId?.trim() || undefined;
    const glossaryTableId = settings.glossaryTableId?.trim() || undefined;

    return {
      provider: 'volcengine_ast2',
      model: 'ast-v2-s2s',
      instructions: systemInstructions,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      turnDetectionMode: settings.turnDetectionMode,
      hotWordTableId,
      replacementTableId,
      glossaryTableId,
    } as VolcengineAST2SessionConfig;
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

  // resolveSourceLanguages/resolveTargetLanguages use the BaseProviderDescriptor
  // defaults, which read getConfig().languages — equal to BIDIRECTIONAL_LANGUAGES
  // for both, matching this class's former static behavior.

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
    };
  }
}
