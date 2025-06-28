import { ProviderConfig } from './ProviderConfig';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';
import { Provider } from '../../types/Provider';

/**
 * CometAPI Provider Configuration
 * CometAPI is OpenAI-compatible, so it extends OpenAIProviderConfig and only overrides specific fields
 */
export class CometAPIProviderConfig extends OpenAIProviderConfig {
  getConfig(): ProviderConfig {
    // Get the base OpenAI configuration
    const baseConfig = super.getConfig();
    
    // Override only the fields that are different for CometAPI
    return {
      ...baseConfig,
      id: Provider.COMET_API,
      displayName: 'CometAPI',
      apiKeyLabel: 'CometAPI Key',
      apiKeyPlaceholder: 'Enter your CometAPI key...'
    };
  }
} 