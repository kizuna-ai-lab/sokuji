import { useEffect, useRef, useState } from 'react';
import { PunctuationRuntime } from '../../lib/segmentation/PunctuationRuntime';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
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
 * the switch takes effect on the next call without tearing down a loaded
 * model.
 */
export function useSegmentationRuntime(): SegmentationRuntime | null {
  const enabled = useSentenceSegmentation();
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [runtime, setRuntime] = useState<PunctuationRuntime | null>(null);

  useEffect(() => {
    const instance = new PunctuationRuntime({
      isEnabled: () => enabledRef.current,
      onStatus: (model, status, detail) => {
        useSegmentationStore.getState().setModelStatus(model, status, detail);
        if (status === 'error') {
          // One line per model per failure class: a settings backend or a
          // network that is down fails for every model at once, and one
          // entry per attempt would bury the session's real events. No
          // transcript text is in scope here — only the model id.
          reportWarning('Segmentation', `${model} is unavailable: ${detail ?? 'unknown error'}`, {
            dedupeKey: `segmentation:${model}`,
          });
        }
      },
      onDownloadProgress: (model, percent) => {
        useSegmentationStore.getState().setModelProgress(model, percent);
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
