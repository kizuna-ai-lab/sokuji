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

// The plan follows the selection today. A test may put another in its place: `plan.found`, answered while it is set.
const plan = vi.hoisted(() => ({ found: null as unknown }));
vi.mock('../../lib/plan/fromStores', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/plan/fromStores')>();
  return { ...actual, usePlan: () => (plan.found ?? actual.usePlan()) as ReturnType<typeof actual.usePlan> };
});

import type { LocalStages } from '../../lib/lineup/localStages';
import type { DirectionResult } from '../../lib/local-inference/selection/types';
import { stubTextUnit, textAndSpeechPlan } from '../../lib/plan/testing';
import type { PlannedUnit } from '../../lib/plan/types';
import { wholePlan } from '../../lib/plan/wholeUnit';
import { localSpeechUnit } from '../../providers/localInference/speechUnit';
import { useLineUpStore } from '../../stores/lineUpStore';
import { fakeProvider } from '../../providers/fake/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import useAudioStore from '../../stores/audioStore';
import { useModelStore } from '../../stores/modelStore';
import { useProviderStore, type ProviderStore } from '../../stores/providerStore';
import { runsOn } from '../../stores/lineUpStore.testing';
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
  runsOn(localInferenceProvider.id);
  useProviderStore.setState({
    entries: { [localInferenceProvider.id]: { settings: { ...LOCAL_INFERENCE_DEFAULTS, voices }, credentials: {}, pair: o.pair ?? { source: 'en', target: 'ja' } } },
    legs: o.legs ?? ['speaker'],
    speech: { textOnly: false, participantSpeech: o.participantSpeech ?? false },
  } as never);
}

const localEntry = (voices: Record<string, unknown> = {}, pair = { source: 'zh', target: 'ko' }) =>
  ({ settings: { ...LOCAL_INFERENCE_DEFAULTS, voices }, credentials: {}, pair });

/**
 * A plan in which another provider (`stub_text`, `en → ja`) transcribes and translates and the local provider's voice
 * reads it, with the line-up's speech given to `speech`. The local provider's own pair is another: it is not the run's.
 */
