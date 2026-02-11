import { ProviderConfig } from './ProviderConfig';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';
import { GeminiProviderConfig } from './GeminiProviderConfig';
import { OpenAICompatibleProviderConfig } from './OpenAICompatibleProviderConfig';
import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
import { KizunaAIProviderConfig } from './KizunaAIProviderConfig';
import { VolcengineSTProviderConfig } from './VolcengineSTProviderConfig';
import { VolcengineAST2ProviderConfig } from './VolcengineAST2ProviderConfig';
import { Provider, ProviderType } from '../../types/Provider';
import { isKizunaAIEnabled, isPalabraAIEnabled, isVolcengineSTEnabled, isVolcengineAST2Enabled, isElectron } from '../../utils/environment';

interface ProviderConfigInstance {
  getConfig(): ProviderConfig;
}

export class ProviderConfigFactory {
  private static configs: Map<ProviderType, ProviderConfigInstance> = new Map();

  static {
    // Initialize configurations
    ProviderConfigFactory.configs.set(Provider.OPENAI, new OpenAIProviderConfig());
    ProviderConfigFactory.configs.set(Provider.GEMINI, new GeminiProviderConfig());

    // Only register Palabra AI if the feature flag is enabled
    if (isPalabraAIEnabled()) {
      ProviderConfigFactory.configs.set(Provider.PALABRA_AI, new PalabraAIProviderConfig());
    }

    // Only register Kizuna AI if the feature flag is enabled
    if (isKizunaAIEnabled()) {
      ProviderConfigFactory.configs.set(Provider.KIZUNA_AI, new KizunaAIProviderConfig());
    }

    // Only register OpenAI Compatible provider in Electron environment
    if (isElectron()) {
      ProviderConfigFactory.configs.set(Provider.OPENAI_COMPATIBLE, new OpenAICompatibleProviderConfig());
    }

    // Only register Volcengine Speech Translate if the feature flag is enabled
    if (isVolcengineSTEnabled()) {
      ProviderConfigFactory.configs.set(Provider.VOLCENGINE_ST, new VolcengineSTProviderConfig());
    }

    // Only register Volcengine AST 2.0 in Electron (requires header injection for WebSocket auth)
    if (isElectron() && isVolcengineAST2Enabled()) {
      ProviderConfigFactory.configs.set(Provider.VOLCENGINE_AST2, new VolcengineAST2ProviderConfig());
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
   * @param config - The provider configuration instance
   */
  static registerProvider(providerId: ProviderType, config: ProviderConfigInstance): void {
    this.configs.set(providerId, config);
  }

  /**
   * Get provider configuration instance (for advanced usage)
   * @param providerId - The provider identifier
   * @returns ProviderConfigInstance instance
   */
  static getConfigInstance(providerId: ProviderType): ProviderConfigInstance {
    const configInstance = this.configs.get(providerId);
    if (!configInstance) {
      throw new Error(`Unsupported provider: ${providerId}`);
    }
    return configInstance;
  }
} 