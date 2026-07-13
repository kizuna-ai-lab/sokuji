import { describe, it, expect, vi } from 'vitest';
// Force the remaining provider gates on — Kizuna/Palabra/Local-Native feature
// flags plus Electron/Extension platform detection — so ALL descriptors register
// regardless of build env. (Volcengine ST/AST2 and Zoom AI are now always-on, no flag.)
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));
import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { OpenAITranslateGAClient } from '../clients/OpenAITranslateGAClient';
import { VolcengineAST2Client } from '../clients/VolcengineAST2Client';
import { defaultOpenAISettings } from './OpenAIProviderConfig';
import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
import { defaultGeminiSettings } from './GeminiProviderConfig';
import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
import { defaultVolcengineSTSettings } from './VolcengineSTProviderConfig';
import { defaultZoomAISettings } from './ZoomAIProviderConfig';
import { defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
import { defaultKizunaOpenaiTranslateSettings } from './KizunaAIOpenAITranslateProviderConfig';
import { defaultKizunaVolcengineAst2Settings } from './KizunaAIVolcengineAST2ProviderConfig';
import en from '../../locales/en/translation.json';

// Map each provider's settingsSliceKey to its per-module default settings slice,
// so buildSessionConfig can be exercised for every registered provider.
const DEFAULTS_BY_SLICE: Record<string, unknown> = {
  openai: defaultOpenAISettings,
  openaiCompatible: defaultOpenAICompatibleSettings,
  openaiTranslate: defaultOpenAITranslateSettings,
  gemini: defaultGeminiSettings,
  palabraai: defaultPalabraAISettings,
  volcengineST: defaultVolcengineSTSettings,
  zoomAI: defaultZoomAISettings,
  volcengineAST2: defaultVolcengineAST2Settings,
  localInference: defaultLocalInferenceSettings,
  localNative: defaultLocalNativeSettings,
  kizunaOpenaiTranslate: defaultKizunaOpenaiTranslateSettings,
  kizunaVolcengineAst2: defaultKizunaVolcengineAst2Settings,
};

describe('provider registry descriptors', () => {
  it('returns a descriptor for every available provider', () => {
    const ids = ProviderConfigFactory.getAvailableProviders();
    expect(ids.length).toBe(12);
    for (const id of ids) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(d.getConfig().id).toBe(id);
      expect(typeof d.settingsSliceKey).toBe('string');
    }
  });

  it('slice keys are unique', () => {
    const keys = ProviderConfigFactory.getAvailableProviders()
      .map(id => ProviderConfigFactory.getDescriptor(id).settingsSliceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('descriptor.createClient', () => {
  const creds = { ok: true as const, primary: 'k', secret: 's', endpoint: 'https://e.example' };
  const ws = { transport: 'websocket' as const };

  it('constructs a client for every available provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, ws);
      expect(client.getProvider()).toBe(id === Provider.KIZUNA_AI_OPENAI_TRANSLATE ? Provider.OPENAI_TRANSLATE
        : id === Provider.KIZUNA_AI_VOLCENGINE_AST2 ? Provider.VOLCENGINE_AST2
        : id === Provider.OPENAI_COMPATIBLE ? Provider.OPENAI
        : id);
    }
  });

  it('kizuna translate twin routes to relay OpenAITranslateGAClient', () => {
    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE)
      .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
    expect(c).toBeInstanceOf(OpenAITranslateGAClient);
  });

  it('kizuna doubao twin routes to relay VolcengineAST2Client', () => {
    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_VOLCENGINE_AST2)
      .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
    expect(c).toBeInstanceOf(VolcengineAST2Client);
  });
});

describe('descriptor.validateAndFetchModels', () => {
  it('rejects incomplete credentials with the provider-specific message', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
    const r = await d.validateAndFetchModels({ ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' });
    expect(r.validation.valid).toBe(false);
    expect(r.validation.message).toMatch(/Client ID and Client Secret/);
    expect(r.models).toEqual([]);
  });

  it('kizuna twins validate statically from a non-empty token', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    const ok = await d.validateAndFetchModels({ ok: true, primary: 'sess_TOKEN' });
    expect(ok.validation.valid).toBe(true);
    expect(ok.models[0].id).toBe('gpt-realtime-translate');
    const bad = await d.validateAndFetchModels({ ok: false, missing: 'Sign in is required for Kizuna relay providers' });
    expect(bad.validation.valid).toBe(false);
  });
});

describe('descriptor.latestRealtimeModel', () => {
  it('fixed-model providers return their identifier', () => {
    expect(ProviderConfigFactory.getDescriptor(Provider.ZOOM_AI).latestRealtimeModel([])).toBe('zoom-scribe-translator-v1');
    expect(ProviderConfigFactory.getDescriptor(Provider.VOLCENGINE_AST2).latestRealtimeModel([])).toBe('ast-v2-s2s');
    expect(ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_VOLCENGINE_AST2).latestRealtimeModel([])).toBe('ast-v2-s2s');
  });
});

