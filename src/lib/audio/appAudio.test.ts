import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

const environment = vi.hoisted(() => ({ value: 'web' as 'web' | 'electron' | 'extension' }));
vi.mock('../../utils/environment', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../utils/environment')>()), getEnvironment: () => environment.value }));

import { SAMPLE_RATE } from '../contract/adapter';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_OUTLET_CHOICE } from './outlets';
import { createAppRouting, readRouting } from './appAudio';
import { routesFor } from './routes';
import { FakeAudioContext, FakeSink, FakeWorkletNode } from './fakeWebAudio';

const AUDIO = {
  isRealVoicePassthroughEnabled: true,
  realVoicePassthroughVolume: 0.3,
  selectedMonitorDevice: { deviceId: 'monitor-1', label: 'Headphones' },
  audioMonitorDevices: [
    { deviceId: 'monitor-1', label: 'Headphones' },
    { deviceId: 'usb-1', label: 'USB speakers' },
    { deviceId: 'cable-1', label: 'CABLE Input (VB-Audio Virtual Cable)', isVirtual: true },
  ],
  outlets: { other: { ...DEFAULT_OUTLET_CHOICE }, me: { ...DEFAULT_OUTLET_CHOICE }, them: { ...DEFAULT_OUTLET_CHOICE } },
};
const SPEAK = { other: true, me: true, them: false };

describe('readRouting', () => {
  it('maps the stores onto the route settings: every outlet follows the default device, centred', () => {
    expect(readRouting(AUDIO, SPEAK, true, 'electron', 'auto')).toEqual({
      meeting: true,
      faceToFace: false,
      speak: SPEAK,
      passthrough: { on: true, ratio: 0.3 },
      sinks: { virtual: 'cable-1', other: { device: 'monitor-1' }, me: { device: 'monitor-1' }, them: { device: 'monitor-1' } },
    });
  });

  it('gives an outlet its own device and channel, and follows the default for one that is not present', () => {
    const outlets = { ...AUDIO.outlets, them: { device: 'usb-1', channel: 'left' as const }, me: { device: 'usb-gone', channel: 'right' as const } };
    const { sinks } = readRouting({ ...AUDIO, outlets }, SPEAK, true, 'electron', 'auto');
    expect(sinks.them).toEqual({ device: 'usb-1', pan: -1 });
    expect(sinks.me).toEqual({ device: 'monitor-1', pan: 1 });
  });

  it('never routes an outlet to the virtual speaker, even when its stored device is that one', () => {
    const outlets = { ...AUDIO.outlets, them: { device: 'cable-1', channel: 'auto' as const } };
    const { sinks } = readRouting({ ...AUDIO, outlets }, SPEAK, true, 'electron', 'auto');
    expect(sinks.them).toEqual({ device: 'monitor-1' });
  });

  it('resolves auto channels per face-to-face: the other right, me left, centred in a meeting (Review Focus 2)', () => {
    const f2f = readRouting(AUDIO, SPEAK, true, 'electron', 'auto', true);
    expect(f2f.faceToFace).toBe(true);
    expect(f2f.sinks.other).toEqual({ device: 'monitor-1', pan: 1 });
    expect(f2f.sinks.them).toEqual({ device: 'monitor-1', pan: -1 });
    expect(f2f.sinks.me).toEqual({ device: 'monitor-1' });
    expect(readRouting(AUDIO, SPEAK, true, 'electron', 'auto', false).sinks.other).toEqual({ device: 'monitor-1' });
  });

  it('no default device: the outlets fall to the browser default', () => {
    expect(readRouting({ ...AUDIO, selectedMonitorDevice: null }, SPEAK, true, 'electron', 'auto').sinks.me).toEqual({});
  });

  it('looks for a virtual speaker device only in Electron', () => {
    expect(readRouting(AUDIO, SPEAK, true, 'extension', 'auto').sinks.virtual).toBeUndefined();
    expect(readRouting(AUDIO, SPEAK, true, 'web', 'auto').sinks.virtual).toBeUndefined();
    expect(readRouting({ ...AUDIO, audioMonitorDevices: [AUDIO.audioMonitorDevices[0]] }, SPEAK, true, 'electron', 'auto').sinks.virtual).toBeUndefined();
  });

  it('forces the original voice on at full level under push-to-translate, whatever the toggle says, open while idle (1e-3 ruling 4)', () => {
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SPEAK, true, 'electron', 'push-to-translate').passthrough)
      .toEqual({ on: true, ratio: 1, gate: 'idle' });
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SPEAK, true, 'electron', 'auto').passthrough)
      .toEqual({ on: false, ratio: 0.2 });
  });

  it('follows the toggle under push-to-talk, open only while the key is held, as 0.41.1 did', () => {
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: true, realVoicePassthroughVolume: 0.2 }, SPEAK, true, 'electron', 'push-to-talk').passthrough)
      .toEqual({ on: true, ratio: 0.2, gate: 'held' });
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SPEAK, true, 'electron', 'push-to-talk').passthrough)
      .toEqual({ on: false, ratio: 0.2, gate: 'held' });
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

  /**
   * A fresh `getAppAudio` over fake Web Audio, for the test tone: the live
   * contexts it opens, the offline contexts it decodes on, and the decode.
   * `fetched` is when the tone's asset arrives (at once unless a case holds it).
   */
  async function toneAudio(fetched: Promise<void> = Promise.resolve()) {
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
    vi.stubGlobal('fetch', vi.fn(async () => {
      await fetched;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    }));

    vi.resetModules();
    const { getAppAudio } = await import('./appAudio');
    return { audio: await getAppAudio(), live, offline, offlineDecode };
  }

  it('decodes the test tone on an offline context of its own, never on the live one (a rebuild may have closed it)', async () => {
    const { audio, live, offline, offlineDecode } = await toneAudio();
    const playing = audio.testTone();
    await vi.waitFor(() => expect(live[0].sources).toHaveLength(1));
    live[0].advance(1);
    await playing;

    expect(offline).toEqual([[1, 1, SAMPLE_RATE]]);
    expect(offlineDecode).toHaveBeenCalledTimes(1);
    expect(live[0].decodeAudioData).not.toHaveBeenCalled();
  });

  // A stop while the tone still decodes (the panel's second press): nothing may play once it has.
  it('plays nothing when the signal aborts before the tone has decoded', async () => {
    let arrive!: () => void;
    const { audio, live, offlineDecode } = await toneAudio(new Promise<void>((resolve) => { arrive = resolve; }));
    const press = new AbortController();
    let settled = false;
    void audio.testTone(press.signal).then(() => { settled = true; });
    press.abort();
    arrive();
    await vi.waitFor(() => expect(offlineDecode).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(live[0].sources).toHaveLength(0);
    // Settled at once: a preview would hold it until its clip ended.
    expect(settled).toBe(true);
  });

  it('plays the tone when the signal never aborts', async () => {
    const { audio, live } = await toneAudio();
    const playing = audio.testTone(new AbortController().signal);
    await vi.waitFor(() => expect(live[0].sources).toHaveLength(1));
    live[0].advance(1);
    await playing;
  });

  it('plays the ear preview on the outlet asked for', async () => {
    const { audio, live } = await toneAudio();
    const playing = audio.earPreview('them');
    await vi.waitFor(() => expect(live[0].sources).toHaveLength(1));
    live[0].advance(1);
    await playing;
  });
});

