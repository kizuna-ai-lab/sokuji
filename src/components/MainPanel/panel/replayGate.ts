import { isApplicationSource } from '../../../lib/modern-audio/participantSource';
import type { RunState } from '../../../lib/session/types';
import type { Platform } from '../../../lib/provider/types';
import { APP_CAPTURE_LOST, APP_MONITOR_MISSING } from '../../../lib/audio/capture/systemAudio';

export interface ReplayGateInput {
  run: RunState;
  platform: Platform;
  participantSourceId: string | undefined;
  participantNoticeCodes: readonly string[];
}

/**
 * Replay is off while the participant leg captures the whole system during a
 * run: a replay would be captured and translated again as Other (decided for
 * 1e-3, roadmap "Decided for 1e"). Electron only — the extension captures the
 * meeting's tab, never the side panel; the web has no participant leg. A
 * source is the whole system unless it names one application (`app:…`) or
 * that application's capture fell back to the whole system this run.
 */
export function replayBlocked({ run, platform, participantSourceId, participantNoticeCodes }: ReplayGateInput): boolean {
  if (run.phase !== 'running' || !run.legs.participant || platform !== 'electron') return false;
  if (!isApplicationSource(participantSourceId)) return true;
  return participantNoticeCodes.some((code) => code === APP_CAPTURE_LOST || code === APP_MONITOR_MISSING);
}
