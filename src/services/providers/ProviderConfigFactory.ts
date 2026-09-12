import { ProviderConfig } from './ProviderConfig';
import { ProviderDescriptor } from './ProviderDescriptor';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';
import { GeminiProviderConfig } from './GeminiProviderConfig';
import { OpenAICompatibleProviderConfig } from './OpenAICompatibleProviderConfig';
import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
import { OpenAILiveProviderConfig } from './OpenAILiveProviderConfig';
import { PalabraAIProviderConfig } from './PalabraAIProviderConfig';
import { KizunaAIOpenAITranslateProviderConfig } from './KizunaAIOpenAITranslateProviderConfig';
import { KizunaAIVolcengineAST2ProviderConfig } from './KizunaAIVolcengineAST2ProviderConfig';
import { KizunaAISonioxProviderConfig } from './KizunaAISonioxProviderConfig';
import { VolcengineSTProviderConfig } from './VolcengineSTProviderConfig';
import { VolcengineAST2ProviderConfig } from './VolcengineAST2ProviderConfig';
import { LocalInferenceProviderConfig } from './LocalInferenceProviderConfig';
import { LocalNativeProviderConfig } from './LocalNativeProviderConfig';
import { ZoomAIProviderConfig } from './ZoomAIProviderConfig';
import { SonioxProviderConfig } from './SonioxProviderConfig';
import { Provider, ProviderType } from '../../types/Provider';
import { isKizunaAIEnabled, isKizunaSonioxEnabled, isKizunaOpenAITranslateEnabled, isKizunaVolcengineAST2Enabled, isPalabraAIEnabled, isLocalNativeEnabled, isElectron, isExtension } from '../../utils/environment';

export class ProviderConfigFactory {
  private static configs: Map<ProviderType, ProviderDescriptor> = new Map();

  static {
    // Registration order here defines the order providers appear in the UI
    // list (the configs Map preserves insertion order). Each provider keeps
    // its own environment / feature-flag guard. The order is a product
    // decision (2026-09-12): Kizuna-managed first, then Free, Gemini, Doubao
    // AST 2.0, the three OpenAI providers, Soniox, OpenAI Compatible, Palabra,
    // then everything else.

    // 1. Kizuna-managed providers — behind the master Kizuna gate plus their
    //    own gates. Each managed provider carries its OWN gate: they are
    //    released independently, and they bill on different models whose
    //    rates the wallet page publishes one at a time. A shared gate could
    //    not express "ship this one alone", which is what independent release
    //    means. Same order as getDefaultManagedProvider's preference list.
    if (isKizunaAIEnabled()) {
      if (isKizunaSonioxEnabled()) {
        ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_SONIOX, new KizunaAISonioxProviderConfig());
      }
      if (isKizunaOpenAITranslateEnabled()) {
        ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_OPENAI_TRANSLATE, new KizunaAIOpenAITranslateProviderConfig());
      }
      if (isKizunaVolcengineAST2Enabled()) {
        ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_VOLCENGINE_AST2, new KizunaAIVolcengineAST2ProviderConfig());
      }
    }

    // 2. Free (local inference) — always available, no API key or flag.
    ProviderConfigFactory.configs.set(Provider.LOCAL_INFERENCE, new LocalInferenceProviderConfig());

    // 3. Gemini
    ProviderConfigFactory.configs.set(Provider.GEMINI, new GeminiProviderConfig());

    // 4. Doubao AST 2.0 — always available, but only in Electron (IPC proxy) and
    //    the extension (declarativeNetRequest header injection), which it
    //    technically requires.
    if (isElectron() || isExtension()) {
      ProviderConfigFactory.configs.set(Provider.VOLCENGINE_AST2, new VolcengineAST2ProviderConfig());
    }

    // 5. The three OpenAI providers: Realtime, Translate, Live.
    ProviderConfigFactory.configs.set(Provider.OPENAI, new OpenAIProviderConfig());
    ProviderConfigFactory.configs.set(Provider.OPENAI_TRANSLATE, new OpenAITranslateProviderConfig());
    // OpenAI Live (gpt-live-1) — the Live WebSocket needs an Authorization
    // header on the upgrade, which only Electron (webRequest) and the
    // extension (declarativeNetRequest) can inject. The web build has no way
    // to, so the provider is not offered there.
    if (isElectron() || isExtension()) {
      ProviderConfigFactory.configs.set(Provider.OPENAI_LIVE, new OpenAILiveProviderConfig());
    }

    // 6. Soniox speech-to-speech translation — always available (BYOK).
    ProviderConfigFactory.configs.set(Provider.SONIOX, new SonioxProviderConfig());

    // 7. OpenAI Compatible — Electron only.
    if (isElectron()) {
      ProviderConfigFactory.configs.set(Provider.OPENAI_COMPATIBLE, new OpenAICompatibleProviderConfig());
    }

    // 8. Palabra AI — behind its feature flag.
    if (isPalabraAIEnabled()) {
      ProviderConfigFactory.configs.set(Provider.PALABRA_AI, new PalabraAIProviderConfig());
    }

    // 9. Everything else.
    // Native (Electron sidecar) local inference — Electron only, behind feature flag.
    if (isElectron() && isLocalNativeEnabled()) {
      ProviderConfigFactory.configs.set(Provider.LOCAL_NATIVE, new LocalNativeProviderConfig());
    }
    // Volcengine Speech Translate — always available (stable).
    ProviderConfigFactory.configs.set(Provider.VOLCENGINE_ST, new VolcengineSTProviderConfig());
    // Zoom AI Services — always available (stable).
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
  /**
   * The Kizuna-managed provider to put a Basic-mode user on when they sign
   * in, or null when this build offers none.
   *
   * Derived from what is REGISTERED rather than from a feature flag. The
   * managed providers are gated independently, so `isKizunaAIEnabled()` no
   * longer implies any particular one exists — a caller that hardcoded the
   * Translate twin would set a provider `getDescriptor` then throws on.
   *
   * Soniox first: it is the only managed provider open in production, and
   * the wallet page states its rates. The twins stay as fallbacks for
   * builds that register them alone.
   */
  static getDefaultManagedProvider(): ProviderType | null {
    const preferred = [
      Provider.KIZUNA_AI_SONIOX,
      Provider.KIZUNA_AI_OPENAI_TRANSLATE,
      Provider.KIZUNA_AI_VOLCENGINE_AST2,
    ];
    return preferred.find((p) => this.configs.has(p)) ?? null;
  }

  static getDescriptor(providerId: ProviderType): ProviderDescriptor {
    const d = this.configs.get(providerId);
    if (!d) throw new Error(`Unsupported provider: ${providerId}`);
    return d;
  }
}