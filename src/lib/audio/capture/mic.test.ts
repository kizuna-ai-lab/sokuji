import { describe, it, expect, vi } from 'vitest';
import { TRACK_ENDED } from './core';
import { openMic, type MicRecorder, type MicSettings, type NoiseSuppression } from './mic';

/** A recorder that records its calls; `push` delivers a chunk while it records, `endTrack` unplugs its device. */
function fakeRecorder(o: { failBegins?: number[] } = {}) {
  const track = new EventTarget() as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const calls: string[] = [];
  let begins = 0;
  let open = false;
  let chunk: ((data: { mono: Int16Array }) => void) | null = null;
  const recorder: MicRecorder = {
    async begin(deviceId) {
      begins += 1;
      calls.push(`begin:${deviceId ?? 'default'}`);
      if (o.failBegins?.includes(begins)) throw new Error('The selected microphone is no longer available (NotFoundError).');
      open = true;
      return true;
    },
    async record(fn) {
      calls.push('record');
      chunk = fn;
      return true;
    },
    async end() {
      calls.push('end');
      open = false;
      chunk = null;
      return {};
    },
    async setNoiseSuppressionMode(mode) {
      calls.push(`ns:${mode}`);
    },
    getStream: () => (open ? stream : null),
  };
  return {
    recorder,
    calls,
    track,
    push: (pcm = new Int16Array(4)) => chunk?.({ mono: pcm }),
    endTrack: () => track.dispatchEvent(new Event('ended')),
  };
}

function settingsFixture(initial: { deviceId?: string; noiseSuppression?: NoiseSuppression; muted?: boolean } = {}) {
  let current = { deviceId: 'mic-1' as string | undefined, noiseSuppression: 'off' as NoiseSuppression, muted: false, ...initial };
  const listeners = new Set<() => void>();
  const settings: MicSettings = {
    deviceId: () => current.deviceId,
    noiseSuppression: () => current.noiseSuppression,
    muted: () => current.muted,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const set = (patch: Partial<typeof current>) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
  };
  return { settings, set, listeners };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const live = () => new AbortController().signal;

describe('openMic', () => {
  it('opens the selected device with its noise suppression, and delivers its chunks', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture({ noiseSuppression: 'standard' });
    const source = await openMic(settings, live(), () => fake.recorder);
    const heard = vi.fn();
    source.onPcm(heard);
    fake.push();
    expect(fake.calls).toEqual(['ns:standard', 'begin:mic-1', 'record']);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(source.track).toBe(fake.track);
  });

  it("rejects with the recorder's message when the device will not open, and releases nothing", async () => {
    const fake = fakeRecorder({ failBegins: [1] });
    const { settings, listeners } = settingsFixture();
    await expect(openMic(settings, live(), () => fake.recorder)).rejects.toThrow('no longer available');
    expect(fake.calls).not.toContain('end');
    expect(listeners.size).toBe(0);
  });

  it('stops what it opened when the run was cancelled while it opened', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture();
    const cancel = new AbortController();
    cancel.abort(new Error('the run ended'));
    await expect(openMic(settings, cancel.signal, () => fake.recorder)).rejects.toThrow('the run ended');
    expect(fake.calls).toContain('end');
  });

  it('delivers nothing while muted, at once', async () => {
    const fake = fakeRecorder();
    const { settings, set } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const heard = vi.fn();
    source.onPcm(heard);
    set({ muted: true });
    fake.push();
    set({ muted: false });
    fake.push();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('applies a noise-suppression change to the running recorder, without reopening it', async () => {
    const fake = fakeRecorder();
    const { settings, set } = settingsFixture();
    await openMic(settings, live(), () => fake.recorder);
    set({ noiseSuppression: 'enhanced' });
    await settle();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'ns:enhanced']);
  });

  it('moves to a newly selected device in place, keeping its listeners', async () => {
    const fake = fakeRecorder();
    const { settings, set } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const heard = vi.fn();
    source.onPcm(heard);
    set({ deviceId: 'mic-2' });
    await settle();
    fake.push();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'end', 'begin:mic-2', 'record']);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('ends with the reason when a device switch fails', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const { settings, set } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const ended = vi.fn();
    source.onEnded(ended);
    set({ deviceId: 'gone' });
    await settle();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(String(ended.mock.calls[0][0])).toContain('no longer available');
  });

  it('ends when its device goes away', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const ended = vi.fn();
    source.onEnded(ended);
    fake.endTrack();
    expect(ended).toHaveBeenCalledWith(TRACK_ENDED);
  });

  it('stops once: ends the recorder and follows the settings no more', async () => {
    const fake = fakeRecorder();
    const { settings, set, listeners } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    await source.stop();
    await source.stop();
    set({ deviceId: 'mic-3' });
    await settle();
    expect(fake.calls.filter((c) => c === 'end')).toHaveLength(1);
    expect(fake.calls).not.toContain('begin:mic-3');
    expect(listeners.size).toBe(0);
  });
});
