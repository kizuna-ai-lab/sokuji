// src/lib/audio/vbCable.test.ts
import { describe, it, expect } from 'vitest';
import { vbCablePresence } from './vbCable';

const SPEAKERS = { deviceId: 'spk', label: 'Speakers (Realtek(R) Audio)' };
const CABLE = { deviceId: 'cable', label: 'CABLE Input (VB-Audio Virtual Cable)' };
const win = { electron: true, windows: true, devicesLoaded: true, labelsKnown: true };

describe('vbCablePresence', () => {
  it('does not apply outside Windows Electron', () => {
    expect(vbCablePresence({ ...win, windows: false, outputs: [SPEAKERS] })).toBe('not-applicable');
    expect(vbCablePresence({ ...win, electron: false, outputs: [SPEAKERS] })).toBe('not-applicable');
  });

  it('is unknown until the device list has loaded', () => {
    expect(vbCablePresence({ ...win, devicesLoaded: false, outputs: [] })).toBe('unknown');
  });

  it('is unknown while the outputs carry no labels of their own, before media permission, whatever placeholder the list shows', () => {
    // The store's real shape: listAudioDevices names an unlabelled output "Speaker <id>...".
    const placeholders = [{ deviceId: 'abcdef01', label: 'Speaker abcde...' }, { deviceId: 'fedcba98', label: 'Speaker fedcb...' }];
    expect(vbCablePresence({ ...win, labelsKnown: false, outputs: placeholders })).toBe('unknown');
  });

  it('is present when the routing would find a virtual device, and missing otherwise', () => {
    expect(vbCablePresence({ ...win, outputs: [SPEAKERS, CABLE] })).toBe('present');
    expect(vbCablePresence({ ...win, outputs: [SPEAKERS] })).toBe('missing');
  });
});
