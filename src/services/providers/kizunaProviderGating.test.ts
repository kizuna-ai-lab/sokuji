/**
 * The three Kizuna-managed providers are released independently, so each one
 * carries its OWN gate.
 *
 * They used to share one gate, so `VITE_ENABLE_KIZUNA_AI=true` — the switch
 * that has to be on to ship any of them — offered all three. That matters
 * beyond tidiness: the relay twins bill per second of session time while
 * Soniox bills on reported usage, and the wallet page states only Soniox's
 * rates, so a user who picked Volcengine would be charged at one rate and
 * shown another.
 *
 * A first split gave the two relay twins one shared gate and left Soniox
 * pinned to the master switch. That still could not express "ship Volcengine
 * alone" or "hold Soniox back", which is what independent release actually
 * means, so the gates are now per provider.
 *
 * Every other suite runs with `import.meta.env.DEV` true, where all the gates
 * are deliberately open — so nothing else here exercises a shipped
 * configuration. This file is the only place that does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from '../../types/Provider';

/** Which managed providers a build offers. Omitted means off, so each case
 *  names only the gates it is actually about. */
interface Gates {
  master?: boolean;
  soniox?: boolean;
  openaiTranslate?: boolean;
  volcengineAst2?: boolean;
}

const MANAGED = [
  Provider.KIZUNA_AI_SONIOX,
  Provider.KIZUNA_AI_OPENAI_TRANSLATE,
  Provider.KIZUNA_AI_VOLCENGINE_AST2,
] as const;

/** Fresh module graph per case: the config map is static, so a module reused
 *  across cases would keep whichever gating ran first. */
function mockEnv(gates: Gates) {
  vi.resetModules();
  vi.doMock('../../utils/environment', async (orig) => ({
    ...(await orig<any>()),
    isKizunaAIEnabled: () => gates.master ?? true,
    isKizunaSonioxEnabled: () => gates.soniox ?? false,
    isKizunaOpenAITranslateEnabled: () => gates.openaiTranslate ?? false,
    isKizunaVolcengineAST2Enabled: () => gates.volcengineAst2 ?? false,
    isPalabraAIEnabled: () => false,
    isLocalNativeEnabled: () => false,
    isElectron: () => true,
    isExtension: () => false,
    getRelayWsUrl: () => 'wss://r.example/v1',
  }));
}

async function factoryWith(gates: Gates) {
  mockEnv(gates);
  const { ProviderConfigFactory } = await import('./ProviderConfigFactory');
  return ProviderConfigFactory;
}

async function providersWith(gates: Gates): Promise<Provider[]> {
  return (await factoryWith(gates)).getAvailableProviders();
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('../../utils/environment');
});

