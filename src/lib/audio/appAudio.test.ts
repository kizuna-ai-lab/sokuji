import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { createAppRouting, readRouting } from './appAudio';

const AUDIO = {
  mode: 'speaker' as const,
  isMonitorMuted: false,
  isRealVoicePassthroughEnabled: true,
  realVoicePassthroughVolume: 0.3,
  selectedMonitorDevice: { deviceId: 'monitor-1', label: 'Headphones' },
  audioMonitorDevices: [
    { deviceId: 'monitor-1', label: 'Headphones' },
    { deviceId: 'cable-1', label: 'CABLE Input (VB-Audio Virtual Cable)', isVirtual: true },
  ],
};
const SWITCHES = { meeting: true, participantSpeech: false };

describe('readRouting', () => {
  it('maps the stores onto the route settings', () => {
    expect(readRouting(AUDIO, SWITCHES, 'electron')).toEqual({
      meeting: true,
      monitor: true,
      participantSpeech: false,
      passthrough: { on: true, ratio: 0.3 },
      sinks: { real: 'monitor-1', virtual: 'cable-1' },
    });
  });

  it('hears the monitor only in speaker mode, as today', () => {
    expect(readRouting({ ...AUDIO, mode: 'both' }, SWITCHES, 'electron').monitor).toBe(false);
    expect(readRouting({ ...AUDIO, mode: 'participant' }, SWITCHES, 'electron').monitor).toBe(false);
    expect(readRouting({ ...AUDIO, isMonitorMuted: true }, SWITCHES, 'electron').monitor).toBe(false);
  });

  it('looks for a virtual speaker device only in Electron', () => {
    expect(readRouting(AUDIO, SWITCHES, 'extension').sinks.virtual).toBeUndefined();
    expect(readRouting(AUDIO, SWITCHES, 'web').sinks.virtual).toBeUndefined();
    expect(readRouting({ ...AUDIO, audioMonitorDevices: [AUDIO.audioMonitorDevices[0]] }, SWITCHES, 'electron').sinks.virtual).toBeUndefined();
  });
});

describe('getAppAudio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('closes the context a failed build opened, and retries on the next call', async () => {
    // getAppAudio caches its build per module instance, so this test needs its
    // own fresh copy of the module rather than the one imported statically above.
    const closeSpy = vi.fn(async () => {});
    let constructed = 0;
    class FakeAudioContext {
      audioWorklet = { addModule: vi.fn(async () => { throw new Error('module not found'); }) };
      close = closeSpy;
      constructor() { constructed += 1; }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', class { srcObject: unknown = null; });
    vi.stubGlobal('AudioWorkletNode', class { constructor() {} });

    vi.resetModules();
    const { getAppAudio } = await import('./appAudio');

    await expect(getAppAudio()).rejects.toThrow();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(constructed).toBe(1);

    await expect(getAppAudio()).rejects.toThrow();
    expect(constructed).toBe(2);
  });
});

describe('createAppRouting', () => {
  beforeEach(() => {
    useAudioStore.setState(AUDIO);
    useRoutingStore.setState(SWITCHES);
  });

  it('reads the live stores, and tells its listener when either changes', () => {
    const routing = createAppRouting('electron');
    const heard = vi.fn();
    const off = routing.subscribe(heard);
    useRoutingStore.getState().setMeeting(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(routing.get().meeting).toBe(false);
    useAudioStore.setState({ isMonitorMuted: true });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(routing.get().monitor).toBe(false);
    off();
    useRoutingStore.getState().setMeeting(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
