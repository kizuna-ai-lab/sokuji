import type { Status } from '../session/session';

type T = (key: string, values?: Record<string, string>) => string;

/** What the main screen is showing: before the first Start, a session's state, or a Stop under way. */
export type MainState = Status | 'idle' | 'stopping';

/** Before the first Start: what Start will do. */
export function idleHint(t: T, targetName: string): string {
  return t('mobile.main.idleHint', { language: targetName });
}

/** "Heard → read"; in a right-to-left language the heard one is on the right, so the arrow points left. */
export function pairLabel(sourceName: string, targetName: string, rtl: boolean): string {
  return `${sourceName} ${rtl ? '←' : '→'} ${targetName}`;
}

// What the status line says: a key per state, the terminal details by name,
// any other failure in words (design scope: no raw service errors on screen;
// the session logs the detail itself).
export function statusLine(t: T, status: MainState, detail: string): string {
  if (status === 'idle') return '';
  if (status === 'stopping') return t('mobile.main.status.stopping');
  if (status === 'error') {
    if (detail === 'sign_in_required') return t('mobile.main.status.signInRequired');
    if (detail === 'balance_exhausted') return t('mobile.main.status.balanceExhausted');
    if (detail === 'microphone_denied') return t('mobile.main.status.micDenied');
    if (detail === 'invalid_config') return t('mobile.main.status.invalidConfig');
    return t('mobile.common.failed');
  }
  if (status === 'listening') {
    if (detail === 'spoken') return t('mobile.main.status.spoken');
    if (detail === 'subtitles_only') return t('mobile.main.status.subtitlesOnly');
    if (detail === 'paused') return t('mobile.main.status.paused');
    return t('mobile.main.status.listening');
  }
  if (status === 'reconnecting') return detail === 'other_session' ? t('mobile.main.status.otherSession') : t('mobile.main.status.reconnecting');
  if (status === 'stopped') return t('mobile.main.status.stopped');
  return t('mobile.main.status.starting');
}

/** How the status line looks: a failure must not read like a state. */
export function statusTone(status: MainState): 'normal' | 'warning' | 'error' {
  if (status === 'error') return 'error';
  if (status === 'reconnecting') return 'warning';
  return 'normal';
}
