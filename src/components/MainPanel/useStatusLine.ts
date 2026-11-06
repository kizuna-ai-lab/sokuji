import { useEffect, useMemo, useState } from 'react';
import type { EchoNoticeState } from '../../lib/modern-audio/EchoMonitor';
import type { RunEnd, RunState } from '../../lib/session/types';
import type { SubtitleIdleModel } from '../../lib/subtitle/session';
import { statusLine, type StatusEntry } from '../../lib/view/statusLine';
import { useSelectedInputDevice } from '../../stores/audioStore';
import { useSubtitleEntryHint } from '../../stores/subtitleStore';

export interface UseStatusLineArgs {
  run: RunState;
  idle: SubtitleIdleModel;
  canStart: boolean;
  dismissedEnd: RunEnd | null;
  /** `useEchoNotice`'s visible notice; null where no echo is watched (the takeover window). */
  echo: EchoNoticeState | null;
}

/**
 * The status line's inputs from the stores (spec 2026-10-05 §3): the
 * selected input for the microphone wait, the subtitle store for the entry
 * hint; the run, the gate and the echo come from the caller. Shared by
 * MainPanel and the Electron takeover, so both draw the same line.
 */
export function useStatusLine({ run, idle, canStart, dismissedEnd, echo }: UseStatusLineArgs): StatusEntry | null {
  const selectedInput = useSelectedInputDevice();
  const entryHint = useSubtitleEntryHint();
  // No usable input is selected: `audioStore` clears the selection when none is left (#596).
  const waitingForMicrophone = run.phase === 'running' && run.legs.speaker !== undefined && selectedInput === null;
  // The reconnect line counts seconds, so it re-renders once a second while a leg reconnects (the `useSessionClock` pattern);
  // only its visible words tick, its live region's stay as they are (`StatusEntry.announce`).
  const reconnecting = run.phase === 'running' && Object.values(run.legs).includes('reconnecting');
  const [, retick] = useState(0);
  useEffect(() => {
    if (!reconnecting) return;
    const interval = setInterval(() => retick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [reconnecting]);
  const now = Date.now();
  return useMemo(
    () => statusLine({ run, idle, canStart, dismissedEnd, waitingForMicrophone, subtitleEntryHint: entryHint === 'refresh', echo, now }),
    // `now` only matters while reconnecting; elsewhere a fresh value must not rebuild the entry every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, idle, canStart, dismissedEnd, waitingForMicrophone, entryHint, echo, reconnecting ? now : 0],
  );
}
