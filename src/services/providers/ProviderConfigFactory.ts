import { BaseProviderConfig, ProviderConfig } from './ProviderConfig';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';
import { GeminiProviderConfig } from './GeminiProviderConfig';

export class ProviderConfigFactory {
  private static configs: Map<string, BaseProviderConfig> = new Map();

  static {
    // Initialize configurations
    ProviderConfigFactory.configs.set('openai', new OpenAIProviderConfig());
    ProviderConfigFactory.configs.set('gemini', new GeminiProviderConfig());
  }

  /**
   * Get provider configuration by provider ID
   * @param providerId - The provider identifier
   * @returns ProviderConfig object
   */
  static getConfig(providerId: string): ProviderConfig {
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
  static getAvailableProviders(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Check if a provider is supported
   * @param providerId - The provider identifier
   * @returns boolean
   */
  static isProviderSupported(providerId: string): boolean {
    return this.configs.has(providerId);
  }

  /**
   * Register a new provider configuration
   * @param providerId - The provider identifier
   * @param config - The provider configuration instance
   */
  static registerProvider(providerId: string, config: BaseProviderConfig): void {
    this.configs.set(providerId, config);
  }

  /**
   * Get provider configuration instance (for advanced usage)
   * @param providerId - The provider identifier
   * @returns BaseProviderConfig instance
   */
  static getConfigInstance(providerId: string): BaseProviderConfig {
    const configInstance = this.configs.get(providerId);
    if (!configInstance) {
      throw new Error(`Unsupported provider: ${providerId}`);
    }
    return configInstance;
  }
} 