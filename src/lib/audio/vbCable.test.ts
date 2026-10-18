// src/lib/audio/vbCable.test.ts
import { describe, it, expect } from 'vitest';
import { vbCablePresence } from './vbCable';

const SPEAKERS = { deviceId: 'spk', label: 'Speakers (Realtek(R) Audio)' };
const CABLE = { deviceId: 'cable', label: 'CABLE Input (VB-Audio Virtual Cable)' };
const win = { electron: true, windows: true, devicesLoaded: true };

describe('vbCablePresence', () => {
  it('does not apply outside Windows Electron', () => {
    expect(vbCablePresence({ ...win, windows: false, outputs: [SPEAKERS] })).toBe('not-applicable');
    expect(vbCablePresence({ ...win, electron: false, outputs: [SPEAKERS] })).toBe('not-applicable');
  });

  it('is unknown until the device list has loaded', () => {
    expect(vbCablePresence({ ...win, devicesLoaded: false, outputs: [] })).toBe('unknown');
  });

  it('is unknown while every label is empty, before media permission', () => {
    expect(vbCablePresence({ ...win, outputs: [{ deviceId: 'a', label: '' }, { deviceId: 'b', label: '' }] })).toBe('unknown');
  });

  it('is present when the routing would find a virtual device, and missing otherwise', () => {
    expect(vbCablePresence({ ...win, outputs: [SPEAKERS, CABLE] })).toBe('present');
    expect(vbCablePresence({ ...win, outputs: [SPEAKERS] })).toBe('missing');
  });
});
