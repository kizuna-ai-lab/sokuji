/**
 * SettingsInitializer after the switch (plan 1e-3b-2 ruling 10): its two
 * remaining jobs — LocalInference's first model scan, and an Edge TTS voice
 * that matches each speaking direction's target language, written through the provider store. The
 * old gate and slice it had to stay clear of (ruling 11) went with the old
 * descriptor (Stage 2 deletion, ruling 3).
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

// Japanese and English voices; the filter is the real one.
const edge = vi.hoisted(() => ({
  voices: vi.fn(async () => [
    { ShortName: 'ja-JP-NanamiNeural', Locale: 'ja-JP' },
    { ShortName: 'ja-JP-KeitaNeural', Locale: 'ja-JP' },
    { ShortName: 'en-US-AvaNeural', Locale: 'en-US' },
  ]),
}));
vi.mock('../../lib/edge-tts/voiceList', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/edge-tts/voiceList')>()),
  getEdgeTtsVoices: edge.voices,
}));

import type { DirectionResult } from '../../lib/local-inference/selection/types';
import { fakeProvider } from '../../providers/fake/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import useAudioStore from '../../stores/audioStore';
import { useModelStore } from '../../stores/modelStore';
import { useProviderStore, type ProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';
import { SettingsInitializer } from './SettingsInitializer';

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

/** LocalInference as the store holds it once loaded: `en → ja`, these voices, these legs, Translation I hear on or off. */
function selectLocal(voices: Record<string, unknown> = {}, o: { legs?: Array<'speaker' | 'participant'>; participantSpeech?: boolean; pair?: { source: string; target: string } } = {}): void {
  useProviderStore.setState({
    selected: localInferenceProvider.id,
    entries: { [localInferenceProvider.id]: { settings: { ...LOCAL_INFERENCE_DEFAULTS, voices }, credentials: {}, pair: o.pair ?? { source: 'en', target: 'ja' } } },
    legs: o.legs ?? ['speaker'],
    speech: { textOnly: false, participantSpeech: o.participantSpeech ?? false },
  } as never);
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
  it('scans the downloaded models once while LocalInference is selected and the model store is not initialized', () => {
    const initialize = vi.fn(async () => {});
    useModelStore.setState({ initialized: false, initialize, resolve: () => direction(null) });
    selectLocal();

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

  describe('the Edge TTS voice of each direction that will speak (#619)', () => {
    let updateSettings: Mock<ProviderStore['updateSettings']>;
    beforeEach(() => {
      updateSettings = vi.fn<ProviderStore['updateSettings']>();
      useProviderStore.setState({ updateSettings });
      useModelStore.setState({ initialized: true });
    });

    it("picks my direction's first voice of its target when it has none", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal();
      render(<SettingsInitializer />);
      await settle();
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, { voices: { 'en→ja': { edge: 'ja-JP-NanamiNeural' } } });
    });

    it("writes nothing when my direction's voice already matches its target", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal({ 'en→ja': { edge: 'ja-JP-KeitaNeural' } });
      render(<SettingsInitializer />);
      await settle();
      expect(edge.voices).toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it("leaves the other side's direction alone while Translation I hear is off, even when it resolves to Edge (Review Focus 2)", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal({ 'en→ja': { edge: 'ja-JP-KeitaNeural' } }, { legs: ['speaker', 'participant'], participantSpeech: false });
      render(<SettingsInitializer />);
      await settle();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it('keeps both speaking directions valid, each against its own target, in one write', async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal({}, { legs: ['speaker', 'participant'], participantSpeech: true });
      render(<SettingsInitializer />);
      await settle();
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, {
        voices: { 'en→ja': { edge: 'ja-JP-NanamiNeural' }, 'ja→en': { edge: 'en-US-AvaNeural' } },
      });
    });

    it('a pair swap finds both voices where they were: nothing to write (Review Focus 1)', async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal({ 'en→ja': { edge: 'ja-JP-KeitaNeural' }, 'ja→en': { edge: 'en-US-AvaNeural' } }, { legs: ['speaker', 'participant'], participantSpeech: true, pair: { source: 'ja', target: 'en' } });
      render(<SettingsInitializer />);
      await settle();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it('writes nothing when no speaking direction uses Edge', async () => {
      useModelStore.setState({ resolve: () => direction('piper-ja') });
      selectLocal({}, { legs: ['speaker', 'participant'], participantSpeech: true });
      render(<SettingsInitializer />);
      await settle();
      expect(edge.voices).not.toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
    });
  });
});
