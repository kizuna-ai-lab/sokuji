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
import { useProviderStore } from '../../stores/providerStore';
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
  selectedParticipantSource: null as { deviceId: string; label: string } | null,
};
const SWITCHES = { meeting: true, participantSpeech: false, faceToFaceSwap: false };

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

  it('forces the original voice on at full level under push-to-translate, whatever the toggle says, open while idle (1e-3 ruling 4)', () => {
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SWITCHES, 'electron', 'push-to-translate').passthrough)
      .toEqual({ on: true, ratio: 1, gate: 'idle' });
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SWITCHES, 'electron', 'auto').passthrough)
      .toEqual({ on: false, ratio: 0.2 });
  });

  it('follows the toggle under push-to-talk, open only while the key is held, as 0.41.1 did', () => {
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: true, realVoicePassthroughVolume: 0.2 }, SWITCHES, 'electron', 'push-to-talk').passthrough)
      .toEqual({ on: true, ratio: 0.2, gate: 'held' });
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SWITCHES, 'electron', 'push-to-talk').passthrough)
      .toEqual({ on: false, ratio: 0.2, gate: 'held' });
  });

  // 1e-3b-2 ruling 7: a whole-system participant capture on Electron would
  // recapture Other's own translation played on the real device and
  // translate it again as Other, so the switch's "on" is honoured only while
  // the chosen source is one application.
  it("blocks participant speech on Electron under a whole-system participant capture, on or with nothing selected", () => {
    const withSwitch = { meeting: true, participantSpeech: true, faceToFaceSwap: false };
    expect(readRouting({ ...AUDIO, selectedParticipantSource: null }, withSwitch, 'electron', 'auto').participantSpeech).toBe(false);
    expect(readRouting({ ...AUDIO, selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' } }, withSwitch, 'electron', 'auto').participantSpeech).toBe(false);
  });

  it('allows participant speech on Electron once an application source is chosen', () => {
    const withSwitch = { meeting: true, participantSpeech: true, faceToFaceSwap: false };
    expect(readRouting({ ...AUDIO, selectedParticipantSource: { deviceId: 'app:42', label: 'App' } }, withSwitch, 'electron', 'auto').participantSpeech).toBe(true);
  });

  it('is unaffected by the participant source outside Electron', () => {
    const withSwitch = { meeting: true, participantSpeech: true, faceToFaceSwap: false };
    expect(readRouting({ ...AUDIO, selectedParticipantSource: null }, withSwitch, 'extension', 'auto').participantSpeech).toBe(true);
    expect(readRouting({ ...AUDIO, selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' } }, withSwitch, 'web', 'auto').participantSpeech).toBe(true);
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
    expect(routing.get().passthrough).toEqual({ on: true, ratio: 1, gate: 'idle' });
  });

  it("re-reads when the picked provider's entry loads after the pick: only then is beside me face-to-face", () => {
    useAudioStore.setState({ ...AUDIO, mode: 'both', otherSide: 'beside' });
    useProviderStore.setState({ selected: 'soniox', entries: {} });
    const routing = createAppRouting('electron');
    const heard = vi.fn();
    routing.subscribe(heard);
    expect(routing.get().ears).toBeUndefined();
    useProviderStore.setState({ entries: { soniox: {} as never } });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(routing.get().ears).toEqual({ swap: false });
    // An edit to the loaded entry leaves face-to-face as it was: no re-read.
    useProviderStore.setState({ entries: { soniox: {} as never } });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('routes participant speech to the real device in face-to-face on Electron with a whole-system source', () => {
    const withSwitch = { meeting: true, participantSpeech: true, faceToFaceSwap: false };
    const whole = { ...AUDIO, selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' } };
    expect(readRouting(whole, withSwitch, 'electron', 'auto', true).participantSpeech).toBe(true);
    expect(readRouting(whole, withSwitch, 'electron', 'auto', false).participantSpeech).toBe(false);
  });
});

describe('readRouting — face-to-face', () => {
  it('asks for the ears, voices the participant whatever the system-capture rule says, and keeps the swap', () => {
    const r = readRouting({ ...AUDIO, mode: 'both' }, { meeting: true, participantSpeech: false, faceToFaceSwap: true }, 'electron', 'auto', true);
    expect(r.ears).toEqual({ swap: true });
    expect(r.participantSpeech).toBe(true);
  });

  it('asks for no ears outside face-to-face', () => {
    expect(readRouting(AUDIO, { meeting: true, participantSpeech: false, faceToFaceSwap: false }, 'electron', 'auto').ears).toBeUndefined();
  });
});
