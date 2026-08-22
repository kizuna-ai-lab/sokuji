/**
 * The LOCAL_NATIVE readiness gate (validateApiKey) is a thin wrapper around
 * nativeModelStore's `ensureSelectionReady` facade: it hands the facade a thunk
 * reading the live localNative selection and maps the returned reason to a
 * user-facing message via the module-private `msgForNativeReason` helper. All
 * sidecar warmup / lifecycle-gating / auto-select / variant-repo-resolution
 * behavior now lives in and is tested by Task 3's facade tests
 * (nativeModelStore.test.ts) — this file only pins the wrapper contract and
 * the reason→message mapping.
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
const { default: useAudioStore } = await import('./audioStore');

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
  'asr-incompatible': 'Select a speech-recognition model for My language',
  'translation-incompatible': 'Select a translation model for this language pair',
  'models-missing': 'Download the native models in settings',
};

describe('LOCAL_NATIVE gate delegates to ensureSelectionReady', () => {
  beforeEach(() => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE } as any);
    // The gate resolves the text-only toggle against the channel matrix, so the
    // mode has to be pinned or a mode-specific case would leak into its
    // neighbours. 'speaker' is audioStore's own default.
    useAudioStore.setState({ mode: 'speaker' } as any);
    mockEnsureSelectionReady.mockReset();
  });

  it('sets valid + empty message + availableModels when ready', async () => {
    mockEnsureSelectionReady.mockResolvedValue({ ready: true, reason: 'ready', notes: [] });
    const r = await useSettingsStore.getState().validateApiKey();
    expect(r).toEqual({ valid: true, message: '', validating: false });
    expect(useSettingsStore.getState().isApiKeyValid).toBe(true);
    expect(useSettingsStore.getState().availableModels).toEqual([{ id: 'native-asr-translate', type: 'realtime', created: 0 }]);
  });

  it('hands the facade a live reader, not a pre-warmup snapshot', async () => {
    // The wrapper's half of the stale-snapshot fix: it passes a thunk, so what
    // the facade reads reflects the settings at READ time (after it has warmed
    // the sidecar), not at call time. Simulates a pair/text-only change landing
    // during a slow cold start.
    useSettingsStore.setState({
      localNative: { ...useSettingsStore.getState().localNative, sourceLanguage: 'zh' },
      textOnly: false,
    } as any);
    let seen: any;
    mockEnsureSelectionReady.mockImplementation(async (read: any) => {
      useSettingsStore.setState({
        localNative: { ...useSettingsStore.getState().localNative, sourceLanguage: 'ja' },
        textOnly: true,
      } as any);
      seen = read();
      return { ready: true, reason: 'ready', notes: [] };
    });
    await useSettingsStore.getState().validateApiKey();
    expect(seen.selection.sourceLanguage).toBe('ja');
    expect(seen.textOnly).toBe(true);
  });

  // The participant (reverse-direction) leg never speaks — every descriptor's
  // buildParticipantSessionConfig forces textOnly, pinned registry-wide by
  // descriptorRegistry.test.ts. So in a participant-only mode the TTS model is
  // dead weight: requiring it made the gate report "download the native models"
  // for a voice the session would never load.
  describe('resolves the toggle against the channel matrix', () => {
    const readTextOnly = async () => {
      let seen: any;
      mockEnsureSelectionReady.mockImplementation(async (read: any) => {
        seen = read();
        return { ready: true, reason: 'ready', notes: [] };
      });
      await useSettingsStore.getState().validateApiKey();
      return seen.textOnly;
    };

    // Both values of the stored toggle, or an implementation that hard-coded
    // `false` for an in-scope mode would pass the off-case alone.
    for (const mode of ['speaker', 'both'] as const) {
      for (const stored of [false, true]) {
        it(`passes the stored toggle (${stored}) straight through in ${mode} mode`, async () => {
          useAudioStore.setState({ mode } as any);
          useSettingsStore.setState({ textOnly: stored } as any);
          expect(await readTextOnly()).toBe(stored);
        });
      }
    }

    for (const stored of [false, true]) {
      it(`forces text-only in participant mode (stored toggle ${stored})`, async () => {
        useAudioStore.setState({ mode: 'participant' } as any);
        useSettingsStore.setState({ textOnly: stored } as any);
        expect(await readTextOnly()).toBe(true);
      });
    }
  });

  for (const [reason, expected] of Object.entries(REASON_MESSAGE)) {
    it(`maps reason "${reason}" to its frozen message`, async () => {
      mockEnsureSelectionReady.mockResolvedValue({ ready: reason === 'ready', reason, notes: [] });
      const r = await useSettingsStore.getState().validateApiKey();
      expect(r.message).toBe(expected);
      expect(useSettingsStore.getState().validationMessage).toBe(expected);
      expect(useSettingsStore.getState().isApiKeyValid).toBe(reason === 'ready');
    });
  }
});
