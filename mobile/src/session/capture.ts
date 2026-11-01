import type { Route } from './route';

// The session's pure audio decisions (spec §6, D7, D8), kept apart from
// session.ts so the node tests reach them without the native modules.

/** Which canceller runs: `none` is the plain path, the others follow availability only. */
export type CaptureChain = 'none' | 'voiceProcessing' | 'vendor' | 'aec3';

export function headphones(route: Route): boolean {
  return route === 'headphones' || route === 'bluetooth';
}

/** One switch, two stored values: the phone's speaker, and every other output. */
export interface EchoSettings {
  echoCancellation: boolean;
  echoCancellationOther: boolean;
}

export function wanted(s: EchoSettings, route: Route): boolean {
  return route === 'speaker' ? s.echoCancellation : s.echoCancellationOther;
}

/** Whether capture runs processed: with `listen` off nothing plays, so nothing can echo. */
export function echoCancellationFor(s: EchoSettings & { listen: boolean; route: Route }): boolean {
  return s.listen && wanted(s, s.route);
}

/**
 * Whether the translation may play: always with no processing wanted (the user
 * chose plain capture, or the output does not reach the microphone), otherwise
 * only with a chain running. A null chain is a capture not started yet.
 */
export function speakable(s: EchoSettings & { listen: boolean; route: Route; chain: CaptureChain | null }): boolean {
  return s.listen && (!wanted(s, s.route) || (s.chain ?? 'none') !== 'none');
}

/** The Devices row: the current output's value, the key it writes, and whether turning it on asks first. */
export function echoRowState(s: EchoSettings, route: Route): { checked: boolean; key: 'echoCancellation' | 'echoCancellationOther'; confirmBeforeOn: boolean } {
  const speaker = route === 'speaker';
  return { checked: wanted(s, route), key: speaker ? 'echoCancellation' : 'echoCancellationOther', confirmBeforeOn: !speaker };
}
