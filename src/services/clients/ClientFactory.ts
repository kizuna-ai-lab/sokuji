import { IClient } from '../interfaces/IClient';
import { OpenAIClient } from './OpenAIClient';
import { GeminiClient } from './GeminiClient';

/**
 * Factory for creating AI client instances
 * Determines the appropriate client based on model name and API keys
 */
export class ClientFactory {
  /**
   * Create an AI client instance based on the model name
   * @param model - The model name to determine which client to use
   * @param openaiApiKey - OpenAI API key
   * @param geminiApiKey - Gemini API key
   * @returns IClient instance
   */
  static createClient(
    model: string,
    openaiApiKey?: string,
    geminiApiKey?: string
  ): IClient {
    // Determine provider based on model name
    const provider = this.getProviderFromModel(model);
    
    switch (provider) {
      case 'openai':
        if (!openaiApiKey) {
          throw new Error('OpenAI API key is required for OpenAI models');
        }
        return new OpenAIClient(openaiApiKey);
        
      case 'gemini':
        if (!geminiApiKey) {
          throw new Error('Gemini API key is required for Gemini models');
        }
        return new GeminiClient(geminiApiKey);
        
      default:
        throw new Error(`Unsupported model: ${model}`);
    }
  }

  /**
   * Determine the provider based on model name
   * @param model - The model name
   * @returns Provider name
   */
  static getProviderFromModel(model: string): 'openai' | 'gemini' {
    // OpenAI models
    if (model.startsWith('gpt-')) {
      return 'openai';
    }
    
    // Gemini models
    if (model.startsWith('gemini-')) {
      return 'gemini';
    }
    
    // Default fallback (could be made configurable)
    return 'openai';
  }


} 