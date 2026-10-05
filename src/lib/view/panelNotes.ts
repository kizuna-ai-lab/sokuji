/**
 * Panel notes as the list draws them: notice entries on the speaker leg, with
 * an id the panel can tell from L1's, so the note's own action is found
 * (spec 2026-10-05 §5). The same notes give the same array, so a memoized
 * list keeps its items.
 */
import type { PanelNote } from '../../stores/panelNotesStore';
import type { NoticeEntry } from './filter';
import { actionForCode, type NoticeActionSpec } from './noticeActions';

export const PANEL_NOTE_ID_PREFIX = 'panel:';

export function isPanelNoteId(id: string): boolean {
  return id.startsWith(PANEL_NOTE_ID_PREFIX);
}

const cache = new WeakMap<readonly PanelNote[], NoticeEntry[]>();

export function panelNoteEntries(notes: readonly PanelNote[]): NoticeEntry[] {
  const hit = cache.get(notes);
  if (hit) return hit;
  const entries = notes.map((n): NoticeEntry => ({
    kind: 'notice',
    id: `${PANEL_NOTE_ID_PREFIX}${n.id}`,
    leg: 'speaker',
    severity: n.severity,
    message: n.message,
    code: n.code,
    ...(n.params ? { params: n.params } : {}),
    ...(n.lifetime ? { lifetime: n.lifetime } : {}),
    at: n.at,
  }));
  cache.set(notes, entries);
  return entries;
}

/**
 * What a drawn notice offers (spec 2026-10-05 §6): a panel note carries its
 * own action, an L1 notice's follows its code. Each surface decides which
 * kinds it can honour.
 */
export function noticeActionSpec(notice: NoticeEntry, notes: readonly PanelNote[]): NoticeActionSpec | null {
  if (!isPanelNoteId(notice.id)) return actionForCode(notice.code);
  return notes.find((n) => `${PANEL_NOTE_ID_PREFIX}${n.id}` === notice.id)?.action ?? null;
}
