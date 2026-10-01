import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunEnd, RunState } from '../../../lib/session/types';
import type { Leg } from '../../../lib/conversation/types';
import type { WarningType } from '../../Settings/shared/hooks';
import useAudioStore from '../../../stores/audioStore';
import { silentNoPermissionPresentation } from '../participantWarnings';
import { LOOPBACK_DENIED, SILENT_NO_PERMISSION } from '../../../lib/audio/capture/systemAudio';

/**
 * The two capture-permission modals (1e-3 ruling 17): a run that ended idle
 * with a `loopback_denied` notice opens the Screen Recording modal, and a
 * fresh `silent_no_permission` notice on the participant leg opens the
 * audio-capture modal while no tap has ever proven the permission on this
 * machine (#492, `silentNoPermissionPresentation`). `open`/`close` are
 * `useCallback`s with no dependencies — `setWarning` is stable — so the
 * notice action Task 12 builds on `open` keeps its identity across renders.
 */
export function usePermissionWarning(
  run: RunState,
  legs: readonly Leg[],
): { warning: WarningType | null; open(type: WarningType): void; close(): void } {
  const [warning, setWarning] = useState<WarningType | null>(null);
  const open = useCallback((type: WarningType) => setWarning(type), []);
  const close = useCallback(() => setWarning(null), []);

  // Only a *new* idle end opens the modal: re-rendering with the same
  // `lastEnd` object (e.g. after the person closes it) must not reopen it.
  const lastEndSeenRef = useRef<RunEnd | undefined>(undefined);
  useEffect(() => {
    if (run.phase !== 'idle') return;
    if (run.lastEnd === lastEndSeenRef.current) return;
    lastEndSeenRef.current = run.lastEnd;
    if (run.lastEnd?.notice?.code === LOOPBACK_DENIED) open('screen-recording-denied');
  }, [run, open]);

  // Every participant notice id seen once, so a later render with the same
  // notice (still on the leg) never opens the modal a second time. Never
  // cleared: a leg's notice ids are unique per run, so this only grows —
  // a page's worth, held for the panel's lifetime.
  const seenNoticeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const participant = legs.find((leg) => leg.leg === 'participant');
    if (!participant) return;
    for (const notice of participant.notices) {
      if (seenNoticeIdsRef.current.has(notice.id)) continue;
      seenNoticeIdsRef.current.add(notice.id);
      if (notice.code !== SILENT_NO_PERMISSION) continue;
      const tapAudioSeen = useAudioStore.getState().participantTapAudioSeen;
      if (silentNoPermissionPresentation({ tapAudioSeen }) === 'modal') {
        open('audio-capture-denied');
      }
    }
  }, [legs, open]);

  return { warning, open, close };
}
