import { OpenAIClient } from './clients/OpenAIClient';
import { OpenAITranslateGAClient } from './clients/OpenAITranslateGAClient';
import { GeminiClient } from './clients/GeminiClient';
import { PalabraAIClient } from './clients/PalabraAIClient';
import { VolcengineSTClient } from './clients/VolcengineSTClient';
import { VolcengineAST2Client } from './clients/VolcengineAST2Client';
import { ApiKeyValidationResult } from './interfaces/ISettingsService';
import { FilteredModel } from './interfaces/IClient';
import { Provider, ProviderType, SUPPORTED_PROVIDERS } from '../types/Provider';

/**
 * Utility class for client operations
 * Provides a unified interface for different service providers
 */
export class ClientOperations {
  /**
   * Validate API key and fetch available models in a single request
   */
  static async validateApiKeyAndFetchModels(
    apiKey: string,
    provider: ProviderType,
    clientSecret?: string,
    customEndpoint?: string
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    switch (provider) {
      case Provider.OPENAI:
        return await OpenAIClient.validateApiKeyAndFetchModels(apiKey);
      case Provider.OPENAI_TRANSLATE:
        return await OpenAITranslateGAClient.validateApiKeyAndFetchModels(apiKey);
      case Provider.OPENAI_COMPATIBLE:
        // OpenAI Compatible provider requires a custom endpoint
        if (!customEndpoint) {
          return {
            validation: {
              valid: false,
              message: 'Custom API endpoint is required for OpenAI Compatible provider',
              validating: false
            },
            models: []
          };
        }
        return await OpenAIClient.validateApiKeyAndFetchModels(apiKey, customEndpoint);
      case Provider.GEMINI:
        return await GeminiClient.validateApiKeyAndFetchModels(apiKey);
      case Provider.PALABRA_AI:
        if (!clientSecret || !apiKey) {
          // Return validation result instead of throwing error
          return {
            validation: {
              valid: false,
              message: 'Both Client ID and Client Secret are required for Palabra AI',
              validating: false
            },
            models: []
          };
        }
        const validation = await PalabraAIClient.validateApiKey(apiKey, clientSecret);
        return {
          validation,
          models: [{ 
            id: 'realtime-translation', 
            type: 'realtime',
            created: Date.now() / 1000 // Current timestamp
          }] // PalabraAI default model
        };
      case Provider.VOLCENGINE_ST:
        // Volcengine ST requires both Access Key ID and Secret Access Key
        if (!clientSecret || !apiKey) {
          return {
            validation: {
              valid: false,
              message: 'Both Access Key ID and Secret Access Key are required for Volcengine Speech Translate',
              validating: false
            },
            models: []
          };
        }
        return await VolcengineSTClient.validateApiKeyAndFetchModels(apiKey, clientSecret);
      case Provider.VOLCENGINE_AST2:
        // Volcengine AST2 requires both APP ID and Access Token
        if (!clientSecret || !apiKey) {
          return {
            validation: {
              valid: false,
              message: 'Both APP ID and Access Token are required for Doubao AST 2.0',
              validating: false
            },
            models: []
          };
        }
        return await VolcengineAST2Client.validateApiKeyAndFetchModels(apiKey, clientSecret);
      case Provider.KIZUNA_AI_OPENAI_TRANSLATE:
      case Provider.KIZUNA_AI_VOLCENGINE_AST2:
        // Backend-managed (relay) twins: the "apiKey" is a Better Auth session token,
        // not a provider key. The relay enforces real auth at connect time, so a
        // signed-in user (non-empty token) validates statically without a network
        // request — sending the session token to the public provider endpoint would
        // fail. Return the twin's static single model.
        return {
          validation: { valid: true, message: '', validating: false },
          models: [{
            id: ClientOperations.getLatestRealtimeModel([], provider),
            type: 'realtime',
            created: Date.now() / 1000
          }]
        };
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Get latest realtime model for the specified provider
   */
  static getLatestRealtimeModel(filteredModels: FilteredModel[], provider: ProviderType): string {
    switch (provider) {
      case Provider.OPENAI:
      case Provider.OPENAI_COMPATIBLE:
        // OpenAI and OpenAI Compatible use the same model detection logic
        return OpenAIClient.getLatestRealtimeModel(filteredModels);
      case Provider.OPENAI_TRANSLATE:
        // Translate has a single fixed model family; pick newest if multiple variants exist.
        return filteredModels[0]?.id ?? 'gpt-realtime-translate';
      case Provider.GEMINI:
        return GeminiClient.getLatestRealtimeModel(filteredModels);
      case Provider.PALABRA_AI:
        // PalabraAI doesn't have model selection, return a default identifier
        return 'realtime-translation';
      case Provider.VOLCENGINE_ST:
        // Volcengine ST has a fixed model for speech translation
        return 'speech-translate-v1';
      case Provider.VOLCENGINE_AST2:
        return 'ast-v2-s2s';
      case Provider.KIZUNA_AI_OPENAI_TRANSLATE:
        // Relay twin of OpenAI Translate — fixed single model.
        return filteredModels[0]?.id ?? 'gpt-realtime-translate';
      case Provider.KIZUNA_AI_VOLCENGINE_AST2:
        // Relay twin of Doubao AST 2.0 — fixed single model.
        return 'ast-v2-s2s';
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Get supported providers
   */
  static getSupportedProviders(): ProviderType[] {
    return SUPPORTED_PROVIDERS;
  }

  /**
   * Check if a provider is supported
   */
  static isSupportedProvider(provider: string): provider is ProviderType {
    return SUPPORTED_PROVIDERS.includes(provider as ProviderType);
  }
} 