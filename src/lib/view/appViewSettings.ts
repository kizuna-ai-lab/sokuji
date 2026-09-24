/**
 * The stored segmentation choice as the projection's cut (spec:
 * "Segmentation is one fact"): cutting by sentences and by pause is L2's for
 * every provider, so the per-provider clamp of today's descriptors has no
 * part here. The only module under `src/lib/view` that reads a store.
 */
import { DEFAULT_PAIRING } from '../projection/pair';
import type { ProjectionSettings } from '../projection/types';
import { segmentPauseMs, type SegmentationMode } from '../segmentation/segmentationMode';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Readable } from './conversationView';

/** The four stored fields the cut follows (`settingsStore`). */
export interface StoredSegmentation {
  segmentationMode: SegmentationMode;
  /** 0 is Auto: each segment whole. */
  sentenceSegmentationChunkSentences: number;
  /** Seconds. */
  segmentationSourcePause: number;
  segmentationTranslationPause: number;
}

export function projectionFrom(s: StoredSegmentation): ProjectionSettings {
  const pauses = s.segmentationMode === 'pause';
  return {
    mode: s.segmentationMode,
    sentencesPerRow: s.segmentationMode === 'sentences' ? s.sentenceSegmentationChunkSentences : 0,
    sourcePauseMs: pauses ? segmentPauseMs(s.segmentationSourcePause) : 0,
    translationPauseMs: pauses ? segmentPauseMs(s.segmentationTranslationPause) : 0,
    pairing: DEFAULT_PAIRING,
  };
}

/** The app's cut, live from the settings store: the same object until one of the four fields changes. */
export function appProjectionSettings(): Readable<ProjectionSettings> {
  let key = '';
  let cached: ProjectionSettings | null = null;
  return {
    get() {
      const s = useSettingsStore.getState();
      const next = `${s.segmentationMode}|${s.sentenceSegmentationChunkSentences}|${s.segmentationSourcePause}|${s.segmentationTranslationPause}`;
      if (next !== key || !cached) {
        key = next;
        cached = projectionFrom(s);
      }
      return cached;
    },
    subscribe: (listener) => useSettingsStore.subscribe(() => listener()),
  };
}
