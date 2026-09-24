/**
 * Why the last start did not happen, drawn after the list (plan 1d-3). A
 * refused or failed start is recorded only on the runner's idle state — a
 * refused one keeps the last conversation, a failed one leaves empty legs —
 * so nothing else on screen would say it. A run that ended on its own
 * already carries its notice on a leg, and says nothing here.
 */
import type { RunState } from '../session/types';
import type { DisplayItem } from './filter';

export function lastEndItem(state: RunState): DisplayItem | null {
  if (state.phase !== 'idle' || !state.lastEnd?.notice) return null;
  const { reason, notice } = state.lastEnd;
  if (reason !== 'refused' && reason !== 'start-failed') return null;
  return {
    kind: 'notice',
    notice: {
      kind: 'notice',
      id: 'last-end',
      leg: notice.leg ?? 'speaker',
      severity: 'error',
      message: notice.message,
      ...(notice.code !== undefined ? { code: notice.code } : {}),
      ...(notice.params ? { params: notice.params } : {}),
      at: 0,
    },
  };
}