function localVoiceAlone(speech: 'edge' | 'local_inference', o: { voices?: Record<string, unknown>; legs?: Array<'speaker' | 'participant'>; participantSpeech?: boolean } = {}): void {
  const text = stubTextUnit().planned;
  const voice: PlannedUnit = { provider: localInferenceProvider, unit: localSpeechUnit, stages: ['speech'] };
  const local = localEntry(o.voices);
  const accounts = { stub_text: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } }, [localInferenceProvider.id]: local };
  plan.found = { state: 'ready', plan: textAndSpeechPlan(text, voice), accounts };
  runsOn('stub_text');
  useProviderStore.setState({
    entries: { [localInferenceProvider.id]: local },
    legs: o.legs ?? ['speaker'],
    speech: { textOnly: false, participantSpeech: o.participantSpeech ?? false },
  } as never);
  useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech, summarisation: null }, stored: true });
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
  plan.found = null;
  useLineUpStore.setState({ lineUp: null, stored: false });
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
    runsOn(fakeProvider.id);

    render(<SettingsInitializer />);

    expect(initialize).not.toHaveBeenCalled();
  });

  it('scans the models when the local provider only speaks in the plan, whichever provider is selected', () => {
    const initialize = vi.fn(async () => {});
    useModelStore.setState({ initialized: false, initialize, resolve: () => direction(null) });
    localVoiceAlone('local_inference');

    const { rerender } = render(<SettingsInitializer />);
    rerender(<SettingsInitializer />);

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('does not scan the models while the plan is not known, even with the local entry loaded', () => {
    const initialize = vi.fn(async () => {});
    useModelStore.setState({ initialized: false, initialize });
    runsOn(null);
    useProviderStore.setState({ entries: { [localInferenceProvider.id]: localEntry() } } as never);

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

    describe('while another provider transcribes and the local provider speaks', () => {
      it("picks Edge's first voice of the run's target when the line-up gives speech to Edge, whatever the local selections resolve to", async () => {
        useModelStore.setState({ resolve: () => direction('piper-ja') });
        localVoiceAlone('edge');
        render(<SettingsInitializer />);
        await settle();
        // The run's pair is the transcription provider's (`en → ja`), not the local entry's own.
        expect(updateSettings).toHaveBeenCalledTimes(1);
        expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, { voices: { 'en→ja': { edge: 'ja-JP-NanamiNeural' } } });
      });

      it('keeps both speaking directions valid when the other side speaks too', async () => {
        useModelStore.setState({ resolve: () => direction(null) });
        localVoiceAlone('edge', { voices: { 'en→ja': { edge: 'ja-JP-KeitaNeural' } }, legs: ['speaker', 'participant'], participantSpeech: true });
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, {
          voices: { 'en→ja': { edge: 'ja-JP-KeitaNeural' }, 'ja→en': { edge: 'en-US-AvaNeural' } },
        });
      });

      it('picks nothing when the line-up gives speech to a local voice model, even where the local selections would resolve to Edge', async () => {
        useModelStore.setState({ resolve: () => direction('edge-tts') });
        localVoiceAlone('local_inference');
        render(<SettingsInitializer />);
        await settle();
        expect(edge.voices).not.toHaveBeenCalled();
        expect(updateSettings).not.toHaveBeenCalled();
      });
    });

    describe('with a stored line-up that is all on this device', () => {
      /** The resolver as it reads a stored line-up: Edge wherever the line-up gives speech to it, else what the local selections pick. */
      const byLineUp = (picked: string) => (_src: string, _tgt: string, _selections: unknown, stages?: LocalStages | null) =>
        direction(stages?.speech === 'edge' ? 'edge-tts' : stages?.speech === 'local' ? 'piper-ja' : picked);
      const store = (speech: 'edge' | 'local_inference') =>
        useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech, summarisation: null }, stored: true, unstoredProvider: null });

      it('picks a voice for a direction Edge reads only because the line-up says Edge: the local selections alone pick a speech model', async () => {
        useModelStore.setState({ resolve: byLineUp('piper-ja') });
        selectLocal();
        store('edge');
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledTimes(1);
        expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, { voices: { 'en→ja': { edge: 'ja-JP-NanamiNeural' } } });
      });

      it('picks one for every direction Edge will read, the other side\'s too', async () => {
        useModelStore.setState({ resolve: byLineUp('piper-ja') });
        selectLocal({}, { legs: ['speaker', 'participant'], participantSpeech: true });
        store('edge');
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, {
          voices: { 'en→ja': { edge: 'ja-JP-NanamiNeural' }, 'ja→en': { edge: 'en-US-AvaNeural' } },
        });
      });

      it('picks nothing when the line-up gives speech to a model on this device, though the local selections alone would pick Edge', async () => {
        useModelStore.setState({ resolve: byLineUp('edge-tts') });
        selectLocal();
        store('local_inference');
        render(<SettingsInitializer />);
        await settle();
        expect(edge.voices).not.toHaveBeenCalled();
        expect(updateSettings).not.toHaveBeenCalled();
      });

      it('with no line-up stored the local selections decide, as before', async () => {
        useModelStore.setState({ resolve: byLineUp('edge-tts') });
        selectLocal();
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledWith(localInferenceProvider, { voices: { 'en→ja': { edge: 'ja-JP-NanamiNeural' } } });
      });
    });

    it('picks nothing while the local provider is in the plan but another provider speaks', async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal();
      const [whole] = wholePlan(localInferenceProvider).units;
      const text: PlannedUnit = { ...whole, stages: ['transcription', 'translation'] };
      const voice = stubTextUnit().planned;
      const entries = useProviderStore.getState().entries;
      plan.found = {
        state: 'ready',
        plan: { units: [text, voice], byStage: { transcription: text, translation: text, speech: voice } },
        accounts: { [localInferenceProvider.id]: entries[localInferenceProvider.id], stub_text: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      };
      render(<SettingsInitializer />);
      await settle();
      expect(edge.voices).not.toHaveBeenCalled();
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
