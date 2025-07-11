import { OpenAIClient } from './clients/OpenAIClient';
import { GeminiClient } from './clients/GeminiClient';
import { PalabraAIClient } from './clients/PalabraAIClient';
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
    clientSecret?: string
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    switch (provider) {
      case Provider.OPENAI:
        return await OpenAIClient.validateApiKeyAndFetchModels(apiKey);
      case Provider.COMET_API:
        // CometAPI is OpenAI-compatible, use OpenAIClient with custom host
        return await OpenAIClient.validateApiKeyAndFetchModels(
          apiKey, 
          'https://api.cometapi.com'
        );
      case Provider.GEMINI:
        return await GeminiClient.validateApiKeyAndFetchModels(apiKey);
      case Provider.PALABRA_AI:
        if (!clientSecret || !apiKey) {
          throw new Error(`Client id and Client secret are required for ${provider} provider`);
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
      case Provider.COMET_API:
        // Both OpenAI and CometAPI use the same model detection logic
        return OpenAIClient.getLatestRealtimeModel(filteredModels);
      case Provider.GEMINI:
        return GeminiClient.getLatestRealtimeModel(filteredModels);
      case Provider.PALABRA_AI:
        // PalabraAI doesn't have model selection, return a default identifier
        return 'realtime-translation';
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