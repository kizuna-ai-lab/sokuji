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
  ['updateLocalInference', 'localInference', { asrModel: 'm1' }],
  ['updateLocalNative', 'localNative', { sourceLanguage: 'ja' }],
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

  it('kizuna twins: credentials update in-memory state but are never persisted', async () => {
    await useSettingsStore.getState().updateKizunaOpenaiTranslate({ apiKey: 'secret', sourceLanguage: 'ja' } as any);
    expect((useSettingsStore.getState() as any).kizunaOpenaiTranslate.apiKey).toBe('secret');
    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaOpenaiTranslate.apiKey', expect.anything());
    expect(setSetting).toHaveBeenCalledWith('settings.kizunaOpenaiTranslate.sourceLanguage', 'ja');

    setSetting.mockClear();
    await useSettingsStore.getState().updateKizunaVolcengineAst2({ appId: 'a', accessToken: 't', sourceLanguage: 'zh' } as any);
    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaVolcengineAst2.appId', expect.anything());
    expect(setSetting).not.toHaveBeenCalledWith('settings.kizunaVolcengineAst2.accessToken', expect.anything());
    expect(setSetting).toHaveBeenCalledWith('settings.kizunaVolcengineAst2.sourceLanguage', 'zh');
  });

  it('persistence-error policy: zoomAI swallows, gemini propagates (legacy 6/6 split)', async () => {
    setSetting.mockRejectedValue(new Error('disk full'));
    // swallow family: resolves, state still applied
    await expect(useSettingsStore.getState().updateZoomAI({ apiKey: 'zz' } as any)).resolves.toBeUndefined();
    expect((useSettingsStore.getState() as any).zoomAI.apiKey).toBe('zz');
    // throw family: rejects
    await expect(useSettingsStore.getState().updateGemini({ apiKey: 'gg' } as any)).rejects.toThrow('disk full');
  });
});
