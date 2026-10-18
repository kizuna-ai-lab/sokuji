// src/lib/audio/vbCable.ts
import { findVirtualSpeaker } from './virtualSpeaker';

/**
 * Whether VB-CABLE, Windows' virtual microphone, is there (spec 2026-10-17 §4).
 * `present` is the routing's own test (`findVirtualSpeaker`), so a prompt shows
 * exactly when the translation has no virtual device to go to.
 */
export type VbCablePresence = 'not-applicable' | 'unknown' | 'present' | 'missing';

export interface VbCablePresenceInput {
  electron: boolean;
  windows: boolean;
  devicesLoaded: boolean;
  outputs: readonly { deviceId: string; label: string }[];
}

export function vbCablePresence({ electron, windows, devicesLoaded, outputs }: VbCablePresenceInput): VbCablePresence {
  if (!electron || !windows) return 'not-applicable';
  // Before media permission every label is empty and no device can be told apart.
  if (!devicesLoaded || outputs.every((device) => !device.label)) return 'unknown';
  return findVirtualSpeaker(outputs) ? 'present' : 'missing';
}

export const VB_AUDIO_URL = 'https://vb-audio.com/Cable/';
export const VB_CABLE_SETUP_FILE = 'VBCABLE_Setup_x64.exe';
