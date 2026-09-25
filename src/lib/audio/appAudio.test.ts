import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { SAMPLE_RATE } from '../contract/adapter';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { createAppRouting, readRouting } from './appAudio';
import { FakeAudioContext, FakeSink, FakeWorkletNode } from './fakeWebAudio';

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
    expect(readRouting(AUDIO, SWITCHES, 'electron', 'auto')).toEqual({
      meeting: true,
      monitor: true,
      participantSpeech: false,
      passthrough: { on: true, ratio: 0.3 },
      sinks: { real: 'monitor-1', virtual: 'cable-1' },
    });
  });

  it('hears the monitor only in speaker mode, as today', () => {
    expect(readRouting({ ...AUDIO, mode: 'both' }, SWITCHES, 'electron', 'auto').monitor).toBe(false);
    expect(readRouting({ ...AUDIO, mode: 'participant' }, SWITCHES, 'electron', 'auto').monitor).toBe(false);
    expect(readRouting({ ...AUDIO, isMonitorMuted: true }, SWITCHES, 'electron', 'auto').monitor).toBe(false);
  });

  it('looks for a virtual speaker device only in Electron', () => {
    expect(readRouting(AUDIO, SWITCHES, 'extension', 'auto').sinks.virtual).toBeUndefined();
    expect(readRouting(AUDIO, SWITCHES, 'web', 'auto').sinks.virtual).toBeUndefined();
    expect(readRouting({ ...AUDIO, audioMonitorDevices: [AUDIO.audioMonitorDevices[0]] }, SWITCHES, 'electron', 'auto').sinks.virtual).toBeUndefined();
  });

  it('forces the original voice on at full level under push-to-translate, whatever the toggle says (1e-3 ruling 4)', () => {
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SWITCHES, 'electron', 'push-to-translate').passthrough)
      .toEqual({ on: true, ratio: 1 });
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SWITCHES, 'electron', 'auto').passthrough)
      .toEqual({ on: false, ratio: 0.2 });
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SWITCHES, 'electron', 'push-to-talk').passthrough)
      .toEqual({ on: false, ratio: 0.2 });
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

  it('decodes the test tone on an offline context of its own, never on the live one (a rebuild may have closed it)', async () => {
    const decoded = async () => ({
      length: 4, numberOfChannels: 1, sampleRate: SAMPLE_RATE, getChannelData: () => new Float32Array(4).fill(0.5),
    });
    const live: LiveContext[] = [];
    class LiveContext extends FakeAudioContext {
      audioWorklet = { addModule: vi.fn(async () => {}) };
      decodeAudioData = vi.fn(decoded);
      constructor() {
        super();
        live.push(this);
      }
    }
    const offline: unknown[][] = [];
    const offlineDecode = vi.fn(decoded);
    class OfflineContext {
      decodeAudioData = offlineDecode;
      constructor(...args: unknown[]) { offline.push(args); }
    }
    vi.stubGlobal('AudioContext', LiveContext);
    vi.stubGlobal('OfflineAudioContext', OfflineContext);
    vi.stubGlobal('Audio', class extends FakeSink { constructor() { super(null); } });
    vi.stubGlobal('AudioWorkletNode', class {
      constructor(_ctx: unknown, name: string, options: { processorOptions: { chunk: number } }) {
        return new FakeWorkletNode(name, options.processorOptions.chunk);
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));

    vi.resetModules();
    const { getAppAudio } = await import('./appAudio');
    const audio = await getAppAudio();
    const playing = audio.testTone();
    await vi.waitFor(() => expect(live[0].sources).toHaveLength(1));
    live[0].advance(1);
    await playing;

    expect(offline).toEqual([[1, 1, SAMPLE_RATE]]);
    expect(offlineDecode).toHaveBeenCalledTimes(1);
    expect(live[0].decodeAudioData).not.toHaveBeenCalled();
  });
});

describe('createAppRouting', () => {
  beforeEach(() => {
    useAudioStore.setState(AUDIO);
    useRoutingStore.setState(SWITCHES);
    useTurnModeStore.setState({ turnMode: 'auto' });
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

  it('tells its listener when the turn mode changes, and switches the passthrough on (ruling 4)', () => {
    const routing = createAppRouting('electron');
    const heard = vi.fn();
    routing.subscribe(heard);
    useTurnModeStore.getState().setTurnMode('push-to-translate');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(routing.get().passthrough).toEqual({ on: true, ratio: 1 });
  });
});
