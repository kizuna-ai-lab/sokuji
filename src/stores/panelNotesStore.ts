/**
 * Panel notes: the results of a user's action that concern the conversation
 * — copied, auto-saved — drawn as system rows after the conversation's own
 * entries (spec 2026-10-05 §5). They are not L1 notices on purpose: the
 * exports and the subtitle bands read L1 only, so nothing has to filter them
 * out. Cleared by Clear and by the next start; never persisted.
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { NoticeActionSpec } from '../lib/view/noticeActions';

export const PANEL_NOTE_CODES = {
  exportCopied: 'export_copied',
  exportCopyFailed: 'export_copy_failed',
  autoSaveSaved: 'autosave_saved',
  autoSaveFailed: 'autosave_failed',
} as const;

export interface PanelNote {
  id: string;
  at: number;
  severity: 'error' | 'warning' | 'info';
  /** A `NOTICE_ALIASES` code: the words come from `noticeText`. */
  code: string;
  /** Diagnostic English, as a Notice's. */
  message: string;
  params?: Record<string, string | number>;
  lifetime?: 'transient';
  action?: NoticeActionSpec;
}

export type PanelNoteInput = Omit<PanelNote, 'id' | 'at'>;

interface PanelNotesState {
  notes: readonly PanelNote[];
  /** Counts the clears: which conversation the notes are after (see `panelNoteWriter`). */
  epoch: number;
  /** `at` is for tests; the app stamps `Date.now()`, the clock `useVisibleEntries` reads. */
  add(input: PanelNoteInput, at?: number): void;
  clear(): void;
}

let seq = 0;

export const usePanelNotesStore = create<PanelNotesState>()(
  subscribeWithSelector((set) => ({
    notes: [],
    epoch: 0,
    add: (input, at = Date.now()) => {
      seq += 1;
      set((state) => ({ notes: [...state.notes, { ...input, id: `${at}-${seq}`, at }] }));
    },
    // Every clear is a new epoch, also one that removes nothing: a start with
    // no notes still ends the conversation a pending result was about.
    clear: () => set((state) => ({ notes: [], epoch: state.epoch + 1 })),
  })),
);

export const usePanelNotes = () => usePanelNotesStore((s) => s.notes);

/**
 * A writer bound to the conversation on screen now, for a result that arrives
 * later than the action that asked for it (the clipboard's answer, a
 * transcript save that outlives the runner's bound). Take it before awaiting:
 * what it is handed after a Clear or the next start is dropped, because by
 * then it would be drawn after another conversation.
 */
export function panelNoteWriter(): (input: PanelNoteInput) => void {
  const { epoch } = usePanelNotesStore.getState();
  return (input) => {
    const store = usePanelNotesStore.getState();
    if (store.epoch === epoch) store.add(input);
  };
}
