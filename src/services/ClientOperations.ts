import { ApiKeyValidationResult } from './interfaces/ISettingsService';
import { FilteredModel } from './interfaces/IClient';
import { ProviderType } from '../types/Provider';
import { ProviderConfigFactory } from './providers/ProviderConfigFactory';

/**
 * @deprecated Thin façade kept for legacy callers and tests. New code should
 * resolve the descriptor via ProviderConfigFactory.getDescriptor(provider)
 * directly instead of going through this class.
 */
export class ClientOperations {
  static async validateApiKeyAndFetchModels(
    apiKey: string, provider: ProviderType, clientSecret?: string, customEndpoint?: string
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    return ProviderConfigFactory.getDescriptor(provider).validateAndFetchModels(
      apiKey
        ? { ok: true, primary: apiKey, secret: clientSecret, endpoint: customEndpoint }
        : { ok: false, missing: `API key is required for ${provider}` }
    );
  }

  static getLatestRealtimeModel(filteredModels: FilteredModel[], provider: ProviderType): string {
    return ProviderConfigFactory.getDescriptor(provider).latestRealtimeModel(filteredModels);
  }

  static getSupportedProviders(): ProviderType[] {
    return ProviderConfigFactory.getAvailableProviders();
  }

  static isSupportedProvider(provider: string): provider is ProviderType {
    return ProviderConfigFactory.isProviderSupported(provider as ProviderType);
  }
}
