import { ProviderConfig } from './ProviderConfig';
import { ProviderDescriptor } from './ProviderDescriptor';
import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
import { LocalInferenceProviderConfig } from './LocalInferenceProviderConfig';
import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
import { Provider, ProviderType } from '../../types/Provider';
import { isPalabraAIEnabled, isLocalNativeEnabled, isElectron } from '../../utils/environment';

export class ProviderConfigFactory {
  private static configs: Map<ProviderType, ProviderDescriptor> = new Map();

  static {
    // Registration order here defines the order providers appear in the UI
    // list (the configs Map preserves insertion order). Each provider keeps
    // its own environment / feature-flag guard. The order is a product
    // decision (2026-09-12): Kizuna-managed first, then Free, Gemini, Doubao
    // AST 2.0, the three OpenAI providers, Soniox, OpenAI Compatible, Palabra,
    // then everything else.

    // 2. Free (local inference) — always available, no API key or flag.
    ProviderConfigFactory.configs.set(Provider.LOCAL_INFERENCE, new LocalInferenceProviderConfig());

    // 8. Palabra AI — behind its feature flag.
    if (isPalabraAIEnabled()) {
      ProviderConfigFactory.configs.set(Provider.PALABRA_AI, new PalabraAIProviderConfig());
    }

    // 9. Everything else.
    // Native (Electron sidecar) local inference — Electron only, behind feature flag.
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