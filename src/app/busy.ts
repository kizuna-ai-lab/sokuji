/**
 * Electron's busy flag (plan 1e-3a ruling 13): busy when a start leaves idle,
 * not busy once the runner is idle again and `settled()` — after the save,
 * after an ending that outlived its bound, and after a refused start, which
 * never reaches `onRunEnded`.
 */
import type { Runner } from '../lib/session/runner';

export function trackBusy(runner: Pick<Runner, 'state' | 'settled'>, send: (busy: boolean) => void): () => void {
  // Seeded from the runner's phase (final review M4), not `false`: a tracker
  // that attaches mid-run — a re-attach, or a second surface joining one
  // already live — must say busy at once, or Electron's close handshake
  // never learns the session is live and the run's own end never clears it
  // (nothing here saw the start that made it busy).
  let busy = runner.state.getState().phase !== 'idle';
  if (busy) send(true);
  /** Bumped on every change: a settle that resolves after a newer change says nothing. */
  let generation = 0;
  return runner.state.subscribe((state) => {
    generation += 1;
    if (state.phase !== 'idle') {
      if (!busy) {
        busy = true;
        send(true);
      }
      return;
    }
    if (!busy) return;
    const mine = generation;
    void runner.settled().then(() => {
      if (mine !== generation || !busy) return;
      busy = false;
      send(false);
    });
  });
}
