// src/lib/notes/live/livePanel.ts
//
// What the conversation's area shows with the live notes (owner, 2026-11-18): both side by side, the notes alone, or
// the conversation alone, which the switch in the conversation's toolbar goes round in that order. Hiding the notes is
// not stopping them: they go on being written, and new ones do not show them again (owner and design review,
// 2026-11-17; B-30, B-40). The choice is kept on this computer for the next session. With no notes panel there is only
// the conversation, whatever was chosen.
import { create } from 'zustand';
import { isElectron } from '../../../utils/environment';
import { useLiveNotesSetting } from '../../../stores/settingsStore';
import { useLiveNotes } from './liveStore';

export type LiveNotesLayout = 'both' | 'notes' | 'conversation';

const LAYOUT_KEY = 'liveNotes.layout';
/** Before the three layouts (2026-11-17): '1' was the notes hidden, the conversation alone. */
const HIDDEN_KEY = 'liveNotes.hidden';

/** The switch's round: side by side, then the notes alone, then the conversation alone. */
export const NEXT_LAYOUT: Readonly<Record<LiveNotesLayout, LiveNotesLayout>> = { both: 'notes', notes: 'conversation', conversation: 'both' };

function isLayout(value: string | null): value is LiveNotesLayout {
  return value === 'both' || value === 'notes' || value === 'conversation';
}

/** The layout kept from last time; side by side the first time. */
export function readLiveNotesLayout(): LiveNotesLayout {
  try {
    const kept = localStorage.getItem(LAYOUT_KEY);
    if (isLayout(kept)) return kept;
    return localStorage.getItem(HIDDEN_KEY) === '1' ? 'conversation' : 'both';
  } catch {
    return 'both';
  }
}

export const useLiveNotesLayout = create<{ layout: LiveNotesLayout; setLayout(layout: LiveNotesLayout): void }>((set) => ({
  layout: readLiveNotesLayout(),
  setLayout: (layout) => {
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
      localStorage.removeItem(HIDDEN_KEY);
    } catch { /* this layout for this session only */ }
    set({ layout });
  },
}));

/**
 * There is a live notes panel: in the desktop app, while live notes are on (before a session starts too, the panel
 * then saying where its notes will come; owner, 2026-11-17), or while this session wrote or said something about them.
 */
export function useLiveNotesPresent(): boolean {
  const { recordId, state, running, off } = useLiveNotes();
  const liveOn = useLiveNotesSetting();
  if (!isElectron()) return false;
  if (liveOn) return true;
  return Boolean((state || running || off) && (recordId || state));
}

/** What the conversation's area shows now: the layout chosen, while there is a notes panel; the conversation without one. */
export function useLiveNotesShows(): { notes: boolean; conversation: boolean } {
  const layout = useLiveNotesLayout((x) => x.layout);
  const present = useLiveNotesPresent();
  if (!present) return { notes: false, conversation: true };
  return { notes: layout !== 'conversation', conversation: layout !== 'notes' };
}
