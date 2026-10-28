import { describe, expect, it } from 'vitest';
import { outputLines } from './deviceText';

const t = (key: string) => key;

describe('the playback device line', () => {
  it('names the route in words, not the system string', () => {
    expect(outputLines(t, 'speaker', 'sdk_gphone64_arm64')).toEqual({ label: 'mobile.devices.route.speaker' });
  });

  it('adds the device’s own name for headphones and Bluetooth, where it tells them apart', () => {
    expect(outputLines(t, 'bluetooth', 'AirPods Pro')).toEqual({ label: 'mobile.devices.route.bluetooth', value: 'AirPods Pro' });
    expect(outputLines(t, 'headphones', '')).toEqual({ label: 'mobile.devices.route.headphones' });
  });
});