describe('descriptor.extractCredentials', () => {
  it('normalizes each provider credential shape', async () => {
    const cases: Array<[Provider, object, { primary: string; secret?: string; endpoint?: string }]> = [
      [Provider.OPENAI, { apiKey: 'sk-1' }, { primary: 'sk-1' }],
      [Provider.OPENAI_COMPATIBLE, { apiKey: 'k', customEndpoint: 'https://e' }, { primary: 'k', endpoint: 'https://e' }],
      [Provider.PALABRA_AI, { clientId: 'id', clientSecret: 'sec' }, { primary: 'id', secret: 'sec' }],
      [Provider.VOLCENGINE_ST, { accessKeyId: 'ak', secretAccessKey: 'sk' }, { primary: 'ak', secret: 'sk' }],
      [Provider.VOLCENGINE_AST2, { appId: 123, accessToken: 'tok' }, { primary: '123', secret: 'tok' }],
      [Provider.ZOOM_AI, { apiKey: 'zk', apiSecret: 'zs' }, { primary: 'zk', secret: 'zs' }],
    ];
    for (const [id, slice, want] of cases) {
      const got = await ProviderConfigFactory.getDescriptor(id).extractCredentials(slice, {});
      expect(got).toEqual({ ok: true, ...want });
    }
  });

  it('two-field providers report both-required when either is missing', async () => {
    const r = await ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI)
      .extractCredentials({ clientId: 'id', clientSecret: '' }, {});
    expect(r).toEqual({ ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' });
  });

  it('kizuna twin resolves the auth token from ctx', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(await d.extractCredentials({}, { getAuthToken: async () => 'sess_T' }))
      .toEqual({ ok: true, primary: 'sess_T' });
    expect((await d.extractCredentials({}, {})).ok).toBe(false);
    expect((await d.extractCredentials({}, { getAuthToken: async () => null })).ok).toBe(false);
  });

  it('local inference needs no credentials', async () => {
    expect(await ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).extractCredentials({}, {}))
      .toEqual({ ok: true, primary: '' });
  });
});

describe('descriptor.buildSessionConfig', () => {
  it('builds a config whose provider tag matches, for every provider, from defaults', () => {
    // Expected wire tags (kizuna twins reuse their base tag; compatible uses 'openai').
    const wireTag: Record<string, string> = {
      openai: 'openai', openai_compatible: 'openai', openai_translate: 'openai_translate',
      gemini: 'gemini', palabraai: 'palabraai', volcengine_st: 'volcengine_st',
      volcengine_ast2: 'volcengine_ast2', zoom_ai: 'zoom_ai', local_inference: 'local_inference',
      local_native: 'local_native',
      kizunaai_openai_translate: 'openai_translate', kizunaai_volcengine_ast2: 'volcengine_ast2',
    };
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const cfg = d.buildSessionConfig((DEFAULTS_BY_SLICE as any)[d.settingsSliceKey], 'instr');
      expect(cfg.provider).toBe(wireTag[id]);
    }
  });

  it('zoom session config is text-only with a single target', () => {
    const cfg: any = ProviderConfigFactory.getDescriptor(Provider.ZOOM_AI)
      .buildSessionConfig({ ...defaultZoomAISettings, sourceLanguage: 'ja-JP', targetLanguage: 'en-US' }, 'sys');
    expect(cfg).toMatchObject({ provider: 'zoom_ai', textOnly: true, targetLanguages: ['en-US'] });
  });

  it('gemini config carries VAD tuning through', () => {
    const cfg: any = ProviderConfigFactory.getDescriptor(Provider.GEMINI)
      .buildSessionConfig({ ...defaultGeminiSettings, vadSilenceDurationMs: 900 }, 'sys');
    expect(cfg.vadSilenceDurationMs).toBe(900);
  });
});

describe('descriptor language rules', () => {
  it('zoom: non-English sources can only target English', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.ZOOM_AI);
    expect(d.resolveTargetLanguages('ja-JP').map(l => l.value)).toEqual(['en-US']);
    expect(d.reconcileTarget('ja-JP', 'fr-FR')).toBe('en-US');
    expect(d.reconcileTarget('en-US', 'ja-JP')).toBe('ja-JP');
  });

  it('openai translate restricts targets to the fixed 13', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.OPENAI_TRANSLATE);
    expect(d.resolveTargetLanguages('any').length).toBe(13);
  });

  it('default providers pass their config languages through', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.GEMINI);
    expect(d.resolveSourceLanguages()).toBe(d.getConfig().languages);
  });
});

describe('descriptor i18n keys', () => {
  it('every available provider has name+description in the en catalog', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const key = d.i18nKey ?? id;
      const entry = (en as any).providers?.[key];
      expect(entry?.name, `providers.${key}.name`).toBeTruthy();
      expect(entry?.description, `providers.${key}.description`).toBeTruthy();
    }
  });
});

