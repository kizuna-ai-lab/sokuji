import { ProviderConfig } from './ProviderConfig';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';

/**
 * KizunaAI Provider Configuration
 * KizunaAI is OpenAI-compatible, so it extends OpenAIProviderConfig and only overrides specific fields
 */
export class KizunaAIProviderConfig extends OpenAIProviderConfig {
  getConfig(): ProviderConfig {
    // Get the base OpenAI configuration
    const baseConfig = super.getConfig();
    
    // Override only the fields that are different for KizunaAI
    return {
      ...baseConfig,
      id: 'kizunaai',
      displayName: 'KizunaAI',
      apiKeyLabel: 'Kizuna AI Access',
      apiKeyPlaceholder: 'Authentication managed automatically',
      requiresAuth: true, // Special flag indicating this requires backend authentication
      
      // Override specific defaults that differ from OpenAI
      defaults: {
        ...baseConfig.defaults,
        model: 'gpt-4o-mini-realtime-preview', // Different from OpenAI's default
        threshold: 0.49, // Different from OpenAI's 0.5
        prefixPadding: 0.5, // Different from OpenAI's 0.3
        silenceDuration: 0.5, // Different from OpenAI's 0.8
        transcriptModel: 'whisper-1', // Different from OpenAI's 'gpt-4o-mini-transcribe'
      },
    };
  }
}