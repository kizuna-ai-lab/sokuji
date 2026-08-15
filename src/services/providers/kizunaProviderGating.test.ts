/**
 * The three Kizuna-managed providers are released independently, and only
 * Soniox is released today.
 *
 * They used to share one gate, so `VITE_ENABLE_KIZUNA_AI=true` — the switch
 * that has to be on to ship Soniox at all — offered all three. That matters
 * beyond tidiness: the relay twins bill per second of session time while
 * Soniox bills on reported usage, and the wallet page states only Soniox's
 * rates, so a user who picked Volcengine would be charged at one rate and
 * shown another.
 *
 * Every other suite runs with `import.meta.env.DEV` true, where the relay gate
 * is deliberately open — so nothing else here exercises the shipped
 * configuration. This file is the only place that does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from '../../types/Provider';

const RELAY_TWINS = [
  Provider.KIZUNA_AI_OPENAI_TRANSLATE,
  Provider.KIZUNA_AI_VOLCENGINE_AST2,
] as const;

/** Fresh factory per case: the config map is static, so a module reused across
 *  cases would keep whichever gating ran first. */
async function factoryWith(relayEnabled: boolean) {
  vi.resetModules();
  vi.doMock('../../utils/environment', async (orig) => ({
    ...(await orig<any>()),
    isKizunaAIEnabled: () => true,
    isKizunaRelayProvidersEnabled: () => relayEnabled,
    isPalabraAIEnabled: () => false,
    isLocalNativeEnabled: () => false,
    isElectron: () => true,
    isExtension: () => false,
    getRelayWsUrl: () => 'wss://r.example/v1',
  }));
  const { ProviderConfigFactory } = await import('./ProviderConfigFactory');
  return ProviderConfigFactory;
}

async function providersWith(relayEnabled: boolean): Promise<Provider[]> {
  vi.resetModules();
  vi.doMock('../../utils/environment', async (orig) => ({
    ...(await orig<any>()),
    isKizunaAIEnabled: () => true,
    isKizunaRelayProvidersEnabled: () => relayEnabled,
    isPalabraAIEnabled: () => false,
    isLocalNativeEnabled: () => false,
    isElectron: () => true,
    isExtension: () => false,
    getRelayWsUrl: () => 'wss://r.example/v1',
  }));
  const { ProviderConfigFactory } = await import('./ProviderConfigFactory');
  return ProviderConfigFactory.getAvailableProviders();
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('../../utils/environment');
});

describe('Kizuna managed providers are gated independently', () => {
  it('offers Soniox but not the relay twins when only Soniox is released', async () => {
    const providers = await providersWith(false);

    expect(providers).toContain(Provider.KIZUNA_AI_SONIOX);
    for (const twin of RELAY_TWINS) {
      expect(providers).not.toContain(twin);
    }
  });

  it('offers all three once the relay gate is opened', async () => {
    const providers = await providersWith(true);

    expect(providers).toContain(Provider.KIZUNA_AI_SONIOX);
    for (const twin of RELAY_TWINS) {
      expect(providers).toContain(twin);
    }
  });

  // The master gate still governs all of them: a build with Kizuna off offers
  // none, whatever the relay gate says.
  it('offers none of them when the master Kizuna gate is off', async () => {
    vi.resetModules();
    vi.doMock('../../utils/environment', async (orig) => ({
      ...(await orig<any>()),
      isKizunaAIEnabled: () => false,
      isKizunaRelayProvidersEnabled: () => true,
      isPalabraAIEnabled: () => false,
      isLocalNativeEnabled: () => false,
      isElectron: () => true,
      isExtension: () => false,
      getRelayWsUrl: () => 'wss://r.example/v1',
    }));
    const { ProviderConfigFactory } = await import('./ProviderConfigFactory');
    const providers = ProviderConfigFactory.getAvailableProviders();

    expect(providers).not.toContain(Provider.KIZUNA_AI_SONIOX);
    for (const twin of RELAY_TWINS) {
      expect(providers).not.toContain(twin);
    }
  });

  // BYOK Soniox is not gated at all and must stay reachable in every build —
  // it is the provider a user brings their own key to.
  it('leaves BYOK Soniox available regardless of either gate', async () => {
    expect(await providersWith(false)).toContain(Provider.SONIOX);
    expect(await providersWith(true)).toContain(Provider.SONIOX);
  });
});

describe('the sign-in default must be a provider this build registered', () => {
  // Codex on #415. MainLayout auto-selects a managed provider when a Basic-mode
  // user signs in. It used to hardcode the Translate twin, guarded on
  // isKizunaAIEnabled() — which was sound only while that flag was what
  // registered the twin. Once the gates split, the shipping build (Kizuna on,
  // relay off) would set an UNREGISTERED provider, and the getDescriptor calls
  // throughout MainPanel/ProviderSection throw on the next render: signing in
  // would break the app outright.
  it('falls back to managed Soniox when the relay twins are not registered', async () => {
    const factory = await factoryWith(false);
    const target = factory.getDefaultManagedProvider();

    expect(target).toBe(Provider.KIZUNA_AI_SONIOX);
    // The property that actually matters: whatever it returns must resolve.
    expect(() => factory.getDescriptor(target!)).not.toThrow();
  });

  it('keeps preferring the Translate twin where it is registered', async () => {
    const factory = await factoryWith(true);
    const target = factory.getDefaultManagedProvider();

    expect(target).toBe(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(() => factory.getDescriptor(target!)).not.toThrow();
  });

  it('returns null rather than an unusable provider when none is registered', async () => {
    vi.resetModules();
    vi.doMock('../../utils/environment', async (orig) => ({
      ...(await orig<any>()),
      isKizunaAIEnabled: () => false,
      isKizunaRelayProvidersEnabled: () => false,
      isPalabraAIEnabled: () => false,
      isLocalNativeEnabled: () => false,
      isElectron: () => true,
      isExtension: () => false,
      getRelayWsUrl: () => 'wss://r.example/v1',
    }));
    const { ProviderConfigFactory } = await import('./ProviderConfigFactory');

    expect(ProviderConfigFactory.getDefaultManagedProvider()).toBeNull();
  });
});
