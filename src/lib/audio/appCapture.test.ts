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
