/**
 * The app's one punctuation runtime (plan 1e-3a): today's
 * `useSegmentationRuntime` — its enabled rule and its diagnostics, word for
 * word — outside React, handed to the runner as `punctuate` /
 * `punctuationReady`. The memo answers one question once: L1's display
 * fill-in and LocalInference's job fill-in ask the same one per utterance.
 */
import type { AnalyticsEvents } from '../lib/analytics';
import type { Punctuator } from '../lib/contract/adapter';
import { reportWarning } from '../lib/diagnostics/report';
import { PunctuationRuntime, type PunctuationRuntimeOptions } from '../lib/segmentation/PunctuationRuntime';
import type { PunctuationModelId } from '../lib/segmentation/SegmentationRuntime';
import { baseLang } from '../lib/segmentation/sentenceEnd';
import useLogStore from '../stores/logStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSettingsStore } from '../stores/settingsStore';

export type TrackModelLoad = (event: 'segmentation_model_load', properties: AnalyticsEvents['segmentation_model_load']) => void;

export const PUNCTUATION_MEMO_SIZE = 32;

/** The runtime's three callbacks as `useSegmentationRuntime` wires them today. */
export function punctuationDiagnostics(
  track: () => TrackModelLoad | undefined,
): Required<Pick<PunctuationRuntimeOptions, 'onLoaded' | 'onInference' | 'onStatus'>> {
  // `seen` keeps the per-inference console line to the first one: punctuate()
  // runs up to ~12x a second.
  const seen = new Set<PunctuationModelId>();
  return {
    onLoaded: (model, backend, loadMs) => {
      // The console line stays, and stays unconditional: it is the one window
      // onto which backend a model actually loaded on.
      console.info(`[Segmentation] ${model} loaded on ${backend} in ${Math.round(loadMs)}ms`);
      // And the same fact on the exportable panel, which is where the spec
      // asks for load durations. `addRealtimeEvent`, not a plain entry: a
      // load is not a failure, and only report.ts writes plain entries
      // (diagnostics design §4). It self-gates on the diagnostic-logs switch,
      // so nothing is recorded in the default configuration.
      useLogStore.getState().addRealtimeEvent(
        { type: 'segmentation.model.loaded', data: { model, backend, load_ms: Math.round(loadMs) } },
        'client',
        'segmentation.model.loaded',
      );
      track()?.('segmentation_model_load', {
        model,
        backend,
        load_ms: Math.round(loadMs),
        result: 'ok',
      });
    },
    onInference: (model, info) => {
      if (!seen.has(model)) {
        seen.add(model);
        console.info(
          `[Segmentation] ${model} first inference: ${info.ms}ms, `
          + `${info.ends} sentence ends, ${info.breaks} breakpoints, skeletonOk=${info.skeletonOk}`,
        );
      }
      if (!info.skeletonOk) {
        // The answer cannot be used at all: SentenceStream discards any
        // result whose letters and digits differ from what it sent, because
        // the cut it would map back onto the raw text no longer means
        // anything. Silent until now, and it seals nothing for as long as
        // it lasts.
        reportWarning('Segmentation', `${model} returned text that does not match its input`, {
          dedupeKey: `segmentation:skeleton:${model}`,
        });
      }
    },
    // Diagnostics only. Nothing here reaches segmentationStore: the pack's
    // phase describes the disk, and a model that goes rule-only mid-session
    // must not make the Settings panel claim the download is gone.
    onStatus: (model, status, detail) => {
      if (status === 'disabled') {
        // Session-scoped and unrecoverable — nothing brings the model back
        // before the next launch — so the stage silently stops sealing for
        // the rest of the session. The reason carries the median that
        // tripped it.
        reportWarning('Segmentation', `${model} disabled: ${detail ?? 'unknown reason'}`, {
          dedupeKey: `segmentation:disabled:${model}`,
        });
      }
      if (status === 'error') {
        // One line per model per failure class: storage cleared out from
        // under the session takes every model at once, and one entry per
        // attempt would bury the session's real events. No transcript text
        // is in scope here — only the model id.
        reportWarning('Segmentation', `${model} is unavailable: ${detail ?? 'unknown error'}`, {
          dedupeKey: `segmentation:${model}`,
        });
      }
    },
  };
}

/**
 * One model call per `(base language, text)` among the last `size` asked. An
 * answer in flight or with text is kept; null (no model yet) or a failure is
 * not, so a later ask tries again. `onMiss` counts the model calls.
 */
export function memoizePunctuator(ask: Punctuator, onMiss: () => void = () => {}, size = PUNCTUATION_MEMO_SIZE): Punctuator {
  const kept = new Map<string, Promise<string | null>>();
  return (lang, text) => {
    const key = `${baseLang(lang)}\u0000${text}`;
    const hit = kept.get(key);
    if (hit) return hit;
    onMiss();
    const forget = () => { if (kept.get(key) === answer) kept.delete(key); };
    const answer: Promise<string | null> = ask(lang, text).then(
      (out) => { if (out === null) forget(); return out; },
      () => { forget(); return null; },
    );
    kept.set(key, answer);
    if (kept.size > size) kept.delete(kept.keys().next().value as string);
    return answer;
  };
}

export interface AppPunctuation {
  readonly runtime: PunctuationRuntime;
  /** The runner's `punctuate`. */
  punctuate: Punctuator;
  /** The runner's `punctuationReady`: the display is by sentences and the pack is on disk (and the device can hold it). */
  ready(): boolean;
  /** What `ready()` last answered — the runner reads it once per run, when the run opens, so this is the run's (`sentence_segmentation_active`). */
  readonly lastReady: boolean;
}

export function createAppPunctuation(deps: { track: () => TrackModelLoad | undefined; onModelCall?(): void }): AppPunctuation {
  const runtime = new PunctuationRuntime({
    // Today's rule: the stored display mode is by sentences AND the pack is
    // on disk. Sentences survive every provider's offer
    // (`resolveSegmentationMode`), so no provider is consulted.
    isEnabled: () => useSettingsStore.getState().segmentationMode === 'sentences' && useSegmentationStore.getState().phase === 'ready',
    ...punctuationDiagnostics(deps.track),
  });
  let lastReady = false;
  return {
    runtime,
    punctuate: memoizePunctuator((lang, text) => runtime.punctuate(lang, text).then((r) => r?.text ?? null), deps.onModelCall),
    ready: () => (lastReady = runtime.enabled),
    get lastReady() { return lastReady; },
  };
}
