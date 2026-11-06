/**
 * The status line (spec 2026-10-05 §3): why the user cannot start, or what is
 * wrong right now. Not a record — the condition's presence is the line's. One
 * line at a time, the highest of: cannot start › reconnecting › waiting for a
 * microphone › the subtitle layer unavailable › echo. Pure: the inputs come
 * from `useStatusLine`, so this is testable without React.
 */
import type { EchoCause, EchoNoticeState } from '../modern-audio/EchoMonitor';
import { BALANCE_BELOW_FLOOR, NO_MICROPHONE, QUOTA_PENDING, QUOTA_UNKNOWN } from '../session/shape';
import type { LegName } from '../conversation/types';
import type { ReconnectProgress, RunEnd, RunState } from '../session/types';
import type { SubtitleIdleModel } from '../subtitle/session';
import { actionForCode, type NoticeActionSpec } from './noticeActions';

export type StatusIcon = 'mic-off' | 'key-round' | 'wallet' | 'refresh-cw' | 'triangle-alert' | 'captions' | 'circle-alert';

export type StatusWords =
  /** Worded by `noticeText` (a notice code, or the diagnostic message for an uncoded one). */
  | { kind: 'notice'; code: string; params?: Record<string, string | number>; message: string }
  /** One catalog key. */
  | { kind: 'key'; key: string; fallback: string; params?: Record<string, string | number> }
  /** An echo cause: its message and its advice, from `ECHO_WORDS`. */
  | { kind: 'echo'; cause: EchoCause };

export interface StatusEntry {
  /** Stable per condition: the same line across renders, another line when the condition changes. */
  key: string;
  icon: StatusIcon;
  words: StatusWords;
  /**
   * What the line's live region says when that differs from `words`: steady
   * words for a line whose visible ones tick (the reconnect's attempt and
   * seconds), so a screen reader is not read the line again every second.
   */
  announce?: StatusWords;
  action: NoticeActionSpec | null;
  /** What a dismiss means, when the line offers one. */
  dismiss: 'echo' | 'subtitle-entry' | null;
}

export interface StatusLineInput {
  run: RunState;
  /** The subtitle session's idle model (`idleOf`), the gate both surfaces read. */
  idle: SubtitleIdleModel;
  canStart: boolean;
  /** The end Clear hid (MainPanel's `dismissedEnd`): compared by identity, so a later end draws again. */
  dismissedEnd: RunEnd | null;
  /** Running with a speaker leg and no usable input selected (`audioStore.selectedInputDevice === null`). */
  waitingForMicrophone: boolean;
  /** The extension's content script was missing on the last attempt to enter subtitle mode (`subtitleStore.entryHint`). */
  subtitleEntryHint: boolean;
  /** `useEchoNotice`'s visible notice: already null while its cause is dismissed. */
  echo: EchoNoticeState | null;
  /** The run's clock now (wall clock in production), for the reconnect elapsed time. */
  now: number;
}

const KEY_CODES: ReadonlySet<string> = new Set(['credentials_missing', 'sign_in_required', 'sign_in_pending', 'auth']);
const WALLET_CODES: ReadonlySet<string> = new Set([BALANCE_BELOW_FLOOR, 'insufficient_balance', QUOTA_PENDING, QUOTA_UNKNOWN, 'wallet_frozen']);

function iconFor(code: string | undefined): StatusIcon {
  if (code === NO_MICROPHONE) return 'mic-off';
  if (code !== undefined && KEY_CODES.has(code)) return 'key-round';
  if (code !== undefined && WALLET_CODES.has(code)) return 'wallet';
  return 'circle-alert';
}

function blocker(key: string, code: string | undefined, message: string, params?: Record<string, string | number>): StatusEntry {
  return {
    key,
    icon: iconFor(code),
    words: { kind: 'notice', code: code ?? '', message, ...(params ? { params } : {}) },
    action: actionForCode(code),
    dismiss: null,
  };
}

export function statusLine(input: StatusLineInput): StatusEntry | null {
  const { run, idle, canStart, dismissedEnd, waitingForMicrophone, subtitleEntryHint, echo, now } = input;
  if (run.phase === 'idle') {
    // 1a. The live gate: what the stores refuse now (a stale failure never outranks it).
    if (!canStart && idle.kind === 'unready') return blocker(`unready:${idle.code ?? 'message'}`, idle.code, idle.message, idle.params);
    // 1b. The last start, refused or failed, until the next start or Clear. A run that
    // ended on its own already carries its notice on a leg (spec §2); this is not it.
    const end = run.lastEnd;
    if (end && (end.reason === 'refused' || end.reason === 'start-failed') && end.notice && end !== dismissedEnd) {
      return blocker(`last-end:${end.notice.code}`, end.notice.code, end.notice.message, end.notice.params);
    }
  }
  if (run.phase === 'running') {
    // 2. Reconnecting: the footer's dot pulses; the line carries the words in both modes.
    const legs = Object.keys(run.legs) as LegName[];
    if (legs.some((leg) => run.legs[leg] === 'reconnecting')) {
      // The earliest drop is the one the user has waited longest for. A leg with no entry (Gemini) has no attempts to count.
      let first: ReconnectProgress | undefined;
      for (const leg of legs) {
        const p = run.legs[leg] === 'reconnecting' ? run.reconnect?.[leg] : undefined;
        if (p && (!first || p.since < first.since)) first = p;
      }
      const steady: StatusWords = { kind: 'key', key: 'connectionStatus.reconnecting', fallback: 'Reconnecting...' };
      if (first) {
        const words: StatusWords = { kind: 'key', key: 'connectionStatus.reconnectingAttempt', fallback: 'Reconnecting… (attempt {{attempt}}, {{seconds}} s)', params: { attempt: first.attempt, seconds: Math.max(0, Math.floor((now - first.since) / 1000)) } };
        return { key: 'reconnecting', icon: 'refresh-cw', words, announce: steady, action: null, dismiss: null };
      }
      return { key: 'reconnecting', icon: 'refresh-cw', words: steady, action: null, dismiss: null };
    }
    // 3. Waiting for a microphone (#596): the moment it went away was an event row; this is the wait.
    if (waitingForMicrophone) {
      return { key: 'mic-waiting', icon: 'mic-off', words: { kind: 'notice', code: 'mic_lost_waiting', message: 'The microphone went away; waiting for one to be connected.' }, action: null, dismiss: null };
    }
  }
  // 4. The subtitle layer could not be entered (the extension): the user just pressed the button, so this outranks the ambient echo.
  // Only while running: the overlay opens only then (Ruling 11), and an ended run leaves nothing to enter.
  if (run.phase === 'running' && subtitleEntryHint) {
    return { key: 'subtitle-entry', icon: 'captions', words: { kind: 'key', key: 'subtitle.enterButton.refreshPageHint', fallback: 'Refresh the meeting tab and try again' }, action: null, dismiss: 'subtitle-entry' };
  }
  // 5. Echo: per-cause dismissal and the all-clear reset stay on `useEchoNotice`.
  if (echo) return { key: `echo:${echo.cause}`, icon: 'triangle-alert', words: { kind: 'echo', cause: echo.cause }, action: null, dismiss: 'echo' };
  return null;
}
