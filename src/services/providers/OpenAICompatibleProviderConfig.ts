import { ProviderConfig } from './ProviderConfig';
import { OpenAIProviderConfig, OpenAICompatibleSettingsBase, defaultOpenAICompatibleSettingsBase } from './OpenAIProviderConfig';
import { Provider } from '../../types/Provider';
import { Credentials, CredentialCtx, ClientOptions, type CredentialField } from './ProviderDescriptor';
import { IClient, FilteredModel } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { OpenAIClient } from '../clients/OpenAIClient';
import { OpenAIWebRTCClient } from '../clients/OpenAIWebRTCClient';

// OpenAI Compatible Settings (with custom endpoint support)
export interface OpenAICompatibleSettings extends OpenAICompatibleSettingsBase {
  customEndpoint: string;
}

export const defaultOpenAICompatibleSettings: OpenAICompatibleSettings = {
  ...defaultOpenAICompatibleSettingsBase,
  customEndpoint: '',
};

/**
 * OpenAI Compatible Provider Configuration
 * Allows users to specify custom API endpoints that are OpenAI-compatible
 */
export class OpenAICompatibleProviderConfig extends OpenAIProviderConfig {
  readonly settingsSliceKey = 'openaiCompatible';
  readonly i18nKey = 'openaiCompatible';
  readonly supportsWebRTC = true;
  readonly credentialFields: readonly CredentialField[] = [
    { key: 'customEndpoint', labelKey: 'setup.credentials.endpoint', secret: false, placeholderKey: 'setup.credentials.endpointPlaceholder' },
    { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true },
  ];

  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const s = slice as OpenAICompatibleSettings;
    if (!s?.apiKey) return { ok: false, missing: 'API key is required for openai_compatible' };
    return { ok: true, primary: s.apiKey, endpoint: s.customEndpoint };
  }

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

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    if (!creds.endpoint) {
      return {
        validation: { valid: false, message: 'Custom API endpoint is required for OpenAI Compatible provider', validating: false },
        models: [],
      };
    }
    return OpenAIClient.validateApiKeyAndFetchModels(creds.primary, creds.endpoint);
  }

  latestRealtimeModel(models: FilteredModel[]): string {
    return OpenAIClient.getLatestRealtimeModel(models);
  }

  getConfig(): ProviderConfig {
    // Get the base OpenAI configuration
    const baseConfig = super.getConfig();

    // Override fields specific to OpenAI Compatible provider
    return {
      ...baseConfig,
      id: Provider.OPENAI_COMPATIBLE,
      // "Legacy Realtime" is load-bearing, not decoration: this provider speaks
      // the older beta Realtime protocol (createClient below builds the beta
      // `openai-realtime-api` OpenAIClient, while the built-in OpenAI provider
      // builds OpenAIGAClient against the current API). OpenAI has retired that
      // beta, so "OpenAI Compatible" on its own now reads as a promise this
      // provider cannot keep — pointing it at api.openai.com does not work.
      displayName: 'OpenAI Compatible (Legacy Realtime)',
      apiKeyLabel: 'API Key',
      apiKeyPlaceholder: 'Enter your API key...',
      supportsCustomEndpoint: true,
      customEndpointLabel: 'API Endpoint',
      customEndpointPlaceholder: 'https://your-api-endpoint.com',
    };
  }
}
