/**
 * SettingsInitializer after the switch (plan 1e-3b-2 ruling 10): its two
 * remaining jobs — LocalInference's first model scan, and an Edge TTS voice
 * that matches the target language, written through the provider store —
 * and the single-writer cut (ruling 11): nothing the page wires at startup,
 * nor a change of the audio mode, reaches the old path's gate or the old
 * slice's writer.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { act, render } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

// Two Japanese voices; the filter is the real one.
const edge = vi.hoisted(() => ({
  voices: vi.fn(async () => [
    { ShortName: 'ja-JP-NanamiNeural', Locale: 'ja-JP' },
    { ShortName: 'ja-JP-KeitaNeural', Locale: 'ja-JP' },
  ]),
}));
vi.mock('../../lib/edge-tts/voiceList', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/edge-tts/voiceList')>()),
  getEdgeTtsVoices: edge.voices,
}));

// Ruling 11's case 1 mounts the real <AppSessionRoot /> beside
// SettingsInitializer, so `attach()` genuinely runs (watchLegsFromStores,
// driveLocalReadiness) — the same mocks AppSessionRoot.test.tsx uses for the
// pieces only a running session would touch (audio/capture/punctuation),
// none of which this case reaches: it never starts a run.
vi.mock('../../lib/audio/appAudio', () => ({
  getAppAudio: vi.fn(async () => {
    const queue = { position: () => null, pending: 0, subscribe: () => () => {} };
    return {
      playback: {
        queues: { speaker: queue, participant: queue, replay: queue },
        audio: vi.fn(), held: vi.fn(), clear: vi.fn(), live: vi.fn(), passthrough: vi.fn(),
        ttsTap: { read: () => new Float32Array(0) },
        meter: vi.fn(() => null),
      },
      testTone: async () => {},
    };
  }),
}));
vi.mock('../../lib/audio/appCapture', () => ({
  createAppCapture: () => ({
    openSource: async () => { throw new Error('no capture in tests'); },
    echo: { attach: () => () => {}, onNotice: () => {}, setDiagnostics: () => {} },
    levels: {
      speaker: { push() {}, read: () => new Float32Array(32), reset() {} },
      participant: { push() {}, read: () => new Float32Array(32), reset() {} },
    },
  }),
}));
vi.mock('../../lib/segmentation/PunctuationRuntime', () => {
  class FakePunctuationRuntime {
    dispose = vi.fn();
    punctuate = vi.fn(async () => null);
    constructor(public opts: { isEnabled(): boolean }) {}
    get enabled(): boolean {
      return this.opts.isEnabled();
    }
  }
  const PunctuationRuntime = vi.fn(function (opts: { isEnabled(): boolean }) {
    return new FakePunctuationRuntime(opts);
  });
  const MODEL_IDS = {
    'fireredpunc': 'punct-zh-fireredpunc',
    'edge-punct-en': 'punct-en-edge',
    'sat-3l-sm': 'punct-multi-sat',
  };
  return { PunctuationRuntime, MODEL_IDS };
});
vi.mock('../../lib/export/appAutoSave', () => ({
  autoSaveConversation: vi.fn(async () => 'saved'),
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));
vi.mock('../../lib/auth/hooks', () => ({ useAuth: () => ({ isSignedIn: false, getToken: async () => null }) }));
vi.mock('../../contexts/UserProfileContext', () => ({ useUserProfile: () => ({ refetchAll: vi.fn(async () => {}) }) }));

import type { DirectionResult } from '../../lib/local-inference/selection/types';
import { fakeProvider } from '../../providers/fake/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import { AppSessionRoot } from '../../app/AppSessionRoot';
import { READINESS_DELAY_MS } from '../../app/readiness';
import { configureAppSession } from '../../app/session';
import { createVirtualClock } from '../../lib/contract/clock';
import useAudioStore from '../../stores/audioStore';
import { useModelStore } from '../../stores/modelStore';
import { useProviderStore, type ProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';
import { ToastProvider } from '../Toast';
import { SettingsInitializer } from './SettingsInitializer';

// The virtual clock attach()'s driveLocalReadiness reads, so its 150ms
// debounce advances deterministically instead of racing real timers.
const clock = createVirtualClock(0);
configureAppSession({ clock, newSessionId: () => 'r1', ipc: null });

const initial = {
  settings: useSettingsStore.getState(),
  model: useModelStore.getState(),
  provider: useProviderStore.getState(),
  audio: useAudioStore.getState(),
};

/** What `resolve` answers for a direction: only its TTS matters here. */
const direction = (tts: string | null): DirectionResult => ({
  asr: null, translation: null, tts: tts ? { modelId: tts, source: 'auto' } : null, notes: [], prunes: [],
});