describe('createAppRouting', () => {
  beforeEach(() => {
    useAudioStore.setState(AUDIO);
    useRoutingStore.setState({ meeting: true });
    useTurnModeStore.setState({ turnMode: 'auto' });
    useSettingsStore.setState({ textOnly: false });
  });

  it('reads the live stores, and tells its listener when either changes', () => {
    const routing = createAppRouting('electron');
    const heard = vi.fn();
    const off = routing.subscribe(heard);
    useRoutingStore.getState().setMeeting(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(routing.get().meeting).toBe(false);
    useAudioStore.getState().setOutletChannel('them', 'right');
    expect(heard).toHaveBeenCalledTimes(2);
    expect(routing.get().sinks.them.pan).toBe(1);
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
    expect(routing.get().passthrough).toEqual({ on: true, ratio: 1, gate: 'idle' });
  });

  it("re-reads when the picked provider's entry loads after the pick: only then is beside me face-to-face", () => {
    useAudioStore.setState({ ...AUDIO, mode: 'both', otherSide: 'beside' });
    useProviderStore.setState({ selected: 'soniox', entries: {} });
    const routing = createAppRouting('electron');
    const heard = vi.fn();
    routing.subscribe(heard);
    expect(routing.get().faceToFace).toBe(false);
    useProviderStore.setState({ entries: { soniox: {} as never } });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(routing.get().faceToFace).toBe(true);
    // An edit to the loaded entry leaves face-to-face as it was: no re-read.
    useProviderStore.setState({ entries: { soniox: {} as never } });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("notifies when Translation the other side hears flips, and when the provider's speech flags land (Review Focus 5)", () => {
    const source = createAppRouting('electron');
    const listener = vi.fn();
    const off = source.subscribe(listener);
    useSettingsStore.setState({ textOnly: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.get().speak.other).toBe(false);
    useSettingsStore.setState({ textOnly: false });
    off();
  });

  it('a capture that widens to the whole system silences Translation I hear live, and clearing it restores the edge', () => {
    environment.value = 'electron';
    try {
      useAudioStore.setState({ ...AUDIO, mode: 'both', otherSide: 'meeting', selectedParticipantSource: { deviceId: 'app:42', label: 'App' }, participantCaptureWidened: false } as never);
      useRoutingStore.setState({ participantSpeech: true });
      const routing = createAppRouting('electron');
      const heard = vi.fn();
      const off = routing.subscribe(heard);
      expect(routing.get().speak.them).toBe(true);
      expect(routesFor(routing.get(), false)).toContainEqual({ from: 'participant', to: 'them', gain: 1 });
      useAudioStore.setState({ participantCaptureWidened: true });
      expect(heard).toHaveBeenCalledTimes(1);
      expect(routing.get().speak.them).toBe(false);
      expect(routesFor(routing.get(), false).some((e) => e.from === 'participant' && e.to === 'them')).toBe(false);
      useAudioStore.setState({ participantCaptureWidened: false });
      expect(heard).toHaveBeenCalledTimes(2);
      expect(routing.get().speak.them).toBe(true);
      expect(routesFor(routing.get(), false)).toContainEqual({ from: 'participant', to: 'them', gain: 1 });
      off();
    } finally {
      environment.value = 'web';
    }
  });
});
