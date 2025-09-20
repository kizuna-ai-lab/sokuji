import { ProviderConfig } from './ProviderConfig';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';
import { Provider } from '../../types/Provider';

/**
 * YunAI Provider Configuration
 * YunAI is OpenAI-compatible, so it extends OpenAIProviderConfig and only overrides specific fields
 */
export class YunAIProviderConfig extends OpenAIProviderConfig {
  getConfig(): ProviderConfig {
    // Get the base OpenAI configuration
    const baseConfig = super.getConfig();

    // Override only the fields that are different for YunAI
    return {
      ...baseConfig,
      id: Provider.YUN_AI,
      displayName: 'YunAI',
      apiKeyLabel: 'YunAI Key',
      apiKeyPlaceholder: 'Enter your YunAI key...',
      models: [
        { id: 'gpt-4o-realtime-preview-2024-12-17', type: 'realtime' },
        { id: 'gpt-4o-mini-realtime-preview-2024-12-17', type: 'realtime' }
      ],
      // Override specific defaults that differ from OpenAI
      defaults: {
        ...baseConfig.defaults,
        model: 'gpt-4o-mini-realtime-preview-2024-12-17'
      },
    };
  }
}