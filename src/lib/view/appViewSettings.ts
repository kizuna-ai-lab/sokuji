/**
 * The stored segmentation choice as the projection's cut (spec:
 * "Segmentation is one fact"): the cut resolves through the `boundaries` of
 * the plan's transcription unit, via the same per-provider clamp the Settings
 * section will use (`resolveSegmentationMode` / `resolveSegmentationSize`):
 * pause is the user's choice where the provider's boundaries come from our
 * silence timers (`boundaries(s) === 'silence'`), Auto is kept where the
 * provider decides (`'provider'`), and sentences survive everywhere. The
 * only module under `src/lib/view` that reads a store.
 */
import { planFromStores, subscribePlan } from '../plan/fromStores';
import { capabilitiesOf } from '../plan/read';
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

/** What a provider whose boundaries are `boundaries` offers the stored cut:
 *  pause only where the boundaries are ours to time, Auto only where they
 *  are not. */
export function offerFor(boundaries: 'provider' | 'silence'): SegmentationOffer {
  return { pause: boundaries === 'silence', auto: boundaries === 'provider', sizes: true };
}

/**
 * The cut for a provider whose boundaries are `boundaries`: pause is only
 * offered where the boundaries are ours to time (`'silence'`), Auto is only
 * offered where they are not (`'provider'`); sentences and off are
 * unaffected either way.
 */
export function projectionFrom(s: StoredSegmentation, boundaries: 'provider' | 'silence'): ProjectionSettings {
  const offer: SegmentationOffer = offerFor(boundaries);
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

/** The `boundaries` of the plan's transcription unit; `'provider'` until the plan is ready — nothing here for the cut to time itself against. */
export function selectedBoundaries(): 'provider' | 'silence' {
  const found = planFromStores();
  return found.state === 'ready' ? capabilitiesOf(found, 'transcription').boundaries : 'provider';
}

/** The app's cut, live from the settings store and the plan's transcription unit: the same object until one of the inputs changes. */
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
      const offProvider = subscribePlan(listener);
      return () => {
        offSettings();
        offProvider();
      };
    },
  };
}
