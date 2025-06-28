import { IClient } from '../interfaces/IClient';
import { OpenAIClient } from './OpenAIClient';
import { GeminiClient } from './GeminiClient';
import { Provider, ProviderType } from '../../types/Provider';

/**
 * Factory for creating AI client instances
 * Determines the appropriate client based on model name and API keys
 */
export class ClientFactory {
  /**
   * Create an AI client instance based on the provider and model
   * @param model - The model name
   * @param provider - The provider type
   * @param apiKey - The API key for the specified provider
   * @returns IClient instance
   */
  static createClient(
    model: string,
    provider: ProviderType,
    apiKey: string
  ): IClient {
    if (!apiKey) {
      throw new Error(`API key is required for ${provider} provider`);
    }
    
    switch (provider) {
      case Provider.OPENAI:
        return new OpenAIClient(apiKey);
        
      case Provider.COMET_API:
        // CometAPI uses OpenAIClient with custom host
        return new OpenAIClient(apiKey, 'https://api.cometapi.com');
        
      case Provider.GEMINI:
        return new GeminiClient(apiKey);
        
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }


} 