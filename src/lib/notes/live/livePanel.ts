// src/lib/notes/live/livePanel.ts
//
// Whether the live notes panel is shown beside the conversation, and whether there is a panel at all. Hidden for a
// while from the switch in the conversation's toolbar (owner and design review, 2026-11-17; B-30, B-40): hiding is not
// stopping, the notes go on being written, and new ones do not show the panel again. The choice is kept on this
// computer for the next session.
import { create } from 'zustand';
import { isElectron } from '../../../utils/environment';
import { useLiveNotesSetting } from '../../../stores/settingsStore';
import { useLiveNotes } from './liveStore';

const HIDDEN_KEY = 'liveNotes.hidden';

/** Shown unless it was hidden. */
export function readLiveNotesShown(): boolean {
  try { return localStorage.getItem(HIDDEN_KEY) !== '1'; } catch { return true; }
}

export const useLiveNotesShown = create<{ shown: boolean; setShown(shown: boolean): void }>((set) => ({
  shown: readLiveNotesShown(),
  setShown: (shown) => {
    try {
      if (shown) localStorage.removeItem(HIDDEN_KEY); else localStorage.setItem(HIDDEN_KEY, '1');
    } catch { /* shown again next time */ }
    set({ shown });
  },
}));

/** There is a live notes panel (desktop; live notes on, or something written or said about them this session). */
export function useLiveNotesPresent(): boolean {
  const { recordId, state, running, off } = useLiveNotes();
  const liveOn = useLiveNotesSetting();
  if (!isElectron() || (!liveOn && !state && !running && !off)) return false;
  return Boolean(recordId || state);
}
