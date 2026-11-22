/**
 * SettingsInitializer after the switch (plan 1e-3b-2 ruling 10): its two
 * remaining jobs — LocalInference's first model scan, and, while Edge speaks,
 * an Edge voice that matches each speaking direction's target language,
 * written to Edge's own settings through the provider store. The old gate and
 * slice it had to stay clear of (ruling 11) went with the old descriptor
 * (Stage 2 deletion, ruling 3).
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

import type { DirectionResult } from '../../lib/local-inference/selection/types';
import { stubTextUnit, textAndSpeechPlan } from '../../lib/plan/testing';
import type { PlannedUnit } from '../../lib/plan/types';
import { wholePlan } from '../../lib/plan/wholeUnit';
import { localSpeechUnit } from '../../providers/localInference/speechUnit';
import { edgeProvider } from '../../providers/edge/provider';
import { EDGE_DEFAULTS } from '../../providers/edge/settings';
import { edgeSpeechUnit } from '../../providers/edge/unit';
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
 * reads it, as the line-up gives it speech. The local provider's own pair is another: it is not the run's.
 */
function localVoiceAlone(o: { voices?: Record<string, unknown>; legs?: Array<'speaker' | 'participant'>; participantSpeech?: boolean } = {}): void {
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
  useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'local_inference', summarisation: null }, stored: true });
}

/**
 * A plan in which another provider (`stub_text`, `pair`, by default `en → ja`) transcribes and translates and Edge's
 * unit speaks, with Edge's entry holding `voices`. Edge's own stored pair is another (`edgePair`): it is not the run's.
 */
