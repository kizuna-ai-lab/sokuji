import { describe, it, expect } from 'vitest';
import type { AudioDevice } from '../../stores/audioStore';
import { chooseInput, chooseOutput, pickDefaultInputDevice } from './deviceChoice';

const real = (deviceId: string, label = deviceId): AudioDevice => ({ deviceId, label, isVirtual: false });
const virtualMic: AudioDevice = { deviceId: 'virtual', label: 'Sokuji_Virtual_Mic', isVirtual: true };
const loopback: AudioDevice = { deviceId: 'loop', label: 'Monitor of Built-in Audio', isVirtual: false };

describe('chooseInput', () => {
  it('picks the saved device when it is listed, over the current one: this is what switches back', () => {
    const devices = [real('b'), real('a')];
    expect(chooseInput({ devices, savedId: 'a', currentId: 'b' })?.deviceId).toBe('a');
  });

  it('keeps the current device when the saved one is gone', () => {
    expect(chooseInput({ devices: [real('c'), real('b')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('b');
  });

  it('falls back to the first real input, skipping virtual and loopback inputs, when both are gone', () => {
    expect(chooseInput({ devices: [virtualMic, loopback, real('c')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('c');
  });

  it('never restores a saved virtual device', () => {
    expect(chooseInput({ devices: [virtualMic, real('c')], savedId: 'virtual', currentId: null })?.deviceId).toBe('c');
  });

  it('skips inputs marked unusable, the saved and the current one included', () => {
    const devices = [real('a'), real('b'), real('c')];
    expect(chooseInput({ devices, savedId: 'a', currentId: 'b', unusable: new Set(['a', 'b']) })?.deviceId).toBe('c');
  });

  it('returns null — the waiting state — when only virtual and loopback inputs are left', () => {
    expect(chooseInput({ devices: [virtualMic, loopback], savedId: 'a', currentId: 'a' })).toBeNull();
    expect(chooseInput({ devices: [], savedId: null, currentId: null })).toBeNull();
  });
});

describe('chooseOutput', () => {
  const virtualSpeaker: AudioDevice = { deviceId: 'vs', label: 'Sokuji_Virtual_Speaker', isVirtual: true };

  it('picks the saved output, then the current one, then the first non-virtual, then any', () => {
    expect(chooseOutput({ devices: [real('b'), real('a')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('a');
    expect(chooseOutput({ devices: [real('b')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('b');
    expect(chooseOutput({ devices: [virtualSpeaker, real('c')], savedId: 'a', currentId: 'b' })?.deviceId).toBe('c');
    expect(chooseOutput({ devices: [virtualSpeaker], savedId: null, currentId: null })?.deviceId).toBe('vs');
    expect(chooseOutput({ devices: [], savedId: null, currentId: null })).toBeNull();
  });
});

describe('pickDefaultInputDevice', () => {
  it('is still exported from the audio store, for its existing callers', async () => {
    const store = await import('../../stores/audioStore');
    expect(store.pickDefaultInputDevice).toBe(pickDefaultInputDevice);
  });
});
