import { OpenAIClient } from './clients/OpenAIClient';
import { GeminiClient } from './clients/GeminiClient';
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
    provider: ProviderType
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    switch (provider) {
      case Provider.OPENAI:
        return await OpenAIClient.validateApiKeyAndFetchModels(apiKey);
      case Provider.GEMINI:
        return await GeminiClient.validateApiKeyAndFetchModels(apiKey);
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
        return OpenAIClient.getLatestRealtimeModel(filteredModels);
      case Provider.GEMINI:
        return GeminiClient.getLatestRealtimeModel(filteredModels);
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