function edgeSpeaks(o: { voices?: Record<string, string>; legs?: Array<'speaker' | 'participant'>; participantSpeech?: boolean; pair?: { source: string; target: string }; edgePair?: { source: string; target: string } } = {}): void {
  const text = stubTextUnit().planned;
  const voice: PlannedUnit = { provider: edgeProvider, unit: edgeSpeechUnit, stages: ['speech'] };
  const edgeEntry = { settings: { ...EDGE_DEFAULTS, voices: o.voices ?? {} }, credentials: {}, pair: o.edgePair ?? { source: 'de', target: 'fr' } };
  const accounts = { stub_text: { settings: {}, credentials: {}, pair: o.pair ?? { source: 'en', target: 'ja' } }, [edgeProvider.id]: edgeEntry };
  plan.found = { state: 'ready', plan: textAndSpeechPlan(text, voice), accounts };
  runsOn('stub_text');
  useProviderStore.setState({
    entries: { [edgeProvider.id]: edgeEntry },
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
    localVoiceAlone();

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

  describe('the Edge voice of each direction that will speak (#619)', () => {
    let updateSettings: Mock<ProviderStore['updateSettings']>;
    beforeEach(() => {
      updateSettings = vi.fn<ProviderStore['updateSettings']>();
      useProviderStore.setState({ updateSettings });
      useModelStore.setState({ initialized: true });
    });

    describe("while the plan's speech unit is Edge's", () => {
      it('stores the first voice of the target under Edge when my direction has none', async () => {
        edgeSpeaks();
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledTimes(1);
        expect(updateSettings).toHaveBeenCalledWith(edgeProvider, { voices: { 'en→ja': 'ja-JP-NanamiNeural' } });
      });

      it('takes the pair of the provider that transcribes, not the one stored with Edge', async () => {
        edgeSpeaks({ edgePair: { source: 'zh', target: 'ko' } });
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledWith(edgeProvider, { voices: { 'en→ja': 'ja-JP-NanamiNeural' } });
      });

      it("writes nothing when my direction's voice already speaks its target", async () => {
        edgeSpeaks({ voices: { 'en→ja': 'ja-JP-KeitaNeural' } });
        render(<SettingsInitializer />);
        await settle();
        expect(edge.voices).toHaveBeenCalled();
        expect(updateSettings).not.toHaveBeenCalled();
      });

      it("replaces a voice that does not speak the direction's target, the other directions' kept", async () => {
        edgeSpeaks({ voices: { 'en→ja': 'en-US-AvaNeural', 'de→fr': 'fr-FR-DeniseNeural' } });
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledWith(edgeProvider, { voices: { 'en→ja': 'ja-JP-NanamiNeural', 'de→fr': 'fr-FR-DeniseNeural' } });
      });

      it("leaves the other side's direction alone while Translation I hear is off (Review Focus 2)", async () => {
        edgeSpeaks({ voices: { 'en→ja': 'ja-JP-KeitaNeural' }, legs: ['speaker', 'participant'], participantSpeech: false });
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).not.toHaveBeenCalled();
      });

      it("picks one for every direction Edge will read, the other side's too, each against its own target, in one write", async () => {
        edgeSpeaks({ legs: ['speaker', 'participant'], participantSpeech: true });
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledTimes(1);
        expect(updateSettings).toHaveBeenCalledWith(edgeProvider, { voices: { 'en→ja': 'ja-JP-NanamiNeural', 'ja→en': 'en-US-AvaNeural' } });
      });

      it('a pair swap finds both voices where they were: nothing to write (Review Focus 1)', async () => {
        edgeSpeaks({ voices: { 'en→ja': 'ja-JP-KeitaNeural', 'ja→en': 'en-US-AvaNeural' }, legs: ['speaker', 'participant'], participantSpeech: true, pair: { source: 'ja', target: 'en' } });
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).not.toHaveBeenCalled();
      });

      it("writes Edge's settings only, never the local provider's", async () => {
        edgeSpeaks({ legs: ['speaker', 'participant'], participantSpeech: true });
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings.mock.calls.map(([p]) => p.id)).toEqual(['edge']);
      });
    });

    describe('with a line-up of this device, Bing and Edge, as the stores compose it', () => {
      const pair = { source: 'en', target: 'ja' };
      /** Every provider the line-up names, loaded: the plan is the composer's, with Edge's speech unit. */
      const loaded = (voices: Record<string, string> = {}) => useProviderStore.setState({
        entries: {
          [localInferenceProvider.id]: { settings: LOCAL_INFERENCE_DEFAULTS, credentials: {}, pair },
          bing: { settings: {}, credentials: {}, pair },
          edge: { settings: { ...EDGE_DEFAULTS, voices }, credentials: {}, pair },
        },
        legs: ['speaker'],
        speech: { textOnly: false, participantSpeech: false },
      } as never);
      const onThisDevice = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null } as const;

      it('stored: picks a voice for the direction Edge reads, under Edge', async () => {
        loaded();
        useLineUpStore.setState({ lineUp: onThisDevice, stored: true, unstoredProvider: null });
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledTimes(1);
        expect(updateSettings).toHaveBeenCalledWith(edgeProvider, { voices: { 'en→ja': 'ja-JP-NanamiNeural' } });
      });

      it('not stored yet, this device running meanwhile: the line-up shown runs, so its Edge voice is picked too', async () => {
        loaded();
        useLineUpStore.setState({ lineUp: onThisDevice, stored: false, unstoredProvider: localInferenceProvider.id });
        render(<SettingsInitializer />);
        await settle();
        expect(updateSettings).toHaveBeenCalledWith(edgeProvider, { voices: { 'en→ja': 'ja-JP-NanamiNeural' } });
      });

      it('picks nothing when the line-up gives speech to a model on this device', async () => {
        loaded();
        useLineUpStore.setState({ lineUp: { ...onThisDevice, speech: 'local_inference' }, stored: true, unstoredProvider: null });
        render(<SettingsInitializer />);
        await settle();
        expect(edge.voices).not.toHaveBeenCalled();
        expect(updateSettings).not.toHaveBeenCalled();
      });
    });

    it("picks nothing while this device speaks, even where its own selections would resolve to Edge's model", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      selectLocal({}, { legs: ['speaker', 'participant'], participantSpeech: true });
      render(<SettingsInitializer />);
      await settle();
      expect(edge.voices).not.toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
    });

    it("picks nothing while a local voice model reads another provider's text", async () => {
      useModelStore.setState({ resolve: () => direction('edge-tts') });
      localVoiceAlone();
      render(<SettingsInitializer />);
      await settle();
      expect(edge.voices).not.toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();
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
  });
});
