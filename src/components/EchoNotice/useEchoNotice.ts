import { useEffect, useRef, useState } from 'react';
import type { IAudioService } from '../../services/interfaces/IAudioService';
import type { EchoCause, EchoNoticeState } from '../../lib/modern-audio/EchoMonitor';

/** localStorage flag: set to 'true' to stream detector stats to the console. */
const DIAGNOSTICS_KEY = 'sokuji.echoDiagnostics';

/**
 * Subscribes to the audio service's echo verdicts and applies the notice's
 * dismissal semantics:
 *
 * - dismissing hides the current cause only — a *different* cause is a
 *   different problem and shows immediately;
 * - when the monitor reports all-clear, the dismissal resets, so the same
 *   cause CAN notify again if the user re-creates the loop later. This is the
 *   opposite of the deleted device-name warning, whose dismissal was permanent
 *   because its guess could never change.
 */
export function useEchoNotice(
  service: IAudioService | null,
  onDetected?: (state: EchoNoticeState) => void
): { notice: EchoNoticeState | null; dismiss: () => void } {
  const [state, setState] = useState<EchoNoticeState | null>(null);
  const [dismissedCause, setDismissedCause] = useState<EchoCause | null>(null);
  const onDetectedRef = useRef(onDetected);
  // Synchronized in an effect rather than during render: a render-time write
  // could publish a callback from a discarded concurrent render.
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!service) return;

    service.onEchoNotice((next) => {
      setState(next);
      if (next === null) {
        setDismissedCause(null);
      } else {
        onDetectedRef.current?.(next);
      }
    });

    try {
      if (localStorage.getItem(DIAGNOSTICS_KEY) === 'true') {
        service.setEchoDiagnostics(true);
      }
    } catch {
      // Storage unavailable (extension worker contexts) — diagnostics stay off.
    }

    return () => service.onEchoNotice(null);
  }, [service]);

  const visible = state !== null && state.cause !== dismissedCause ? state : null;

  return {
    notice: visible,
    dismiss: () => setDismissedCause(state?.cause ?? null),
  };
}
