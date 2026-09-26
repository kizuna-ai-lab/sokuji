import { describe, it, expect, vi } from 'vitest';
import { TRACK_ENDED } from './core';
import { openMic, type MicRecorder, type MicSettings, type NoiseSuppression } from './mic';

/** A recorder that records its calls; `push` delivers a chunk while it records, `endTrack` unplugs its device. */
function fakeRecorder(o: { failBegins?: number[]; falseBegins?: number[] } = {}) {
  const calls: string[] = [];
  const track = Object.assign(new EventTarget(), { stop: vi.fn(() => calls.push('track.stop')) }) as unknown as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  let begins = 0;
  let open = false;
  let chunk: ((data: { mono: Int16Array }) => void) | null = null;
  /** Set by `hangNextBegin`: the next `begin()` awaits this before it resolves. */
  let hang: Promise<void> | null = null;
  const recorder: MicRecorder = {
    async begin(deviceId) {
      begins += 1;
      calls.push(`begin:${deviceId ?? 'default'}`);
      // The stream is live as soon as the device is acquired, before the rest of
      // `begin()`'s setup finishes (`ModernAudioRecorder.begin` assigns `this.stream`
      // from its first await, `getUserMedia`, well before it resolves).
      open = true;
      if (hang) {
        const pending = hang;
        hang = null;
        await pending;
      }
      if (o.failBegins?.includes(begins)) {
        open = false;
        throw new Error('The selected microphone is no longer available (NotFoundError).');
      }
      if (o.falseBegins?.includes(begins)) {
        open = false;
        return false;
      }
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
    async quit() {
      calls.push('quit');
      open = false;
      chunk = null;
      return true;
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
    /** The next `begin()` call awaits a deferred; returns the function that resolves it. */
    hangNextBegin: () => {
      let resolve!: () => void;
      hang = new Promise<void>((r) => { resolve = r; });
      return resolve;
    },
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

  it("rejects with the recorder's message when the device will not open, and disposes the recorder it built rather than just ending it", async () => {
    const fake = fakeRecorder({ failBegins: [1] });
    const { settings, listeners } = settingsFixture();
    await expect(openMic(settings, live(), () => fake.recorder)).rejects.toThrow('no longer available');
    expect(fake.calls).toContain('quit');
    expect(fake.calls).not.toContain('end');
    expect(listeners.size).toBe(0);
  });

  it("throws a readable error when begin returns false, instead of recording a device that never opened", async () => {
    const fake = fakeRecorder({ falseBegins: [1] });
    const { settings } = settingsFixture();
    await expect(openMic(settings, live(), () => fake.recorder)).rejects.toThrow(/could not/i);
    expect(fake.calls).not.toContain('record');
  });

  it('stops what it opened when the run was cancelled while it opened', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture();
    const cancel = new AbortController();
    cancel.abort(new Error('the run ended'));
    await expect(openMic(settings, cancel.signal, () => fake.recorder)).rejects.toThrow('the run ended');
    expect(fake.calls).toContain('quit');
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

  it('moves to a newly selected device in place, keeping its listeners, by ending it (not quitting) so the recorder is reused', async () => {
    const fake = fakeRecorder();
    const { settings, set } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const heard = vi.fn();
    source.onPcm(heard);
    set({ deviceId: 'mic-2' });
    await settle();
    fake.push();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'end', 'begin:mic-2', 'record']);
    expect(fake.calls).not.toContain('quit');
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

  it('stops once: disposes the recorder (quit, not end) and follows the settings no more', async () => {
    const fake = fakeRecorder();
    const { settings, set, listeners } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    await source.stop();
    await source.stop();
    set({ deviceId: 'mic-3' });
    await settle();
    expect(fake.calls.filter((c) => c === 'quit')).toHaveLength(1);
    expect(fake.calls).not.toContain('end');
    expect(fake.calls).not.toContain('begin:mic-3');
    expect(listeners.size).toBe(0);
  });

  it("stops the microphone's track before a switch in flight settles", async () => {
    const fake = fakeRecorder();
    const { settings, set } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const resolveBegin = fake.hangNextBegin();
    set({ deviceId: 'mic-2' });
    await settle();
    const stopping = source.stop();
    // Synchronously: `stop()` has not awaited anything yet, but the track is
    // already released, so a `pagehide` that never awaits it still works.
    expect(fake.track.stop).toHaveBeenCalledTimes(1);
    resolveBegin();
    await stopping;
    expect(fake.calls[fake.calls.length - 1]).toBe('quit');
  });

  it('stops the track before disposing the recorder on a plain stop too', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    await source.stop();
    expect(fake.calls).toContain('track.stop');
    expect(fake.calls.indexOf('track.stop')).toBeLessThan(fake.calls.indexOf('quit'));
  });
});
