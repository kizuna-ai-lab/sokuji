import type { Status } from '../session/session';

type T = (key: string, values?: Record<string, string>) => string;

/** What the main screen is showing: before the first Start, a session's state, or a Stop under way. */
export type MainState = Status | 'idle' | 'stopping';

/** Before the first Start: what Start will do. */
export function idleHint(t: T, targetName: string): string {
  return t('mobile.main.idleHint', { language: targetName });
}

/** The arrow from what is heard to what is read; in a right-to-left language the heard one is on the right, so it points left. */
export function pairArrow(rtl: boolean): string {
  return rtl ? '←' : '→';
}

/** The pair takes its own line above Start from about the first accessibility size; there the sides stack too. */
export const PAIR_STACK_FROM_FONT_SCALE = 1.35;

/**
 * How the bar at the bottom of the main screen is laid out: the pair beside
 * Start ('row'); the pair on its own line above Start when a name had to wrap
 * there ('stacked'); the two sides one above the other when a name still
 * wrapped, or at the accessibility text sizes ('column'). `overflow` counts
 * the layouts a name has wrapped in; nothing is ever shrunk or cut.
 */
export function pairLayout(fontScale: number, overflow: number): 'row' | 'stacked' | 'column' {
  if (fontScale >= PAIR_STACK_FROM_FONT_SCALE || overflow >= 2) return 'column';
  return overflow === 1 ? 'stacked' : 'row';
}

/**
 * How much of the pair's width a name should get beside the other: the sum of
 * its characters' widths in ems, a Han, kana, Hangul or full-width character
 * about one, anything else about half. A share by character count alone gave
 * three kana a fifth of the width beside "Auto Detect"; at least 1, so an
 * empty name still has a side.
 */
export function nameWeight(name: string): number {
  let weight = 0;
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    const wide = (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef);
    weight += wide ? 1 : 0.55;
  }
  return Math.max(1, weight);
}

/** "Heard → read" as one line (the history list). */
export function pairLabel(sourceName: string, targetName: string, rtl: boolean): string {
  return `${sourceName} ${pairArrow(rtl)} ${targetName}`;
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