describe('registry invariants', () => {
  // (descriptor config id === registry key is already asserted by
  // 'returns a descriptor for every available provider' above.)

  // Exact expected settingsSliceKey per provider. A typo'd slice key (e.g. a
  // provider silently falling back to a differently-cased or misspelled key)
  // must fail this table lookup loudly, not just pass a generic typeof check.
  const EXPECTED_SLICE_KEYS: Record<Provider, string> = {
    [Provider.OPENAI]: 'openai',
    [Provider.OPENAI_COMPATIBLE]: 'openaiCompatible',
    [Provider.OPENAI_TRANSLATE]: 'openaiTranslate',
    [Provider.GEMINI]: 'gemini',
    [Provider.PALABRA_AI]: 'palabraai',
    [Provider.VOLCENGINE_ST]: 'volcengineST',
    [Provider.VOLCENGINE_AST2]: 'volcengineAST2',
    [Provider.ZOOM_AI]: 'zoomAI',
    [Provider.LOCAL_INFERENCE]: 'localInference',
    // Registered only under Electron (isElectron() gate), so the availability
    // loops below never see it in jsdom — the row satisfies Record<Provider,…>
    // completeness and documents the expected key.
    [Provider.LOCAL_NATIVE]: 'localNative',
    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: 'kizunaOpenaiTranslate',
    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: 'kizunaVolcengineAst2',
  };

  it('settingsSliceKey matches the exact expected value per provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const key = ProviderConfigFactory.getDescriptor(id).settingsSliceKey;
      expect(key, `settingsSliceKey for ${id}`).toBe(EXPECTED_SLICE_KEYS[id]);
    }
  });

  // Exact expected supportsWebRTC per provider. Relay/twin and non-WebRTC
  // providers must not silently inherit `true` from a base descriptor (e.g.
  // the kizuna OpenAI-translate twin extends OpenAITranslateProviderConfig
  // but always routes through the WebSocket relay, so it must report false —
  // see KizunaAIOpenAITranslateProviderConfig for why).
  const EXPECTED_SUPPORTS_WEBRTC: Record<Provider, boolean> = {
    [Provider.OPENAI]: true,
    [Provider.OPENAI_COMPATIBLE]: true,
    [Provider.OPENAI_TRANSLATE]: true,
    [Provider.GEMINI]: false,
    [Provider.PALABRA_AI]: false,
    [Provider.VOLCENGINE_ST]: false,
    [Provider.VOLCENGINE_AST2]: false,
    [Provider.ZOOM_AI]: false,
    [Provider.LOCAL_INFERENCE]: false,
    [Provider.LOCAL_NATIVE]: false,
    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: false,
    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: false,
  };

  it('supportsWebRTC matches the exact expected value per provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const supportsWebRTC = ProviderConfigFactory.getDescriptor(id).supportsWebRTC;
      expect(supportsWebRTC, `supportsWebRTC for ${id}`).toBe(EXPECTED_SUPPORTS_WEBRTC[id]);
    }
  });

  it('every settingsSliceKey exists in the settings store defaults', async () => {
    const { default: useSettingsStore } = await import('../../stores/settingsStore');
    const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const key = ProviderConfigFactory.getDescriptor(id).settingsSliceKey;
      expect(state[key], `slice '${key}' for ${id}`).toBeTypeOf('object');
    }
  });

  it('extractCredentials on an empty slice never returns ok (except credential-free providers)', async () => {
    const credentialFree = new Set([Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE]);
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      if (credentialFree.has(id) || id.startsWith('kizunaai')) continue;
      const r = await ProviderConfigFactory.getDescriptor(id).extractCredentials({}, {});
      expect(r.ok, id).toBe(false);
    }
  });
});

describe('legacy façade credential guards (deprecated ClientOperations/ClientFactory paths)', () => {
  // The production path runs extractCredentials first, but the @deprecated
  // façades accept raw positional args — they must keep the old contract of
  // rejecting incomplete credentials instead of reaching provider clients
  // with `secret: undefined`.
  it('two-field providers reject a filled primary with a missing secret', async () => {
    const { ClientOperations } = await import('../ClientOperations');
    const cases: Array<[Provider, RegExp]> = [
      [Provider.PALABRA_AI, /Client ID and Client Secret/],
      [Provider.VOLCENGINE_ST, /Access Key ID and Secret Access Key/],
      [Provider.VOLCENGINE_AST2, /APP ID and Access Token/],
      [Provider.ZOOM_AI, /API Key and API Secret/],
    ];
    for (const [id, msg] of cases) {
      const r = await ClientOperations.validateApiKeyAndFetchModels('primary-only', id);
      expect(r.validation.valid, id).toBe(false);
      expect(r.validation.message, id).toMatch(msg);
      expect(r.models, id).toEqual([]);
    }
  });

  it('ClientFactory.createClient rejects an empty apiKey for credentialed providers', async () => {
    const { ClientFactory } = await import('../clients/ClientFactory');
    expect(() => ClientFactory.createClient('m', Provider.OPENAI, ''))
      .toThrow(/API key is required/);
    // LOCAL_INFERENCE never had credentials — must keep working with ''
    expect(ClientFactory.createClient('m', Provider.LOCAL_INFERENCE, '')).toBeTruthy();
  });
});
