import { afterEach, describe, it, expect } from 'vitest';
import { fakeProvider } from '../../providers/fake/provider';
import { DEFAULT_PAIRING } from '../projection/pair';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { appProjectionSettings, offerFor, projectionFrom } from './appViewSettings';

const initial = useSettingsStore.getState();
const initialProvider = useProviderStore.getState();
afterEach(() => {
  useSettingsStore.setState(initial, true);
  useProviderStore.setState(initialProvider, true);
});

const stored = { segmentationMode: 'pause' as const, sentenceSegmentationChunkSentences: 3, segmentationSourcePause: 1.5, segmentationTranslationPause: 0.8 };

describe('offerFor', () => {
  it("offers pause and not Auto for a silence-boundaried provider (pause is ours to time)", () => {
    expect(offerFor('silence')).toEqual({ pause: true, auto: false, sizes: true });
  });

  it("offers Auto and not pause for a provider-boundaried provider (pause is not ours to time)", () => {
    expect(offerFor('provider')).toEqual({ pause: false, auto: true, sizes: true });
  });
});

describe('projectionFrom', () => {
  it('cuts by pause for a silence-boundaried provider: the stored pause, in milliseconds', () => {
    expect(projectionFrom(stored, 'silence')).toEqual({ mode: 'pause', sentencesPerRow: 0, sourcePauseMs: 1500, translationPauseMs: 800, pairing: DEFAULT_PAIRING });
  });

  it('cuts whole segments under the stored pause for a provider-boundaried provider (pause is not its to time)', () => {
    expect(projectionFrom(stored, 'provider')).toEqual({ mode: 'off', sentencesPerRow: 0, sourcePauseMs: 0, translationPauseMs: 0, pairing: DEFAULT_PAIRING });
  });

  it('maps Auto (0) to 3 sentences for a silence provider, and to whole segments for a provider one', () => {
    const auto = { ...stored, segmentationMode: 'sentences' as const, sentenceSegmentationChunkSentences: 0 };
    expect(projectionFrom(auto, 'silence').sentencesPerRow).toBe(3);
    expect(projectionFrom(auto, 'provider').sentencesPerRow).toBe(0);
  });

  it('keeps a chosen sentence count under either boundary', () => {
    const n = { ...stored, segmentationMode: 'sentences' as const, sentenceSegmentationChunkSentences: 2 };
    expect(projectionFrom(n, 'silence').sentencesPerRow).toBe(2);
    expect(projectionFrom(n, 'provider').sentencesPerRow).toBe(2);
  });

  it('maps off to whole segments under either boundary', () => {
    const off = { ...stored, segmentationMode: 'off' as const };
    expect(projectionFrom(off, 'silence')).toEqual({ mode: 'off', sentencesPerRow: 0, sourcePauseMs: 0, translationPauseMs: 0, pairing: DEFAULT_PAIRING });
    expect(projectionFrom(off, 'provider')).toEqual({ mode: 'off', sentencesPerRow: 0, sourcePauseMs: 0, translationPauseMs: 0, pairing: DEFAULT_PAIRING });
  });
});

describe('appProjectionSettings', () => {
  it('returns the same object until one of the stored fields changes', () => {
    const source = appProjectionSettings();
    const first = source.get();
    useSettingsStore.setState({ keepReplayAudio: !initial.keepReplayAudio });
    expect(source.get()).toBe(first);
    useSettingsStore.setState({ segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 1 });
    expect(source.get()).not.toBe(first);
    expect(source.get()).toMatchObject({ mode: 'sentences', sentencesPerRow: 1 });
  });

  it('tells its listener about a settings-store change', () => {
    const source = appProjectionSettings();
    let heard = 0;
    const off = source.subscribe(() => { heard += 1; });
    useSettingsStore.setState({ segmentationMode: 'off' });
    off();
    expect(heard).toBeGreaterThan(0);
  });

  it("defaults to a provider-boundaried cut when no provider is selected or loaded: the stored pause is whole segments", () => {
    useSettingsStore.setState({ segmentationMode: 'pause', segmentationSourcePause: 1.5, segmentationTranslationPause: 0.8 });
    useProviderStore.setState({ selected: null, entries: {} });
    expect(appProjectionSettings().get().mode).toBe('off');
  });

  it("follows the selected fake provider's boundaries ('provider'): Auto keeps segments whole, not the silence-provider default of 3", () => {
    useSettingsStore.setState({ segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 0 });
    useProviderStore.setState({
      selected: 'fake',
      entries: { fake: { settings: fakeProvider.settings.defaults, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    expect(appProjectionSettings().get()).toMatchObject({ mode: 'sentences', sentencesPerRow: 0 });
  });

  it('tells its listener when the selected provider changes', () => {
    const source = appProjectionSettings();
    let heard = 0;
    const off = source.subscribe(() => { heard += 1; });
    useProviderStore.setState({
      selected: 'fake',
      entries: { fake: { settings: fakeProvider.settings.defaults, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    off();
    expect(heard).toBeGreaterThan(0);
  });
});
