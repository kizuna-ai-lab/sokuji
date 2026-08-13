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
import { defaultKizunaSonioxSettings } from './KizunaAISonioxProviderConfig';
import { defaultSonioxSettings } from './SonioxProviderConfig';
import { ManagedSonioxSession } from '../clients/ManagedSonioxSession';
import type { ClientOptions } from './ProviderDescriptor';
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
  kizunaSoniox: defaultKizunaSonioxSettings,
  soniox: defaultSonioxSettings,
};

describe('provider registry descriptors', () => {
  it('returns a descriptor for every available provider', () => {
    const ids = ProviderConfigFactory.getAvailableProviders();
    expect(ids.length).toBe(14);
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
  // The managed Soniox twin is the one descriptor whose client cannot be built
  // from credentials alone: its keys come from a ManagedSonioxSession acquired
  // before any client exists. Supplied unacquired here — createClient only
  // stores it.
  // `role` is required, and required for a reason: it is how the leg names
  // itself when it reports that Soniox accepted its stream, and a leg with no
  // role sets no started bit at all. Typed as ClientOptions['sonioxManaged'] so
  // the fixture cannot quietly drop a field the option gains later — this
  // fixture had already lost `role`, and only tsc noticed.
  const sonioxManaged: ClientOptions['sonioxManaged'] = {
    credentials: { stt: 'stt-k', tts: 'tts-k', clientReferenceId: 'sokuji1:acct:lease:mix_stt' },
    session: new ManagedSonioxSession({ sessionToken: 'sess_TOKEN' }),
    // Matches the four-segment reference above: shared Both's single mixed stream.
    role: 'mix_stt',
  };
  const optionsFor = (id: unknown) => (id === Provider.KIZUNA_AI_SONIOX ? { ...ws, sonioxManaged } : ws);

  it('constructs a client for every available provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, optionsFor(id));
      expect(client.getProvider()).toBe(id === Provider.KIZUNA_AI_OPENAI_TRANSLATE ? Provider.OPENAI_TRANSLATE
        : id === Provider.KIZUNA_AI_VOLCENGINE_AST2 ? Provider.VOLCENGINE_AST2
        : id === Provider.KIZUNA_AI_SONIOX ? Provider.SONIOX
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

  it('kizuna soniox twin routes to a managed-mode SonioxClient built from the session', async () => {
    const { SonioxClient } = await import('../clients/SonioxClient');
    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX)
      .createClient({ ok: true, primary: 'sess_TOKEN' }, { ...ws, sonioxManaged });
    expect(c).toBeInstanceOf(SonioxClient);
    expect(c.getProvider()).toBe(Provider.SONIOX);
  });

  it('refuses to build the managed twin without a session rather than minting a second lease', () => {
    expect(() =>
      ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX)
        .createClient({ ok: true, primary: 'sess_TOKEN' }, ws),
    ).toThrow(/ManagedSonioxSession/);
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

  it('kizuna soniox twin validates statically from a non-empty token', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);
    const ok = await d.validateAndFetchModels({ ok: true, primary: 'sess_TOKEN' });
    expect(ok.validation.valid).toBe(true);
    expect(ok.models[0].id).toBe('stt-rt-v5');
    const bad = await d.validateAndFetchModels({ ok: false, missing: 'Sign in is required for Kizuna providers' });
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

  it('kizuna soniox twin resolves the auth token from ctx', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX);
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
      soniox: 'soniox', kizunaai_soniox: 'soniox',
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
    [Provider.KIZUNA_AI_SONIOX]: 'kizunaSoniox',
    [Provider.SONIOX]: 'soniox',
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
    [Provider.KIZUNA_AI_SONIOX]: false,
    [Provider.SONIOX]: false,
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

describe('S1 capability flags', () => {
  const PUSH_GATED: Record<Provider, string[] | undefined> = {
    [Provider.OPENAI]: ['Disabled', 'Push-to-Translate'],
    [Provider.OPENAI_COMPATIBLE]: ['Disabled', 'Push-to-Translate'], // inherited from OpenAI via ...base
    [Provider.GEMINI]: ['Push-to-Talk', 'Push-to-Translate'],
    [Provider.LOCAL_INFERENCE]: ['Push-to-Talk', 'Push-to-Translate'],
    [Provider.LOCAL_NATIVE]: ['Push-to-Talk', 'Push-to-Translate'],
    [Provider.VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'],
    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'], // twin spread
    [Provider.OPENAI_TRANSLATE]: undefined,
    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
    [Provider.SONIOX]: undefined,
    [Provider.KIZUNA_AI_SONIOX]: undefined,
    [Provider.PALABRA_AI]: undefined,
    [Provider.VOLCENGINE_ST]: undefined,
    [Provider.ZOOM_AI]: undefined,
  };

  const TEXT_INPUT: Record<Provider, boolean | undefined> = {
    [Provider.OPENAI]: true,
    [Provider.OPENAI_COMPATIBLE]: true, // inherited
    [Provider.GEMINI]: true,
    [Provider.LOCAL_INFERENCE]: true,
    [Provider.LOCAL_NATIVE]: true,
    [Provider.OPENAI_TRANSLATE]: undefined,
    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
    [Provider.SONIOX]: undefined,
    [Provider.KIZUNA_AI_SONIOX]: undefined,
    [Provider.VOLCENGINE_AST2]: undefined,
    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: undefined,
    [Provider.PALABRA_AI]: undefined,
    [Provider.VOLCENGINE_ST]: undefined,
    [Provider.ZOOM_AI]: undefined,
  };

  const QUEUES_TEXT: Provider[] = [Provider.OPENAI, Provider.OPENAI_COMPATIBLE];
  const LOCAL_PROMPT: Provider[] = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];

  const PTT_FINALIZATION: Record<Provider, { silenceTailFrames?: number; response: string } | undefined> = {
    [Provider.LOCAL_INFERENCE]: { silenceTailFrames: 7, response: 'always' },
    [Provider.LOCAL_NATIVE]: { silenceTailFrames: 7, response: 'always' },
    [Provider.VOLCENGINE_AST2]: { silenceTailFrames: 5, response: 'server-decides' },
    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: { silenceTailFrames: 5, response: 'server-decides' }, // twin spread
    [Provider.GEMINI]: { response: 'voice-gated-cancel' },
    [Provider.OPENAI]: undefined,
    [Provider.OPENAI_COMPATIBLE]: undefined,
    [Provider.OPENAI_TRANSLATE]: undefined,
    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
    [Provider.SONIOX]: undefined,
    [Provider.KIZUNA_AI_SONIOX]: undefined,
    [Provider.PALABRA_AI]: undefined,
    [Provider.VOLCENGINE_ST]: undefined,
    [Provider.ZOOM_AI]: undefined,
  };

  it('declares pushGatedModes exactly where the settings vocabulary has push-gated modes', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.pushGatedModes, `pushGatedModes for ${id}`).toEqual(PUSH_GATED[id]);
    }
  });

  it('pushGatedModes entries are unique non-empty strings', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const modes = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities.pushGatedModes;
      if (!modes) continue;
      expect(modes.length, `non-empty list for ${id}`).toBeGreaterThan(0);
      expect(new Set(modes).size, `no duplicates for ${id}`).toBe(modes.length);
      for (const m of modes) expect(m, `non-empty mode string for ${id}`).toBeTruthy();
    }
  });

  it('declares supportsTextInput on exactly the five whitelisted providers', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.supportsTextInput, `supportsTextInput for ${id}`).toBe(TEXT_INPUT[id]);
    }
  });

  it('queuesTextWhileResponding only on providers that also support text input', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(!!caps.queuesTextWhileResponding, `queuesTextWhileResponding for ${id}`).toBe(QUEUES_TEXT.includes(id));
      if (caps.queuesTextWhileResponding) {
        expect(caps.supportsTextInput, `queueing implies text input for ${id}`).toBe(true);
      }
    }
  });

  it('usesLocalPromptTemplate only on the local providers', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(!!caps.usesLocalPromptTemplate, `usesLocalPromptTemplate for ${id}`).toBe(LOCAL_PROMPT.includes(id));
    }
  });

  it('pttFinalization matches the behavior table, with valid frame counts', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.pttFinalization, `pttFinalization for ${id}`).toEqual(PTT_FINALIZATION[id]);
      const frames = caps.pttFinalization?.silenceTailFrames;
      if (frames !== undefined) {
        expect(Number.isInteger(frames) && frames > 0, `positive integer frames for ${id}`).toBe(true);
      }
    }
  });

  it('forcedTransport only on PalabraAI, and it names a real transport', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      if (id === Provider.PALABRA_AI) {
        expect(caps.forcedTransport, `forcedTransport for ${id}`).toBe('webrtc');
      } else {
        expect(caps.forcedTransport, `no forcedTransport for ${id}`).toBeUndefined();
      }
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

  // PalabraAI is no longer a synchronous two-field guard: a missing `secret` is
  // the documented signal for platform-mode (API key) credentials (see
  // PalabraAIProviderConfig.toPalabraCredentials), so a legacy caller passing
  // only a primary now reaches the real validateApiKey network call instead of
  // being rejected up front. Mock fetch so that call still fails deterministically.
  it('PalabraAI treats a missing secret as a platform API key, not a guard failure', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Unauthorized' } }),
    } as unknown as Response);
    try {
      const { ClientOperations } = await import('../ClientOperations');
      const r = await ClientOperations.validateApiKeyAndFetchModels('primary-only', Provider.PALABRA_AI);
      expect(fetchSpy).toHaveBeenCalled();
      expect(r.validation.valid).toBe(false);
      // Unlike the guard-rejection cases above, credential *shape* was accepted
      // (creds.ok === true), so validateAndFetchModels still returns the static
      // model list — only `validation` reflects the failed network check.
      expect(r.models).toHaveLength(1);
    } finally {
      // Without the finally, a failing expect leaks the global fetch mock into
      // every later test in this file.
      fetchSpy.mockRestore();
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
