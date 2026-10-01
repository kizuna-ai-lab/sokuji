import { useEffect, useState } from 'react';
import type { RunState } from '../../../lib/session/types';

/** Today's session-duration formatter (`MainPanel.tsx:1428-1436`): `mm:ss`, or `hh:mm:ss` past an hour. */
export function formatDuration(ms: number): string {
  const elapsed = Math.floor(ms / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** The status footer's elapsed-time readout: ticks once a second while the run is live, else null. */
export function useSessionClock(run: RunState, now: () => number = Date.now): string | null {
  const [, retick] = useState(0);
  useEffect(() => {
    if (run.phase !== 'running') return;
    const interval = setInterval(() => retick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [run.phase]);
  return run.phase === 'running' ? formatDuration(now() - run.since) : null;
}
