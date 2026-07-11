import { ProviderConfig } from './ProviderConfig';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';
import { Provider } from '../../types/Provider';
import { Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient } from '../interfaces/IClient';
import { OpenAIClient } from '../clients/OpenAIClient';
import { OpenAIWebRTCClient } from '../clients/OpenAIWebRTCClient';

/**
 * OpenAI Compatible Provider Configuration
 * Allows users to specify custom API endpoints that are OpenAI-compatible
 */
export class OpenAICompatibleProviderConfig extends OpenAIProviderConfig {
  readonly settingsSliceKey = 'openaiCompatible';
  readonly i18nKey = 'openaiCompatible';
  readonly supportsWebRTC = true;

  createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient {
    if (!creds.endpoint) throw new Error('Custom endpoint is required for openai_compatible provider');
    if (options.transport === 'webrtc') {
      return new OpenAIWebRTCClient({
        apiKey: creds.primary,
        apiHost: creds.endpoint,
        inputDeviceId: options.webrtcOptions?.inputDeviceId,
        outputDeviceId: options.webrtcOptions?.outputDeviceId,
      });
    }
    return new OpenAIClient(creds.primary, creds.endpoint);
  }

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