/** LocalInference as the store holds it once loaded: `en → ja`, with this voice. */
function selectLocal(edgeTtsVoice: string): void {
  useProviderStore.setState({
    selected: localInferenceProvider.id,
    entries: { [localInferenceProvider.id]: { settings: { ...LOCAL_INFERENCE_DEFAULTS, edgeTtsVoice }, credentials: {}, pair: { source: 'en', target: 'ja' } } },
  });
}

/** Lets the voice list's promise and whatever follows it settle. */
async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
  useSettingsStore.setState(initial.settings, true);
  useModelStore.setState(initial.model, true);
  useProviderStore.setState(initial.provider, true);
  useAudioStore.setState(initial.audio, true);
  edge.voices.mockClear();
});

describe('SettingsInitializer', () => {
  // Ruling 11. Before the switch, the settings store's mode subscription
  // re-ran `validateApiKey`, whose LocalInference arm calls
  // `ensureSelectionReady` (and its prune wrote the old slice). This mounts
  // the real <AppSessionRoot /> too, so attach()'s own wiring
  // (watchLegsFromStores -> setLegs -> driveLocalReadiness's re-check) is
  // the path a mode change actually takes now — not just SettingsInitializer
  // in isolation.
  it('never reaches the old gate or the old slice, at startup or on a mode change', async () => {
    const writeSpy = vi.fn();
    const readySpy = vi.fn(async () => ({ ready: true, notes: [] }));
    // Through setState: a spy on one state object is lost at the next `set`.
    useSettingsStore.setState({ provider: 'local_inference', settingsLoaded: true, updateLocalInference: writeSpy } as never);
    useModelStore.setState({ ensureSelectionReady: readySpy, initialize: vi.fn(async () => {}) });
    await useProviderStore.getState().load(localInferenceProvider);
    useProviderStore.getState().select(localInferenceProvider.id);

    render(<ToastProvider><SettingsInitializer /><AppSessionRoot /></ToastProvider>);
    act(() => { useAudioStore.getState().setMode('both'); });
    // Lets attach()'s debounced local-readiness check actually run, through
    // the provider's own `check` (check.ts) — not the old gate.
    act(() => { clock.advance(READINESS_DELAY_MS); });
    await settle();

    expect(readySpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('scans the downloaded models once while LocalInference is selected and the model store is not initialized', () => {
    const initialize = vi.fn(async () => {});
    useModelStore.setState({ initialized: false, initialize, resolve: () => direction(null) });
    selectLocal('');

    const { rerender } = render(<SettingsInitializer />);
    rerender(<SettingsInitializer />);

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('does not scan the models for a provider other than LocalInference', () => {
    const initialize = vi.fn(async () => {});
    useModelStore.setState({ initialized: false, initialize });
    useProviderStore.setState({ selected: fakeProvider.id });

    render(<SettingsInitializer />);

    expect(initialize).not.toHaveBeenCalled();
  });

  describe('the Edge TTS voice', () => {
    let updateSettings: Mock<ProviderStore['updateSettings']>;
    beforeEach(() => {
      updateSettings = vi.fn<ProviderStore['updateSettings']>();
      useProviderStore.setState({ updateSettings });
      useModelStore.setState({ initialized: true });
    });

    it("picks the target language's first voice when the stored one does not match it", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal('');

      render(<SettingsInitializer />);
      await settle();

      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, { edgeTtsVoice: 'ja-JP-NanamiNeural' });
    });

    it('writes nothing when the stored voice already matches the target language', async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal('ja-JP-KeitaNeural');

      render(<SettingsInitializer />);
      await settle();

      expect(edge.voices).toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it('writes nothing when the TTS is not Edge', async () => {
      useModelStore.setState({ resolve: () => direction('piper-ja') });
      selectLocal('');

      render(<SettingsInitializer />);
      await settle();

      expect(edge.voices).not.toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
    });
  });
});
