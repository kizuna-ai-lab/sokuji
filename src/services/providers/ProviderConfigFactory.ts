import { ProviderConfig } from './ProviderConfig';
import { ProviderDescriptor } from './ProviderDescriptor';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';
import { GeminiProviderConfig } from './GeminiProviderConfig';
import { OpenAICompatibleProviderConfig } from './OpenAICompatibleProviderConfig';
import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
import { KizunaAIOpenAITranslateProviderConfig } from './KizunaAIOpenAITranslateProviderConfig';
import { KizunaAIVolcengineAST2ProviderConfig } from './KizunaAIVolcengineAST2ProviderConfig';
import { VolcengineSTProviderConfig } from './VolcengineSTProviderConfig';
import { VolcengineAST2ProviderConfig } from './VolcengineAST2ProviderConfig';
import { LocalInferenceProviderConfig } from './LocalInferenceProviderConfig';
import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
import { ZoomAIProviderConfig } from './ZoomAIProviderConfig';
import { SonioxProviderConfig } from './SonioxProviderConfig';
import { Provider, ProviderType } from '../../types/Provider';
import { isKizunaAIEnabled, isPalabraAIEnabled, isLocalNativeEnabled, isElectron, isExtension } from '../../utils/environment';

export class ProviderConfigFactory {
  private static configs: Map<ProviderType, ProviderDescriptor> = new Map();

  static {
    // Registration order here defines the order providers appear in the UI
    // list (the configs Map preserves insertion order). Each provider keeps
    // its own environment / feature-flag guard.

    ProviderConfigFactory.configs.set(Provider.OPENAI, new OpenAIProviderConfig());
    ProviderConfigFactory.configs.set(Provider.OPENAI_TRANSLATE, new OpenAITranslateProviderConfig());

    // Local inference is always available (no API key or feature flag required)
    ProviderConfigFactory.configs.set(Provider.LOCAL_INFERENCE, new LocalInferenceProviderConfig());

    // Native (Electron sidecar) local inference — Electron only, behind feature flag
    if (isElectron() && isLocalNativeEnabled()) {
      ProviderConfigFactory.configs.set(Provider.LOCAL_NATIVE, new LocalNativeProviderConfig());
    }

    // Soniox speech-to-speech translation — always available (BYOK)
    ProviderConfigFactory.configs.set(Provider.SONIOX, new SonioxProviderConfig());

    // Volcengine AST 2.0 — always available, but only in Electron (IPC proxy) and
    // Extension (declarativeNetRequest header injection), which it technically requires
    if (isElectron() || isExtension()) {
      ProviderConfigFactory.configs.set(Provider.VOLCENGINE_AST2, new VolcengineAST2ProviderConfig());
    }

    ProviderConfigFactory.configs.set(Provider.GEMINI, new GeminiProviderConfig());

    // Only register Palabra AI if the feature flag is enabled
    if (isPalabraAIEnabled()) {
      ProviderConfigFactory.configs.set(Provider.PALABRA_AI, new PalabraAIProviderConfig());
    }

    // Only register Kizuna AI if the feature flag is enabled
    if (isKizunaAIEnabled()) {
      ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_OPENAI_TRANSLATE, new KizunaAIOpenAITranslateProviderConfig());
      ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_VOLCENGINE_AST2, new KizunaAIVolcengineAST2ProviderConfig());
    }

    // Only register OpenAI Compatible provider in Electron environment
    if (isElectron()) {
      ProviderConfigFactory.configs.set(Provider.OPENAI_COMPATIBLE, new OpenAICompatibleProviderConfig());
    }

    // Volcengine Speech Translate — always available (stable)
    ProviderConfigFactory.configs.set(Provider.VOLCENGINE_ST, new VolcengineSTProviderConfig());

    // Zoom AI Services — always available (stable)
    ProviderConfigFactory.configs.set(Provider.ZOOM_AI, new ZoomAIProviderConfig());
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