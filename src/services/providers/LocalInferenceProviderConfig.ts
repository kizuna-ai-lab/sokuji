import { ProviderConfig, ModelOption } from './ProviderConfig';
import { getTranslationSourceLanguages } from '../../lib/local-inference/modelManifest';
import { BaseProviderDescriptor, Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { LocalInferenceClient } from '../clients/LocalInferenceClient';

/**
 * Provider configuration for Local (Offline) inference.
 * Uses sherpa-onnx ASR + Opus-MT translation + Piper TTS.
 *
 * Languages are derived dynamically from the model manifest.
 */
export class LocalInferenceProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'localInference';
  readonly supportsWebRTC = false;

  // LocalInference has no credentials by design — its extractCredentials
  // override (Task 5) skips the empty-key check entirely.
  createClient(_creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new LocalInferenceClient();
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

  private static readonly MODELS: ModelOption[] = [
    { id: 'local-asr-translate', type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'local_inference',
      displayName: 'Local (Offline)',

      apiKeyLabel: '',
      apiKeyPlaceholder: '',

      languages: getTranslationSourceLanguages(),
      voices: [],
      models: LocalInferenceProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: false,
        hasVoiceSettings: false,
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'optional',

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

      defaults: {
        model: 'local-asr-translate',
        voice: '',
        temperature: 0.8,
        maxTokens: 4096,
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        turnDetectionMode: 'Auto',
        threshold: 0.5,
        prefixPadding: 0.0,
        silenceDuration: 0.0,
        semanticEagerness: 'Auto',
        noiseReduction: 'None',
        transcriptModel: '',
      },
    };
  }
}
