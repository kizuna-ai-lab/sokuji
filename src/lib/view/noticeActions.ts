/**
 * What a notice offers the user to do about it, in one place (spec
 * 2026-10-05 §6). A code resolves to an action here; MainPanel owns the
 * handlers; rows and the status line only draw the label.
 */
import { LOOPBACK_DENIED } from '../audio/capture/systemAudio';
import { BALANCE_BELOW_FLOOR } from '../session/shape';
import { settingsTargetForCode } from './noticeTargets';

export type NoticeActionSpec =
  | { kind: 'settings'; target: string }
  | { kind: 'top-up' }
  | { kind: 'sign-in' }
  | { kind: 'system-settings'; pane: 'screen-recording' | 'audio-capture' }
  | { kind: 'show-in-folder'; dir: string };

/** The managed provider's lease refused a start, or the gate did, on the balance: both are fixed by topping up. */
const TOP_UP_CODES: ReadonlySet<string> = new Set([BALANCE_BELOW_FLOOR, 'insufficient_balance']);

export function actionForCode(code: string | undefined): NoticeActionSpec | null {
  if (code === undefined) return null;
  if (code === LOOPBACK_DENIED) return { kind: 'system-settings', pane: 'screen-recording' };
  if (TOP_UP_CODES.has(code)) return { kind: 'top-up' };
  if (code === 'sign_in_required') return { kind: 'sign-in' };
  const target = settingsTargetForCode(code);
  return target ? { kind: 'settings', target } : null;
}

/** The action's label: a key every catalog has, and the English `defaultValue`. */
export function actionLabel(action: NoticeActionSpec): { key: string; fallback: string } {
  switch (action.kind) {
    case 'settings': return { key: 'settings.title', fallback: 'Settings' };
    case 'top-up': return { key: 'common.topUp', fallback: 'Top up' };
    case 'sign-in': return { key: 'common.signIn', fallback: 'Sign In' };
    case 'system-settings': return { key: 'audioPanel.openSystemSettings', fallback: 'Open System Settings' };
    case 'show-in-folder': return { key: 'mainPanel.export.autoSave.showInFolder', fallback: 'Show in folder' };
  }
}
