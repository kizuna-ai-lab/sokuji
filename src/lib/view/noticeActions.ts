/**
 * What a notice offers the user to do about it, in one place (spec
 * 2026-10-05 §6). A code resolves to an action here; MainPanel owns the
 * handlers; rows and the status line only draw the label.
 */
import { MIC_BLOCKED, MIC_IN_USE } from '../audio/capture/micFailure';
import { LOOPBACK_DENIED } from '../audio/capture/systemAudio';
import type { LegName } from '../conversation/types';
import { BALANCE_BELOW_FLOOR } from '../session/shape';
import { settingsTargetForCode } from './noticeTargets';

export type NoticeActionSpec =
  | { kind: 'settings'; target: string }
  | { kind: 'top-up' }
  | { kind: 'sign-in' }
  | { kind: 'system-settings'; pane: 'screen-recording' | 'audio-capture' }
  | { kind: 'show-in-folder'; dir: string }
  | { kind: 'engine-slot'; leg: LegName; stage: 'tts' }
  // Windows' own settings, opened directly (spec 2026-10-13 §3).
  | { kind: 'windows-settings'; page: 'microphone-privacy' | 'sound-recording' };

/** The managed provider's lease refused a start, or the gate did, on the balance: both are fixed by topping up. */
const TOP_UP_CODES: ReadonlySet<string> = new Set([BALANCE_BELOW_FLOOR, 'insufficient_balance']);

/** Local inference's text-only warnings (#619), each naming its leg: the fix is that direction's TTS slot. */
const TTS_SLOT_LEGS: ReadonlyMap<string, LegName> = new Map([
  ['speaker_tts_missing', 'speaker'],
  ['participant_tts_missing', 'participant'],
  ['participant_tts_over_budget', 'participant'],
]);

export function actionForCode(code: string | undefined): NoticeActionSpec | null {
  if (code === undefined) return null;
  if (code === LOOPBACK_DENIED) return { kind: 'system-settings', pane: 'screen-recording' };
  // Exclusive mode is switched on the Sound panel's Recording tab; the privacy switch has its own page.
  if (code === MIC_IN_USE) return { kind: 'windows-settings', page: 'sound-recording' };
  if (code === MIC_BLOCKED) return { kind: 'windows-settings', page: 'microphone-privacy' };
  if (TOP_UP_CODES.has(code)) return { kind: 'top-up' };
  if (code === 'sign_in_required') return { kind: 'sign-in' };
  const leg = TTS_SLOT_LEGS.get(code);
  if (leg) return { kind: 'engine-slot', leg, stage: 'tts' };
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
    case 'engine-slot': return { key: 'settings.title', fallback: 'Settings' };
    case 'windows-settings':
      return action.page === 'sound-recording'
        ? { key: 'audioPanel.openSoundSettings', fallback: 'Open Sound Settings' }
        : { key: 'audioPanel.openSystemSettings', fallback: 'Open System Settings' };
  }
}
