/**
 * The stored segmentation choice as the projection's cut (spec:
 * "Segmentation is one fact"): the cut resolves through the running
 * provider's `boundaries(s)`, via the same per-provider clamp the Settings
 * section will use (`resolveSegmentationMode` / `resolveSegmentationSize`):
 * pause is the user's choice where the provider's boundaries come from our
 * silence timers (`boundaries(s) === 'silence'`), Auto is kept where the
 * provider decides (`'provider'`), and sentences survive everywhere. The
 * only module under `src/lib/view` that reads a store.
 */
import { getProvider } from '../../providers/registry';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_PAIRING } from '../projection/pair';
import type { ProjectionSettings } from '../projection/types';
import {
  resolveSegmentationMode,
  resolveSegmentationSize,
  segmentPauseMs,
  type SegmentationMode,
  type SegmentationOffer,
} from '../segmentation/segmentationMode';
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

/**
 * The cut for a provider whose boundaries are `boundaries`: pause is only
 * offered where the boundaries are ours to time (`'silence'`), Auto is only
 * offered where they are not (`'provider'`); sentences and off are
 * unaffected either way.
 */
export function projectionFrom(s: StoredSegmentation, boundaries: 'provider' | 'silence'): ProjectionSettings {
  const offer: SegmentationOffer = { pause: boundaries === 'silence', auto: boundaries === 'provider', sizes: true };
  const mode = resolveSegmentationMode(s.segmentationMode, offer);
  const pause = mode === 'pause';
  return {
    mode,
    sentencesPerRow: mode === 'sentences' ? resolveSegmentationSize(s.sentenceSegmentationChunkSentences, offer) : 0,
    sourcePauseMs: pause ? segmentPauseMs(s.segmentationSourcePause) : 0,
    translationPauseMs: pause ? segmentPauseMs(s.segmentationTranslationPause) : 0,
    pairing: DEFAULT_PAIRING,
  };
}

/** The selected provider's `boundaries(s)`; `'provider'` when none is selected or it has not loaded — nothing here for the cut to time itself against. */
function selectedBoundaries(): 'provider' | 'silence' {
  const { selected, entries } = useProviderStore.getState();
  const provider = selected ? getProvider(selected) : undefined;
  const entry = selected ? entries[selected] : undefined;
  return provider && entry ? provider.boundaries(entry.settings) : 'provider';
}

/** The app's cut, live from the settings store and the selected provider: the same object until one of the inputs changes. */
export function appProjectionSettings(): Readable<ProjectionSettings> {
  let key = '';
  let cached: ProjectionSettings | null = null;
  return {
    get() {
      const s = useSettingsStore.getState();
      const boundaries = selectedBoundaries();
      const next = `${s.segmentationMode}|${s.sentenceSegmentationChunkSentences}|${s.segmentationSourcePause}|${s.segmentationTranslationPause}|${boundaries}`;
      if (next !== key || !cached) {
        key = next;
        cached = projectionFrom(s, boundaries);
      }
      return cached;
    },
    subscribe(listener) {
      const offSettings = useSettingsStore.subscribe(() => listener());
      const offProvider = useProviderStore.subscribe(() => listener());
      return () => {
        offSettings();
        offProvider();
      };
    },
  };
}
