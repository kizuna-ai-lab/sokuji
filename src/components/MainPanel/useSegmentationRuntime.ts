import { useEffect, useRef, useState } from 'react';
import { PunctuationRuntime } from '../../lib/segmentation/PunctuationRuntime';
import type { PunctuationModelId, SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
import { useSentenceSegmentation } from '../../stores/settingsStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { reportWarning } from '../../lib/diagnostics/report';

/**
 * Builds the app's single PunctuationRuntime and attaches the two wires the
 * runtime deliberately does not have: the status store and diagnostics.
 *
 * The runtime is created once per mount, INSIDE the effect, and held in
 * `useState` rather than a ref populated from the render body. React 19's
 * StrictMode simulates a remount in dev (setup -> cleanup -> setup) while
 * preserving the component's fiber and its refs. A runtime built in the
 * render body behind `if (ref.current === null)` and disposed by the first
 * cleanup would never be rebuilt: the guard sees a non-null ref forever (it
 * only ever checks for null, not for "disposed"), so every call after that
 * silently hits `PunctuationRuntime.punctuate()`'s own disposed-check and
 * returns null forever -- indistinguishable from "no model available", with
 * no re-render to surface the problem (StrictMode's second setup doesn't
 * change the ref, so nothing tells React to re-render). Constructing in the
 * effect instead means the second setup builds a fresh instance and the
 * `useState` write it makes republishes it through a real re-render.
 *
 * Returns null for the one render before the first effect has run --
 * genuinely no runtime exists yet at that point -- and for the (React
 * 19-normal) unmounted-then-cleaned-up render StrictMode's simulated
 * remount produces in between. Every consumer already has to treat a null
 * `punctuate()` result as "no model available"; treating a null runtime the
 * same way is the same contract, one level up.
 *
 * It reads the enabled flag through a getter rather than a prop, so flipping
 * the switch -- or the pack's download finishing -- takes effect on the next
 * call without tearing down a loaded model.
 */
export function useSegmentationRuntime(): SegmentationRuntime | null {
  const enabled = useSentenceSegmentation();
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [runtime, setRuntime] = useState<PunctuationRuntime | null>(null);

  useEffect(() => {
    // Ask the disk once per launch. `isEnabled` below is "toggle on AND pack
    // ready", and the pack's phase starts at 'unknown' — so without this, a
    // launch that never opens the Settings panel would seal nothing, with all
    // three models sitting on disk the whole time. Safe unconditionally:
    // refresh() early-returns while a download is in flight.
    void useSegmentationStore.getState().refresh();

    // One line per model for the facts that are otherwise invisible. A live
    // Chinese session sealed nothing at all and none of the four questions
    // that would have explained it — did the model load, on which backend,
    // how slow is it, is its answer usable — could be answered from any
    // surface the app has. `seen` keeps the per-inference line to the first
    // one: punctuate() runs up to ~12x a second.
    const seen = new Set<PunctuationModelId>();
    const instance = new PunctuationRuntime({
      // A1: the toggle alone is not enough. The runtime no longer downloads
      // anything, so it must not be told it is on until all three models are
      // actually on disk.
      isEnabled: () => enabledRef.current && useSegmentationStore.getState().phase === 'ready',
      onLoaded: (model, backend, loadMs) => {
        console.info(`[Segmentation] ${model} loaded on ${backend} in ${Math.round(loadMs)}ms`);
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
    });
    setRuntime(instance);

    return () => {
      instance.dispose();
      setRuntime(null);
    };
  }, []);

  return runtime;
}
