import { afterEach, describe, it, expect } from 'vitest';
import { DEFAULT_PAIRING } from '../projection/pair';
import { useSettingsStore } from '../../stores/settingsStore';
import { appProjectionSettings, projectionFrom } from './appViewSettings';

const initial = useSettingsStore.getState();
afterEach(() => useSettingsStore.setState(initial, true));

const stored = { segmentationMode: 'pause' as const, sentenceSegmentationChunkSentences: 3, segmentationSourcePause: 1.5, segmentationTranslationPause: 0.8 };

describe('projectionFrom', () => {
  it('maps the pause mode to both pauses, in milliseconds', () => {
    expect(projectionFrom(stored)).toEqual({ mode: 'pause', sentencesPerRow: 0, sourcePauseMs: 1500, translationPauseMs: 800, pairing: DEFAULT_PAIRING });
  });

  it('maps the sentences mode to its size, Auto (0) keeping each segment whole', () => {
    expect(projectionFrom({ ...stored, segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 2 }))
      .toEqual({ mode: 'sentences', sentencesPerRow: 2, sourcePauseMs: 0, translationPauseMs: 0, pairing: DEFAULT_PAIRING });
    expect(projectionFrom({ ...stored, segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 0 }).sentencesPerRow).toBe(0);
  });

  it('maps off to whole segments', () => {
    expect(projectionFrom({ ...stored, segmentationMode: 'off' })).toEqual({ mode: 'off', sentencesPerRow: 0, sourcePauseMs: 0, translationPauseMs: 0, pairing: DEFAULT_PAIRING });
  });
});

describe('appProjectionSettings', () => {
  it('returns the same object until one of the four stored fields changes', () => {
    const source = appProjectionSettings();
    const first = source.get();
    useSettingsStore.setState({ keepReplayAudio: !initial.keepReplayAudio });
    expect(source.get()).toBe(first);
    useSettingsStore.setState({ segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 1 });
    expect(source.get()).not.toBe(first);
    expect(source.get()).toMatchObject({ mode: 'sentences', sentencesPerRow: 1 });
  });

  it('tells its listener about a store change', () => {
    const source = appProjectionSettings();
    let heard = 0;
    const off = source.subscribe(() => { heard += 1; });
    useSettingsStore.setState({ segmentationMode: 'off' });
    off();
    expect(heard).toBeGreaterThan(0);
  });
});
