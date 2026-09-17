import { useEffect, useRef } from 'react';
import { PunctuationRuntime } from '../../lib/segmentation/PunctuationRuntime';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
import { useSentenceSegmentation } from '../../stores/settingsStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { reportWarning } from '../../lib/diagnostics/report';

/**
 * Builds the app's single PunctuationRuntime and attaches the two wires the
 * runtime deliberately does not have: the status store and diagnostics.
 *
 * The runtime is created once for the app's lifetime. It reads the enabled
 * flag through a getter rather than a prop, so flipping the switch takes
 * effect on the next call without tearing down a loaded model.
 */
export function useSegmentationRuntime(): SegmentationRuntime {
  const enabled = useSentenceSegmentation();
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const runtimeRef = useRef<PunctuationRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = new PunctuationRuntime({
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
  }

  useEffect(() => () => { runtimeRef.current?.dispose(); }, []);

  return runtimeRef.current;
}
