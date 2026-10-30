import { describe, it, expect } from 'vitest';
import { routeOf, microphoneChoices } from './route';

const dev = (id: string, name: string, category: string) => ({ id, name, category });

describe('routeOf', () => {
  it('names a wired headset, a Bluetooth output and the loudspeaker', () => {
    expect(routeOf({ currentOutputs: [dev('o1', 'Headphones', 'WiredHeadphones')] })).toBe('headphones');
    expect(routeOf({ currentOutputs: [dev('o2', 'AirPods', 'BluetoothA2DP')] })).toBe('bluetooth');
    expect(routeOf({ currentOutputs: [dev('o3', 'Speaker', 'BuiltInSpeaker')] })).toBe('speaker');
    expect(routeOf({ currentOutputs: [] })).toBe('speaker');
    expect(routeOf({ currentOutputs: [dev('o4', 'TV', 'AirPlay')] })).toBe('other');
  });
});

describe('microphoneChoices', () => {
  it('lists the built-in first, then the wired and USB inputs, and leaves Bluetooth out', () => {
    const inputs = [
      dev('i2', 'Headset mic', 'WiredHeadset'),
      dev('i1', 'iPhone Microphone', 'BuiltInMicrophone'),
      dev('i3', 'AirPods', 'BluetoothHFP'),
      dev('i4', 'Yeti', 'USBAudio'),
    ];
    expect(microphoneChoices({ availableInputs: inputs })).toEqual([
      { id: 'i1', kind: 'builtin', name: 'iPhone Microphone' },
      { id: 'i2', kind: 'wired', name: 'Headset mic' },
      { id: 'i4', kind: 'usb', name: 'Yeti' },
    ]);
  });
});
