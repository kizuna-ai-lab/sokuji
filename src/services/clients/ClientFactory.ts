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

  /**
   * Map voice names between providers if needed
   * @param voice - Original voice name
   * @param fromProvider - Source provider
   * @param toProvider - Target provider
   * @returns Mapped voice name
   */
  static mapVoice(
    voice: string,
    fromProvider: 'openai' | 'gemini',
    toProvider: 'openai' | 'gemini'
  ): string {
    if (fromProvider === toProvider) {
      return voice;
    }

    // OpenAI to Gemini mapping
    if (fromProvider === 'openai' && toProvider === 'gemini') {
      const mapping: { [key: string]: string } = {
        'alloy': 'Puck',
        'ash': 'Charon',
        'ballad': 'Kore',
        'coral': 'Leda',
        'echo': 'Charon',
        'fable': 'Kore',
        'onyx': 'Fenrir',
        'nova': 'Aoede',
        'sage': 'Orus',
        'shimmer': 'Zephyr',
        'verse': 'Algenib'
      };
      return mapping[voice] || 'Aoede'; // Default to Aoede
    }

    // Gemini to OpenAI mapping
    if (fromProvider === 'gemini' && toProvider === 'openai') {
      const mapping: { [key: string]: string } = {
        'Aoede': 'nova',
        'Puck': 'alloy',
        'Charon': 'echo',
        'Kore': 'fable',
        'Fenrir': 'onyx',
        'Leda': 'coral',
        'Orus': 'sage',
        'Zephyr': 'shimmer',
        'Algenib': 'verse',
        // For voices without direct mapping, use reasonable defaults
        'Achird': 'alloy',
        'Algieba': 'ash',
        'Alnilam': 'ballad',
        'Autonoe': 'coral',
        'Callirrhoe': 'echo',
        'Despina': 'fable',
        'Enceladus': 'nova',
        'Erinome': 'onyx',
        'Gacrux': 'sage',
        'Iapetus': 'shimmer',
        'Laomedeia': 'verse',
        'Pulcherrima': 'alloy',
        'Rasalgethi': 'ash',
        'Sadachbia': 'ballad',
        'Sadaltager': 'coral',
        'Schedar': 'echo',
        'Sulafat': 'fable',
        'Umbriel': 'nova',
        'Vindemiatrix': 'onyx',
        'Zubenelgenubi': 'sage',
        'Achernar': 'shimmer'
      };
      return mapping[voice] || 'alloy'; // Default to alloy
    }

    return voice;
  }
} 