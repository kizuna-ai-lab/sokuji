import { ProviderConfig } from './ProviderConfig';
import { ProviderDescriptor } from './ProviderDescriptor';
import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
import { Provider, ProviderType } from '../../types/Provider';
import { isLocalNativeEnabled, isElectron } from '../../utils/environment';

export class ProviderConfigFactory {
  private static configs: Map<ProviderType, ProviderDescriptor> = new Map();

  static {
    // Local Native, the one provider the old registry still holds (Stage 2
    // deletion, ruling 1): Electron only, behind its gate. Every other
    // provider is the new registry's (`src/providers/registry.ts`).
    if (isElectron() && isLocalNativeEnabled()) {
      ProviderConfigFactory.configs.set(Provider.LOCAL_NATIVE, new LocalNativeProviderConfig());
    }
  }

  /**
   * Get provider configuration by provider ID
   * @param providerId - The provider identifier
   * @returns ProviderConfig object
   */
  static getConfig(providerId: ProviderType): ProviderConfig {
    const configInstance = this.configs.get(providerId);
    if (!configInstance) {
      throw new Error(`Unsupported provider: ${providerId}`);
    }
    return configInstance.getConfig();
  }

  /**
   * Get all available provider configurations
   * @returns Array of all provider configurations
   */
  static getAllConfigs(): ProviderConfig[] {
    return Array.from(this.configs.values()).map(config => config.getConfig());
  }

  /**
   * Get all available provider IDs
   * @returns Array of provider IDs
   */
  static getAvailableProviders(): ProviderType[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Check if a provider is supported
   * @param providerId - The provider identifier
   * @returns boolean
   */
  static isProviderSupported(providerId: ProviderType): boolean {
    return this.configs.has(providerId);
  }

  /**
   * Register a new provider configuration
   * @param providerId - The provider identifier
   * @param config - The provider descriptor instance
   */
  static registerProvider(providerId: ProviderType, config: ProviderDescriptor): void {
    this.configs.set(providerId, config);
  }

  /**
   * Get the full provider descriptor — the deep module for one provider's
   * behavior. Callers should prefer this over getConfig() when they need
   * more than static config data.
   * @param providerId - The provider identifier
   * @returns ProviderDescriptor instance
   */
  static getDescriptor(providerId: ProviderType): ProviderDescriptor {
    const d = this.configs.get(providerId);
    if (!d) throw new Error(`Unsupported provider: ${providerId}`);
    return d;
  }
}