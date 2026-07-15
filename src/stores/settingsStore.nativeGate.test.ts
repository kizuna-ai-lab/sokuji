/**
 * The LOCAL_NATIVE readiness gate (validateApiKey) is a thin wrapper around
 * nativeModelStore's `ensureSelectionReady` facade: it forwards the current
 * localNative selection, applies any corrections the facade returns, and maps
 * the returned reason to a user-facing message via the module-private
 * `msgForNativeReason` helper. All sidecar warmup / lifecycle-gating /
 * auto-select / variant-repo-resolution behavior now lives in and is tested by
 * Task 3's facade tests (nativeModelStore.test.ts) — this file only pins the
 * wrapper contract and the reason→message mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from '../types/Provider';

// ServiceFactory is touched during updateLocalNative/persist — stub it.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn(),
    })),
  },
}));

// Force the Electron branch of the gate.
vi.mock('../utils/environment', async () => {
  const actual = await vi.importActual<typeof import('../utils/environment')>('../utils/environment');
  return { ...actual, isElectron: () => true };
});

// Stub the native store's facade the gate dynamically imports.
const mockEnsureSelectionReady = vi.fn();
vi.mock('./nativeModelStore', () => ({
  useNativeModelStore: {
    getState: () => ({
      ensureSelectionReady: (...a: unknown[]) => mockEnsureSelectionReady(...a),
    }),
  },
}));

const { default: useSettingsStore } = await import('./settingsStore');

// The Task-1 frozen per-scenario messages, now keyed by the facade's reason —
// this table is the wrapper's contract with msgForNativeReason (module-private,
// so it's exercised indirectly through validateApiKey).
const REASON_MESSAGE: Record<string, string> = {
  'ready': '',
  'not-electron': 'Native sidecar unavailable (desktop app + installed sidecar required)',
  'engine-mismatch': 'The inference engine needs an update — open provider settings to update it',
  'engine-absent': 'Download the inference engine in provider settings',
  'unavailable': 'Native engine unavailable — retry in settings',
  'starting': 'Starting the local engine…',
  'asr-incompatible': 'Select a speech-recognition model for the source language',
  'translation-incompatible': 'Select a translation model for this language pair',
  'models-missing': 'Download the native models in settings',
};

describe('LOCAL_NATIVE gate delegates to ensureSelectionReady', () => {
  beforeEach(() => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE } as any);
    mockEnsureSelectionReady.mockReset();
  });

  it('sets valid + empty message + availableModels when ready', async () => {
    mockEnsureSelectionReady.mockResolvedValue({ ready: true, reason: 'ready', corrections: null });
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r).toEqual({ valid: true, message: '', validating: false });
    expect(useSettingsStore.getState().isApiKeyValid).toBe(true);
    expect(useSettingsStore.getState().availableModels).toEqual([{ id: 'native-asr-translate', type: 'realtime', created: 0 }]);
  });

  it('applies corrections to localNative', async () => {
    mockEnsureSelectionReady.mockResolvedValue({ ready: true, reason: 'ready', corrections: { translationModel: 'opus-mt-zh-en' } });
    await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().localNative.translationModel).toBe('opus-mt-zh-en');
  });

  it('does not touch localNative when corrections is null', async () => {
    const before = useSettingsStore.getState().localNative.translationModel;
    mockEnsureSelectionReady.mockResolvedValue({ ready: false, reason: 'models-missing', corrections: null });
    await useSettingsStore.getState().validateApiKey();
    expect(useSettingsStore.getState().localNative.translationModel).toBe(before);
  });

  for (const [reason, expected] of Object.entries(REASON_MESSAGE)) {
    it(`maps reason "${reason}" to its frozen message`, async () => {
      mockEnsureSelectionReady.mockResolvedValue({ ready: reason === 'ready', reason, corrections: null });
      const r = await useSettingsStore.getState().validateApiKey();
      expect(r.message).toBe(expected);
      expect(useSettingsStore.getState().validationMessage).toBe(expected);
      expect(useSettingsStore.getState().isApiKeyValid).toBe(reason === 'ready');
    });
  }
});
