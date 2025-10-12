import { OpenAIClient } from './clients/OpenAIClient';
import { GeminiClient } from './clients/GeminiClient';
import { PalabraAIClient } from './clients/PalabraAIClient';
import { ApiKeyValidationResult } from './interfaces/ISettingsService';
import { FilteredModel } from './interfaces/IClient';
import { Provider, ProviderType, SUPPORTED_PROVIDERS } from '../types/Provider';
import { getBackendUrl } from '../utils/environment';

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
      case Provider.KIZUNA_AI:
        // KizunaAI is OpenAI-compatible, use OpenAIClient with proxy
        // Use environment-specific backend URL
        return await OpenAIClient.validateApiKeyAndFetchModels(
          apiKey,
          getBackendUrl()
        );
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
      case Provider.GEMINI:
        return GeminiClient.getLatestRealtimeModel(filteredModels);
      case Provider.PALABRA_AI:
        // PalabraAI doesn't have model selection, return a default identifier
        return 'realtime-translation';
      case Provider.KIZUNA_AI:
        // KizunaAI uses the same model detection logic as OpenAI
        return OpenAIClient.getLatestRealtimeModel(filteredModels);
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