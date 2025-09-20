import { IClient } from '../interfaces/IClient';
import { OpenAIClient } from './OpenAIClient';
import { GeminiClient } from './GeminiClient';
import { PalabraAIClient } from './PalabraAIClient';
import { Provider, ProviderType } from '../../types/Provider';
import { getBackendUrl, isKizunaAIEnabled } from '../../utils/environment';

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
   * @param clientSecret - The client secret for PalabraAI (optional)
   * @returns IClient instance
   */
  static createClient(
    model: string,
    provider: ProviderType,
    apiKey: string,
    clientSecret?: string
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

      case Provider.YUN_AI:
        // YunAI uses OpenAIClient with custom host
        return new OpenAIClient(apiKey, 'https://new.yunai.link');

      case Provider.GEMINI:
        return new GeminiClient(apiKey);
        
      case Provider.PALABRA_AI:
        if (!clientSecret) {
          throw new Error(`Client secret is required for ${provider} provider`);
        }
        return new PalabraAIClient(apiKey, clientSecret);
        
      case Provider.KIZUNA_AI:
        // Check if Kizuna AI is enabled before creating the client
        if (!isKizunaAIEnabled()) {
          throw new Error(`Provider ${provider} is not available in this build`);
        }
        // KizunaAI uses OpenAIClient with our Worker proxy
        // The proxy transparently handles both REST and WebSocket connections
        // The apiKey here is actually the auth token from Clerk
        // Use environment-specific backend URL
        return new OpenAIClient(apiKey, getBackendUrl());
        
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }


} 