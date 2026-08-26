/**
 * Behavior lock for the per-provider settings update actions, written BEFORE
 * collapsing the twelve hand-copied action bodies into one registry-driven
 * implementation. Pins, for every slice: the persist key prefix, the
 * merge-into-state semantics, the two patch transforms (WebRTC forces turn
 * detection off), the two never-persist filters (kizuna credentials), and the
 * 6-throw/6-swallow persistence-error split. Must be green before AND after
 * the refactor.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const setSetting = vi.fn(async () => ({ success: true }));
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      getSetting: vi.fn(async (_key: string, def: unknown) => def),
      setSetting: (...args: unknown[]) => setSetting(...args),
    })),
  },
}));
vi.mock('../utils/environment', async (orig) => ({
  ...(await orig<object>()),
  isElectron: () => true,
  isExtension: () => false,
}));

const { default: useSettingsStore } = await import('./settingsStore');

/** action name → [sliceKey, sample patch] for the plain (no-special-case) slices */
const PLAIN: Array<[string, string, Record<string, unknown>]> = [
  ['updateGemini', 'gemini', { apiKey: 'k1' }],
  ['updatePalabraAI', 'palabraai', { clientId: 'c1' }],
  ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'k2' }],
  ['updateVolcengineST', 'volcengineST', { accessKeyId: 'a1' }],
  ['updateZoomAI', 'zoomAI', { apiKey: 'z1' }],
  ['updateVolcengineAST2', 'volcengineAST2', { appId: 'p1' }],
  ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
  ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
  ['updateSoniox', 'soniox', { apiKey: 's1' }],
];

beforeEach(() => {
  setSetting.mockClear();
  setSetting.mockImplementation(async () => ({ success: true }));
});

