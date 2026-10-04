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
  /** `at` is for tests; the app stamps `Date.now()`, the clock `useVisibleEntries` reads. */
  add(input: PanelNoteInput, at?: number): void;
  clear(): void;
}

let seq = 0;

export const usePanelNotesStore = create<PanelNotesState>()(
  subscribeWithSelector((set) => ({
    notes: [],
    add: (input, at = Date.now()) => {
      seq += 1;
      set((state) => ({ notes: [...state.notes, { ...input, id: `${at}-${seq}`, at }] }));
    },
    clear: () => set({ notes: [] }),
  })),
);

export const usePanelNotes = () => usePanelNotesStore((s) => s.notes);
