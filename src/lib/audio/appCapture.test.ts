import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

const opened = vi.hoisted(() => ({ calls: [] as string[], sources: [] as FakeSource[] }));
vi.mock('./capture/mic', () => ({ openMic: vi.fn(async () => { opened.calls.push('mic'); return opened.sources[opened.sources.length - 1]; }) }));
vi.mock('./capture/systemAudio', () => ({ openSystemAudio: vi.fn(async () => { opened.calls.push('system'); return opened.sources[opened.sources.length - 1]; }) }));
vi.mock('./capture/tab', () => ({ openTab: vi.fn(async () => { opened.calls.push('tab'); return opened.sources[opened.sources.length - 1]; }) }));

const watch = vi.hoisted(() => ({ attached: [] as string[], detached: [] as string[] }));
vi.mock('./capture/echoWatch', () => ({
  createEchoWatch: () => ({
    attach: (leg: string) => { watch.attached.push(leg); return () => { watch.detached.push(leg); }; },
    onNotice: () => {},
    setDiagnostics: () => {},
  }),
}));

import useAudioStore from '../../stores/audioStore';
import { createAppCapture, micSettings, systemAudioSettings } from './appCapture';
import { LEVEL_BARS } from './levelMeter';
import type { Playback } from './playback';

function fakePlayback() {
  return { passthrough: vi.fn(), ttsTap: { read: () => new Float32Array(0) } } as unknown as Playback & { passthrough: ReturnType<typeof vi.fn> };
}

const clock = createVirtualClock(0);
const live = () => new AbortController().signal;

beforeEach(() => {
  opened.calls = [];
  opened.sources = [createFakeSource(clock, { voiced: true })];
  watch.attached = [];
  watch.detached = [];
});

describe('createAppCapture', () => {
  it('opens the microphone for the speaker and feeds its chunks to passthrough', async () => {
    const playback = fakePlayback();
    const capture = createAppCapture(playback, 'electron');
    await capture.openSource('speaker', live());
    clock.advance(100);
    expect(opened.calls).toEqual(['mic']);
    expect(playback.passthrough).toHaveBeenCalledTimes(1);
    expect(watch.attached).toEqual(['speaker']);
  });

  it("opens the system audio for the participant in Electron and the tab in the extension, and never passes it through", async () => {
    const playback = fakePlayback();
    await createAppCapture(playback, 'electron').openSource('participant', live());
    await createAppCapture(playback, 'extension').openSource('participant', live());
    clock.advance(100);
    expect(opened.calls).toEqual(['system', 'tab']);
    expect(playback.passthrough).not.toHaveBeenCalled();
    expect(watch.attached).toEqual(['participant', 'participant']);
  });

  it('refuses a participant source in the web build', async () => {
    await expect(createAppCapture(fakePlayback(), 'web').openSource('participant', live())).rejects.toThrow('no participant source');
  });

  it('detaches passthrough and the echo watch before it stops the capture', async () => {
    const playback = fakePlayback();
    const source = await createAppCapture(playback, 'electron').openSource('speaker', live());
    await source.stop();
    await source.stop();
    clock.advance(300);
    expect(watch.detached).toEqual(['speaker']);
    expect(opened.sources[0].stopped).toBe(true);
    expect(playback.passthrough).not.toHaveBeenCalled();
  });
});

describe('createAppCapture — levels', () => {
  it('has a level meter for each leg', () => {
    const capture = createAppCapture(fakePlayback(), 'electron');
    expect(capture.levels.speaker).toBeDefined();
    expect(capture.levels.participant).toBeDefined();
  });

  // The meter runs on the real clock, which barely moves between the latest
  // chunk landing and the read: the playhead sits at that chunk's start, so
  // the window is the chunk before it. Two chunks, then, for a window of the
  // fake source's tone.
  it("moves the leg's level meter as its source delivers chunks", async () => {
    const capture = createAppCapture(fakePlayback(), 'electron');
    await capture.openSource('speaker', live());
    clock.advance(200);
    expect([...capture.levels.speaker.read()].some((v) => v > 0)).toBe(true);
  });

  it('resets the level meter once the source stops', async () => {
    const capture = createAppCapture(fakePlayback(), 'electron');
    const source = await capture.openSource('speaker', live());
    clock.advance(200);
    expect([...capture.levels.speaker.read()].some((v) => v > 0)).toBe(true);
    await source.stop();
    expect([...capture.levels.speaker.read()]).toEqual(new Array(LEVEL_BARS).fill(0));
  });
});

describe('createAppCapture — the meter gate', () => {
  const flat = (levels: Float32Array) => [...levels].every((v) => v === 0);

  it("keeps a leg's meter flat while its gate is shut, and the other leg's moving", async () => {
    const capture = createAppCapture(fakePlayback(), 'electron', { meterGate: (leg) => leg !== 'speaker' });
    await capture.openSource('speaker', live());
    opened.sources.push(createFakeSource(clock, { voiced: true }));
    await capture.openSource('participant', live());
    clock.advance(200);
    expect(flat(capture.levels.speaker.read())).toBe(true);
    expect(flat(capture.levels.participant.read())).toBe(false);
  });

  // The meter's own staleness would keep the bars up for 300 ms of the real
  // clock, which barely moves here: flat at once means the gate reset it.
  it('flattens the meter at the first chunk after its gate shuts, and moves it again once the gate opens', async () => {
    let open = true;
    const capture = createAppCapture(fakePlayback(), 'electron', { meterGate: () => open });
    await capture.openSource('speaker', live());
    clock.advance(200);
    expect(flat(capture.levels.speaker.read())).toBe(false);
    open = false;
    clock.advance(100);
    expect(flat(capture.levels.speaker.read())).toBe(true);
    open = true;
    clock.advance(200);
    expect(flat(capture.levels.speaker.read())).toBe(false);
  });

  it('still passes a gated chunk through to playback', async () => {
    const playback = fakePlayback();
    const capture = createAppCapture(playback, 'electron', { meterGate: () => false });
    await capture.openSource('speaker', live());
    clock.advance(100);
    expect(playback.passthrough).toHaveBeenCalledTimes(1);
  });
});

describe('the settings the sources follow', () => {
  it("reads the microphone's device, noise suppression and mute from the audio store, live", () => {
    const settings = micSettings();
    useAudioStore.setState({ selectedInputDevice: { deviceId: 'mic-1', label: 'Mic' }, noiseSuppressionMode: 'standard', isMicMuted: false });
    expect([settings.deviceId(), settings.noiseSuppression(), settings.muted()]).toEqual(['mic-1', 'standard', false]);
    useAudioStore.setState({ isMicMuted: true });
    expect(settings.muted()).toBe(true);
  });

  it('reads the participant source, whole-system when none is chosen, and remembers audible audio', () => {
    const settings = systemAudioSettings();
    useAudioStore.setState({ selectedParticipantSource: null, participantTapAudioSeen: false });
    expect(settings.sourceId()).toBe('desktop-audio-loopback');
    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'app:42', label: 'Zoom' } });
    expect(settings.sourceId()).toBe('app:42');
    settings.audioSeen();
    expect(useAudioStore.getState().participantTapAudioSeen).toBe(true);
  });

  it('tells the sources when the audio store changes', () => {
    const listener = vi.fn();
    const off = micSettings().subscribe(listener);
    useAudioStore.setState({ isMicMuted: false });
    off();
    useAudioStore.setState({ isMicMuted: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
