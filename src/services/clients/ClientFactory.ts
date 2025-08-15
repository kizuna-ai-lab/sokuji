import { IClient } from '../interfaces/IClient';
import { OpenAIClient } from './OpenAIClient';
import { GeminiClient } from './GeminiClient';
import { PalabraAIClient } from './PalabraAIClient';
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
        
      case Provider.GEMINI:
        return new GeminiClient(apiKey);
        
      case Provider.PALABRA_AI:
        if (!clientSecret) {
          throw new Error(`Client secret is required for ${provider} provider`);
        }
        return new PalabraAIClient(apiKey, clientSecret);
        
      case Provider.KIZUNA_AI:
        // KizunaAI uses OpenAIClient with custom backend URL
        // The apiKey should be fetched from the backend API
        const backendUrl = "https://gateway.ai.cloudflare.com/v1/567d673242fea0196daf20a8aa2f92ec/sokuji-gateway-dev/openai";
        return new OpenAIClient(apiKey, backendUrl);
        
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }


} 