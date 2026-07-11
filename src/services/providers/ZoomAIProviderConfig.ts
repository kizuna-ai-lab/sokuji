import { ProviderConfig, LanguageOption, VoiceOption, ModelOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, CredentialCtx, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { ZoomAIClient } from '../clients/ZoomAIClient';

// Zoom AI Services Settings
export interface ZoomAISettings {
  apiKey: string;
  apiSecret: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export const defaultZoomAISettings: ZoomAISettings = {
  apiKey: '',
  apiSecret: '',
  sourceLanguage: 'ja-JP',
  targetLanguage: 'en-US',
};

/**
 * Zoom AI Services (Scribe + Translator) — text-only cascade provider.
 * Asymmetric language matrix: sources are the 5 Scribe-recognizable languages;
 * a translation pair must have English on one side.
 */
export class ZoomAIProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'zoomAI';
  readonly supportsWebRTC = false;

  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const s = slice as ZoomAISettings;
    if (!s?.apiKey || !s?.apiSecret) {
      return { ok: false, missing: 'Both API Key and API Secret are required for Zoom AI Services' };
    }
    return { ok: true, primary: s.apiKey, secret: s.apiSecret };
  }

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    if (!creds.secret) throw new Error('API Secret is required for zoom_ai provider');
    return new ZoomAIClient(creds.primary, creds.secret);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return ZoomAIClient.validateApiKeyAndFetchModels(creds.primary, creds.secret!);
  }

  // TODO(Task 2/3/6): replace with real implementation, migrated from ClientFactory/ClientOperations.
  buildSessionConfig(_slice: unknown, _systemInstructions: string): SessionConfig {
    throw new Error('not migrated yet: buildSessionConfig');
  }

  // ASR-recognizable sources (Zoom Scribe supported languages).
  private static readonly SOURCE_LANGUAGES: LanguageOption[] = [
    { name: 'English', value: 'en-US', englishName: 'English' },
    { name: '中文', value: 'zh-CN', englishName: 'Chinese (Simplified)' },
    { name: '日本語', value: 'ja-JP', englishName: 'Japanese' },
    { name: 'Español', value: 'es-ES', englishName: 'Spanish' },
    { name: 'Italiano', value: 'it-IT', englishName: 'Italian' },
  ];

  // All translator target languages reachable from English.
  private static readonly EN_TARGETS: LanguageOption[] = [
    { name: '中文 (简体)', value: 'zh-CN', englishName: 'Chinese (Simplified)' },
    { name: '中文 (繁體)', value: 'zh-TW', englishName: 'Chinese (Traditional)' },
    { name: '日本語', value: 'ja-JP', englishName: 'Japanese' },
    { name: '한국어', value: 'ko-KR', englishName: 'Korean' },
    { name: 'Español', value: 'es-ES', englishName: 'Spanish' },
    { name: 'Français', value: 'fr-FR', englishName: 'French' },
    { name: 'Deutsch', value: 'de-DE', englishName: 'German' },
    // Portuguese (pt-PT/pt-BR) omitted — Zoom Translator returns 500 for both as of 2026-07.
    { name: 'Italiano', value: 'it-IT', englishName: 'Italian' },
  ];

  private static readonly EN_ONLY: LanguageOption[] = [
    { name: 'English', value: 'en-US', englishName: 'English' },
  ];

  // source value → allowed target list
  private static readonly PAIRS: Record<string, LanguageOption[]> = {
    'en-US': ZoomAIProviderConfig.EN_TARGETS,
    'zh-CN': ZoomAIProviderConfig.EN_ONLY,
    'ja-JP': ZoomAIProviderConfig.EN_ONLY,
    'es-ES': ZoomAIProviderConfig.EN_ONLY,
    'it-IT': ZoomAIProviderConfig.EN_ONLY,
  };

  private static readonly VOICES: VoiceOption[] = [];
  private static readonly MODELS: ModelOption[] = [
    { id: 'zoom-scribe-translator-v1', type: 'realtime' },
  ];

  static getSourceLanguages(): LanguageOption[] {
    return ZoomAIProviderConfig.SOURCE_LANGUAGES;
  }

  static getTargetLanguagesForSource(src: string): LanguageOption[] {
    return ZoomAIProviderConfig.PAIRS[src] ?? ZoomAIProviderConfig.EN_ONLY;
  }

  /** Reconciles a target language against a (possibly new) source, falling back
   * to the first allowed target — or 'en-US' if none — when the current target
   * is no longer valid for the source. Shared by LanguageSection and
   * ProviderSpecificSettings so the fallback rule lives in one place. */
  static reconcileTarget(sourceValue: string, currentTarget: string): string {
    const allowed = this.getTargetLanguagesForSource(sourceValue).map(l => l.value);
    return allowed.includes(currentTarget) ? currentTarget : (allowed[0] || 'en-US');
  }

  getConfig(): ProviderConfig {
    return {
      id: 'zoom_ai',
      displayName: 'Zoom AI Services',

      apiKeyLabel: 'API Key',
      apiKeyPlaceholder: 'Enter your Zoom Build Platform API Key',

      languages: ZoomAIProviderConfig.SOURCE_LANGUAGES,
      voices: ZoomAIProviderConfig.VOICES,
      models: ZoomAIProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: false,
        hasVoiceSettings: false,
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'always',
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
