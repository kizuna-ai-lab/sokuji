/**
 * The page's run phase for code that must not import the session's module
 * graph — `settingsStore.enterSubtitleMode`: the root imports the stores, so
 * a static import back would close a cycle (roadmap 1e-3a). `getAppSession()`
 * registers the reader when it builds the page's session; until then the
 * phase is idle, since no run can exist yet (plan 1e-3b-1 ruling 5).
 */
import type { RunState } from '../lib/session/types';

let read: () => RunState['phase'] = () => 'idle';

export function registerRunPhase(reader: () => RunState['phase']): void {
  read = reader;
}

export function currentRunPhase(): RunState['phase'] {
  return read();
}
