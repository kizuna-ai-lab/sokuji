import { ProviderConfig } from './ProviderConfig';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';
import { Provider } from '../../types/Provider';

/**
 * OpenAI Compatible Provider Configuration
 * Allows users to specify custom API endpoints that are OpenAI-compatible
 */
export class OpenAICompatibleProviderConfig extends OpenAIProviderConfig {
  getConfig(): ProviderConfig {
    // Get the base OpenAI configuration
    const baseConfig = super.getConfig();

    // Override fields specific to OpenAI Compatible provider
    return {
      ...baseConfig,
      id: Provider.OPENAI_COMPATIBLE,
      displayName: 'OpenAI Compatible API',
      apiKeyLabel: 'API Key',
      apiKeyPlaceholder: 'Enter your API key...',
      supportsCustomEndpoint: true,
      customEndpointLabel: 'API Endpoint',
      customEndpointPlaceholder: 'https://your-api-endpoint.com',
    };
  }
}