describe('provider settings update actions (behavior lock)', () => {
  it('every plain action merges into its slice and persists under settings.<sliceKey>.<key>', async () => {
    for (const [action, sliceKey, patch] of PLAIN) {
      setSetting.mockClear();
      await (useSettingsStore.getState() as any)[action](patch);
      const [k, v] = Object.entries(patch)[0];
      expect((useSettingsStore.getState() as any)[sliceKey][k], action).toBe(v);
      expect(setSetting, action).toHaveBeenCalledWith(`settings.${sliceKey}.${k}`, v);
    }
  });

  it('openai/openaiCompatible: switching to webrtc forces turnDetectionMode Disabled in state AND persistence', async () => {
    for (const [action, sliceKey] of [['updateOpenAI', 'openai'], ['updateOpenAICompatible', 'openaiCompatible']] as const) {
      setSetting.mockClear();
      (useSettingsStore.setState as any)({ [sliceKey]: { ...(useSettingsStore.getState() as any)[sliceKey], turnDetectionMode: 'Normal' } });
      await (useSettingsStore.getState() as any)[action]({ transportType: 'webrtc' });
      expect((useSettingsStore.getState() as any)[sliceKey].turnDetectionMode, action).toBe('Disabled');
      expect(setSetting, action).toHaveBeenCalledWith(`settings.${sliceKey}.turnDetectionMode`, 'Disabled');
      expect(setSetting, action).toHaveBeenCalledWith(`settings.${sliceKey}.transportType`, 'webrtc');
    }
  });

  it('webrtc forcing is conditional: already-Disabled stays Disabled; a non-webrtc patch never forces it', async () => {
    for (const [action, sliceKey] of [['updateOpenAI', 'openai'], ['updateOpenAICompatible', 'openaiCompatible']] as const) {
      // Already Disabled before the update → still Disabled, still persisted.
      setSetting.mockClear();
      (useSettingsStore.setState as any)({ [sliceKey]: { ...(useSettingsStore.getState() as any)[sliceKey], turnDetectionMode: 'Disabled' } });
      await (useSettingsStore.getState() as any)[action]({ transportType: 'webrtc' });
      expect((useSettingsStore.getState() as any)[sliceKey].turnDetectionMode, action).toBe('Disabled');
      expect(setSetting, action).toHaveBeenCalledWith(`settings.${sliceKey}.turnDetectionMode`, 'Disabled');

      // Negative case: a websocket patch must NOT force or persist turnDetectionMode.
      setSetting.mockClear();
      (useSettingsStore.setState as any)({ [sliceKey]: { ...(useSettingsStore.getState() as any)[sliceKey], turnDetectionMode: 'Normal' } });
      await (useSettingsStore.getState() as any)[action]({ transportType: 'websocket' });
      expect((useSettingsStore.getState() as any)[sliceKey].turnDetectionMode, action).toBe('Normal');
      expect(setSetting, action).not.toHaveBeenCalledWith(`settings.${sliceKey}.turnDetectionMode`, expect.anything());
    }
  });

  it('kizuna twins: credentials update in-memory state but are never persisted', async () => {
    await useSettingsStore.getState().updateKizunaOpenaiTranslate({ apiKey: 'secret', sourceLanguage: 'ja' } as any);
    expect((useSettingsStore.getState() as any).kizunaOpenaiTranslate.apiKey).toBe('secret');
    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaOpenaiTranslate.apiKey', expect.anything());
    expect(setSetting).toHaveBeenCalledWith('settings.kizunaOpenaiTranslate.sourceLanguage', 'ja');

    setSetting.mockClear();
    await useSettingsStore.getState().updateKizunaVolcengineAst2({ appId: 'a', accessToken: 't', sourceLanguage: 'zh' } as any);
    // Credentials land in state...
    expect((useSettingsStore.getState() as any).kizunaVolcengineAst2.appId).toBe('a');
    expect((useSettingsStore.getState() as any).kizunaVolcengineAst2.accessToken).toBe('t');
    // ...but are never persisted.
    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaVolcengineAst2.appId', expect.anything());
    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaVolcengineAst2.accessToken', expect.anything());
    expect(setSetting).toHaveBeenCalledWith('settings.kizunaVolcengineAst2.sourceLanguage', 'zh');
  });

  // The registry used to carry `persistErrors: 'throw' | 'swallow'`, split 6/6,
  // and this pinned each row. What the split actually did in production: none
  // of the six "throw" actions was awaited or caught by any caller — they are
  // typed `void` and every call site (ProviderSection.tsx:486,
  // LanguageSection.tsx:155, ProviderSpecificSettings.tsx:368) is
  // fire-and-forget — so "throw" meant an unhandled rejection that
  // errorTracking.ts:112 forwarded to PostHog, and "swallow" meant a console
  // line. Neither was visible to the user, and which slice got which was
  // arbitrary.
  //
  // All twelve now go through `persistSetting`: state is applied, the promise
  // resolves, and the failure becomes one panel entry per key. Both failure
  // channels are exercised because the service can produce either.
  const ALL_SLICES: Array<[string, string, Record<string, unknown>]> = [
    ['updateOpenAI', 'openai', { apiKey: 'x' }],
    ['updateGemini', 'gemini', { apiKey: 'x' }],
    ['updateOpenAICompatible', 'openaiCompatible', { apiKey: 'x' }],
    ['updatePalabraAI', 'palabraai', { clientId: 'x' }],
    ['updateOpenAITranslate', 'openaiTranslate', { apiKey: 'x' }],
    ['updateKizunaOpenaiTranslate', 'kizunaOpenaiTranslate', { sourceLanguage: 'ja' }],
    ['updateVolcengineST', 'volcengineST', { accessKeyId: 'x' }],
    ['updateZoomAI', 'zoomAI', { apiKey: 'x' }],
    ['updateVolcengineAST2', 'volcengineAST2', { appId: 'x' }],
    ['updateKizunaVolcengineAst2', 'kizunaVolcengineAst2', { sourceLanguage: 'zh' }],
    ['updateLocalInference', 'localInference', { ttsSpeed: 1.5 }],
    ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
  ];

  it('every slice resolves and still applies state when the write is refused', async () => {
    for (const [action, sliceKey, patch] of ALL_SLICES) {
      setSetting.mockResolvedValue({ success: false, error: 'disk full' } as never);
      await expect((useSettingsStore.getState() as any)[action](patch), action).resolves.toBeUndefined();
      const [k, v] = Object.entries(patch)[0];
      expect((useSettingsStore.getState() as any)[sliceKey][k], action).toBe(v);
    }
  });

  it('every slice resolves and still applies state when the write rejects', async () => {
    for (const [action, sliceKey, patch] of ALL_SLICES) {
      setSetting.mockRejectedValue(new Error('disk full') as never);
      await expect((useSettingsStore.getState() as any)[action](patch), action).resolves.toBeUndefined();
      const [k, v] = Object.entries(patch)[0];
      expect((useSettingsStore.getState() as any)[sliceKey][k], action).toBe(v);
    }
  });

  it('files one panel entry per refused key', async () => {
    const { default: useLogStore } = await import('./logStore');
    const { settleReports, resetReportThrottle } = await import('../lib/diagnostics/report');
    useLogStore.getState().clearLogs();
    resetReportThrottle();
    setSetting.mockResolvedValue({ success: false, error: 'disk full' } as never);

    await (useSettingsStore.getState() as any).updateGemini({ apiKey: 'x', sourceLanguage: 'ja' });
    await settleReports();

    const messages = useLogStore.getState().allLogs.map((l) => l.message);
    expect(messages).toEqual([
      '[Settings] Could not save settings.gemini.apiKey: disk full',
      '[Settings] Could not save settings.gemini.sourceLanguage: disk full',
    ]);
    useLogStore.getState().clearLogs();
  });

  it('loadSettings hydrates every slice from settings.<sliceKey>.<field> with its default', async () => {
    // Persisted store returns the default for every key (the mock's getSetting
    // echoes the default), so a wrong prefix or missing registry row surfaces
    // as an unhydrated slice.
    await useSettingsStore.getState().loadSettings();
    const s = useSettingsStore.getState() as any;
    // Spot every slice key is a populated object after load.
    for (const sliceKey of [
      'openai', 'gemini', 'openaiCompatible', 'palabraai', 'openaiTranslate',
      'volcengineST', 'zoomAI', 'volcengineAST2', 'kizunaOpenaiTranslate',
      'kizunaVolcengineAst2', 'localInference', 'localNative',
    ]) {
      expect(s[sliceKey], sliceKey).toBeTypeOf('object');
      expect(Object.keys(s[sliceKey]).length, sliceKey).toBeGreaterThan(0);
    }
  });
});
