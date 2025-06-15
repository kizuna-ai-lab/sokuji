import { OpenAIClient } from './clients/OpenAIClient';
import { GeminiClient } from './clients/GeminiClient';
import { ApiKeyValidationResult } from './interfaces/ISettingsService';
import { FilteredModel } from './interfaces/IClient';

/**
 * Utility class for client operations
 * Provides a unified interface for different service providers
 */
export class ClientOperations {
  /**
   * Validate API key and fetch available models in a single request
   */
  static async validateApiKeyAndFetchModels(apiKey: string, provider: 'openai' | 'gemini'): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    switch (provider) {
      case 'openai':
        return await OpenAIClient.validateApiKeyAndFetchModels(apiKey);
      case 'gemini':
        return await GeminiClient.validateApiKeyAndFetchModels(apiKey);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }



  /**
   * Get latest realtime model for the specified provider
   */
  static getLatestRealtimeModel(filteredModels: FilteredModel[], provider: 'openai' | 'gemini'): string {
    switch (provider) {
      case 'openai':
        return OpenAIClient.getLatestRealtimeModel(filteredModels);
      case 'gemini':
        return GeminiClient.getLatestRealtimeModel(filteredModels);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Get supported providers
   */
  static getSupportedProviders(): Array<'openai' | 'gemini'> {
    return ['openai', 'gemini'];
  }

  /**
   * Check if a provider is supported
   */
  static isSupportedProvider(provider: string): provider is 'openai' | 'gemini' {
    return this.getSupportedProviders().includes(provider as 'openai' | 'gemini');
  }
} 