describe('each Kizuna managed provider is gated on its own', () => {
  it('offers Soniox alone when only its gate is open', async () => {
    const providers = await providersWith({ soniox: true });

    expect(providers).toContain(Provider.KIZUNA_AI_SONIOX);
    expect(providers).not.toContain(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(providers).not.toContain(Provider.KIZUNA_AI_VOLCENGINE_AST2);
  });

  // The case the shared relay gate could not express: holding Soniox back
  // while another managed provider ships.
  it('holds Soniox back while a relay twin ships', async () => {
    const providers = await providersWith({ openaiTranslate: true });

    expect(providers).not.toContain(Provider.KIZUNA_AI_SONIOX);
    expect(providers).toContain(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(providers).not.toContain(Provider.KIZUNA_AI_VOLCENGINE_AST2);
  });

  // The other case it could not express: the two twins were welded together.
  it('separates the two relay twins from each other', async () => {
    const providers = await providersWith({ volcengineAst2: true });

    expect(providers).not.toContain(Provider.KIZUNA_AI_SONIOX);
    expect(providers).not.toContain(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(providers).toContain(Provider.KIZUNA_AI_VOLCENGINE_AST2);
  });

  it('offers all three when every gate is open', async () => {
    const providers = await providersWith({
      soniox: true,
      openaiTranslate: true,
      volcengineAst2: true,
    });

    for (const p of MANAGED) {
      expect(providers).toContain(p);
    }
  });

  it('offers none when every gate is closed', async () => {
    const providers = await providersWith({});

    for (const p of MANAGED) {
      expect(providers).not.toContain(p);
    }
  });

  // The master gate still governs all of them: it is the "this is a Kizuna
  // build" switch, and it also drives the account UI and onboarding, which are
  // not per-provider concerns.
  it('offers none of them when the master Kizuna gate is off', async () => {
    const providers = await providersWith({
      master: false,
      soniox: true,
      openaiTranslate: true,
      volcengineAst2: true,
    });

    for (const p of MANAGED) {
      expect(providers).not.toContain(p);
    }
  });

  // BYOK Soniox is not gated at all and must stay reachable in every build —
  // it is the provider a user brings their own key to. In particular, closing
  // the MANAGED Soniox gate must not take it with it.
  it('leaves BYOK Soniox available whatever the managed gates say', async () => {
    expect(await providersWith({})).toContain(Provider.SONIOX);
    expect(await providersWith({ soniox: true })).toContain(Provider.SONIOX);
    expect(await providersWith({ master: false })).toContain(Provider.SONIOX);
  });
});

describe('the sign-in default must be a provider this build registered', () => {
  // Codex on #415. MainLayout auto-selects a managed provider when a Basic-mode
  // user signs in. It used to hardcode the Translate twin, guarded on
  // isKizunaAIEnabled() — which was sound only while that flag was what
  // registered the twin. Once the gates split, a build that registers a
  // different set would set an UNREGISTERED provider, and the getDescriptor
  // calls throughout MainPanel/ProviderSection throw on the next render:
  // signing in would break the app outright.
  it('falls back to managed Soniox when the relay twins are not registered', async () => {
    const factory = await factoryWith({ soniox: true });
    const target = factory.getDefaultManagedProvider();

    expect(target).toBe(Provider.KIZUNA_AI_SONIOX);
    // The property that actually matters: whatever it returns must resolve.
    expect(() => factory.getDescriptor(target!)).not.toThrow();
  });

  it('prefers managed Soniox where it is registered alongside the twins', async () => {
    const factory = await factoryWith({
      soniox: true,
      openaiTranslate: true,
      volcengineAst2: true,
    });
    const target = factory.getDefaultManagedProvider();

    expect(target).toBe(Provider.KIZUNA_AI_SONIOX);
    expect(() => factory.getDescriptor(target!)).not.toThrow();
  });

  it('falls back to the Translate twin only when Soniox is not registered', async () => {
    const factory = await factoryWith({ openaiTranslate: true, volcengineAst2: true });
    const target = factory.getDefaultManagedProvider();

    expect(target).toBe(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(() => factory.getDescriptor(target!)).not.toThrow();
  });

  // Per-provider gating makes a build offering only the AST2 twin possible for
  // the first time; the default has to follow what is registered, not the
  // preference order's first entry.
  it('lands on the AST2 twin when it is the only one registered', async () => {
    const factory = await factoryWith({ volcengineAst2: true });
    const target = factory.getDefaultManagedProvider();

    expect(target).toBe(Provider.KIZUNA_AI_VOLCENGINE_AST2);
    expect(() => factory.getDescriptor(target!)).not.toThrow();
  });

  it('returns null rather than an unusable provider when none is registered', async () => {
    const factory = await factoryWith({ master: false });

    expect(factory.getDefaultManagedProvider()).toBeNull();
  });
});

describe('the legacy kizunaai migration must land on a registered provider', () => {
  // Codex on #415. `migrateLegacyKizunaProvider` rewrote a persisted 'kizunaai'
  // to the Translate twin, and its own comment promised "stranded users land on
  // a supported provider". Splitting the gates broke that promise: in a build
  // that ships Soniox alone the twin is unregistered, `loadSettings` rejects it
  // at `isProviderSupported`, and the user silently drops to BYOK OpenAI — from
  // a managed provider to one needing their own API key. Advanced-mode users
  // are not rescued by the Basic-mode sign-in switch, so nothing corrects it.
  async function migrateWith(gates: Gates) {
    mockEnv(gates);
    const { migrateLegacyKizunaProvider } = await import('../../stores/settingsStore');
    const { ProviderConfigFactory } = await import('./ProviderConfigFactory');
    return { migrateLegacyKizunaProvider, ProviderConfigFactory };
  }

  it('sends a legacy user to managed Soniox when the twins are not registered', async () => {
    const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({ soniox: true });
    const migrated = migrateLegacyKizunaProvider('kizunaai');

    expect(migrated).toBe(Provider.KIZUNA_AI_SONIOX);
    // The property that matters: the migration target must survive the
    // isProviderSupported check that `loadSettings` puts it through.
    expect(ProviderConfigFactory.isProviderSupported(migrated)).toBe(true);
  });

  it('sends a legacy user to managed Soniox even where the twins are registered', async () => {
    const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({
      soniox: true,
      openaiTranslate: true,
      volcengineAst2: true,
    });
    const migrated = migrateLegacyKizunaProvider('kizunaai');

    expect(migrated).toBe(Provider.KIZUNA_AI_SONIOX);
    expect(ProviderConfigFactory.isProviderSupported(migrated)).toBe(true);
  });

  // The likelier case, and the one the first fix missed: a user who ACTUALLY
  // SELECTED a twin in an earlier build has that exact value persisted, not
  // the ancient 'kizunaai' string.
  it('redirects a persisted twin the build no longer registers', async () => {
    const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({ soniox: true });

    for (const twin of [Provider.KIZUNA_AI_OPENAI_TRANSLATE, Provider.KIZUNA_AI_VOLCENGINE_AST2]) {
      const migrated = migrateLegacyKizunaProvider(twin);
      expect(migrated).toBe(Provider.KIZUNA_AI_SONIOX);
      expect(ProviderConfigFactory.isProviderSupported(migrated)).toBe(true);
    }
  });

  // Per-provider gating makes managed Soniox redirectable too, which the
  // shared relay gate never allowed.
  it('redirects persisted managed Soniox when its own gate is closed', async () => {
    const { migrateLegacyKizunaProvider, ProviderConfigFactory } = await migrateWith({ openaiTranslate: true });
    const migrated = migrateLegacyKizunaProvider(Provider.KIZUNA_AI_SONIOX);

    expect(migrated).toBe(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(ProviderConfigFactory.isProviderSupported(migrated)).toBe(true);
  });

  // Redirecting is only for providers this build cannot offer. A registered
  // one is the user's actual choice and must survive untouched.
  it('leaves a registered provider exactly as the user chose it', async () => {
    const { migrateLegacyKizunaProvider } = await migrateWith({
      soniox: true,
      openaiTranslate: true,
      volcengineAst2: true,
    });

    for (const p of MANAGED) {
      expect(migrateLegacyKizunaProvider(p)).toBe(p);
    }
  });

  it('leaves any other persisted provider untouched', async () => {
    const { migrateLegacyKizunaProvider } = await migrateWith({ soniox: true });
    expect(migrateLegacyKizunaProvider(Provider.GEMINI)).toBe(Provider.GEMINI);
    expect(migrateLegacyKizunaProvider(Provider.SONIOX)).toBe(Provider.SONIOX);
  });
});
