import { afterEach, describe, it, expect, vi } from 'vitest';
import { MIC_LOST_USING_OTHER, MIC_LOST_WAITING, MIC_NOW_USING, openMic, type MicRecorder, type MicSettings, type NoiseSuppression } from './mic';
import { MicrophoneCaptureError } from '../../modern-audio/microphoneCaptureError';

/** A begin past this many is a runaway reopen loop: it throws, so a broken source cannot spin a test forever. */
const RUNAWAY_BEGINS = 50;

/**
 * A recorder that records its calls; `push` delivers a chunk while it records, `endTrack` unplugs its device.
 * `deadOnArrival(deviceId, n)`: the n-th begin hands out a track that has already ended.
 * `throwOn[n]`: the n-th begin throws that value.
 */
function fakeRecorder(o: { failBegins?: number[]; falseBegins?: number[]; deadOnArrival?: (deviceId: string | undefined, n: number) => boolean; throwOn?: Record<number, unknown> } = {}) {
  const calls: string[] = [];
  const track = Object.assign(new EventTarget(), { readyState: 'live' as MediaStreamTrackState, stop: vi.fn(() => calls.push('track.stop')) }) as unknown as MediaStreamTrack;
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
      if (begins > RUNAWAY_BEGINS) throw new Error('runaway: the source kept reopening');
      (track as { readyState: MediaStreamTrackState }).readyState = o.deadOnArrival?.(deviceId, begins) ? 'ended' : 'live';
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
      if (o.throwOn && begins in o.throwOn) {
        open = false;
        throw o.throwOn[begins];
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

function settingsFixture(initial: { deviceId?: string; noiseSuppression?: NoiseSuppression; muted?: boolean } = {}, options: { onUnusable?: (id: string) => void } = {}) {
  let current = { deviceId: 'mic-1' as string | undefined, noiseSuppression: 'off' as NoiseSuppression, muted: false, ...initial };
  const labels: Record<string, string> = { 'mic-1': 'Built-in Mic', 'mic-2': 'USB Mic', 'mic-3': 'Webcam Mic' };
  const listed = new Set(['mic-1', 'mic-2', 'mic-3']);
  const unusable: string[] = [];
  const listeners = new Set<() => void>();
  const settings: MicSettings = {
    deviceId: () => current.deviceId,
    deviceLabel: () => (current.deviceId === undefined ? undefined : labels[current.deviceId] ?? current.deviceId),
    isListed: (id) => listed.has(id),
    isUnusable: (id) => unusable.includes(id),
    markUnusable: (id) => {
      unusable.push(id);
      options.onUnusable?.(id);
    },
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
  const notify = () => { for (const listener of listeners) listener(); };
  return { settings, set, notify, listeners, listed, unusable };
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
    // No track leaves the source: every adapter takes the pcm (Stage 2 Palabra, ruling 16).
    expect(source).not.toHaveProperty('track');
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
    const degraded = vi.fn();
    source.onDegraded(degraded);
    set({ deviceId: 'mic-2' });
    await settle();
    fake.push();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'end', 'begin:mic-2', 'record']);
    expect(fake.calls).not.toContain('quit');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(degraded).not.toHaveBeenCalled();
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

describe('openMic — its device going away (#593)', () => {
  it('reopens the same device when its track ends and it opens again: no notice, no end', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const ended = vi.fn();
    const degraded = vi.fn();
    source.onEnded(ended);
    source.onDegraded(degraded);
    fake.endTrack();
    await settle();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'end', 'begin:mic-1', 'record']);
    expect(ended).not.toHaveBeenCalled();
    expect(degraded).not.toHaveBeenCalled();
  });

  it('moves to the device the store chooses next when the lost one will not reopen, and says which', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: (id) => { fixture.listed.delete(id); fixture.set({ deviceId: 'mic-2' }); } });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const ended = vi.fn();
    const degraded = vi.fn();
    source.onEnded(ended);
    source.onDegraded(degraded);
    fake.endTrack();
    await settle();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'end', 'begin:mic-1', 'begin:mic-2', 'record']);
    expect(fixture.unusable).toEqual(['mic-1']);
    expect(ended).not.toHaveBeenCalled();
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: MIC_LOST_USING_OTHER, severity: 'warning', params: { lost: 'Built-in Mic', device: 'USB Mic' }, lifetime: 'transient' }));
  });

  it('raises the same notice, once, when the store moves on before the track ends', async () => {
    const fake = fakeRecorder();
    const fixture = settingsFixture();
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    fixture.listed.delete('mic-1');
    fixture.set({ deviceId: 'mic-2' });
    fake.endTrack();
    await settle();
    expect(fake.calls.filter((c) => c.startsWith('begin:'))).toEqual(['begin:mic-1', 'begin:mic-2']);
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: MIC_LOST_USING_OTHER, params: { lost: 'Built-in Mic', device: 'USB Mic' } }));
  });

  it('names the device it actually opened, even when the store moved on while it was opening', async () => {
    const fake = fakeRecorder();
    const fixture = settingsFixture();
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    const release = fake.hangNextBegin();
    fixture.listed.delete('mic-1');
    fixture.set({ deviceId: 'mic-2' });
    await settle();
    // mic-2 is still opening when the store selects mic-3.
    fixture.set({ deviceId: 'mic-3' });
    release();
    await settle();
    expect(fake.calls.filter((c) => c.startsWith('begin:'))).toEqual(['begin:mic-1', 'begin:mic-2', 'begin:mic-3']);
    expect(degraded).toHaveBeenNthCalledWith(1, expect.objectContaining({ code: MIC_LOST_USING_OTHER, params: { lost: 'Built-in Mic', device: 'USB Mic' } }));
    expect(degraded).toHaveBeenNthCalledWith(2, expect.objectContaining({ code: MIC_NOW_USING, params: { device: 'Webcam Mic' } }));
  });

  it('waits without opening any device when none is left, keeps the run, and picks up the next one with a notice', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: (id) => { fixture.listed.delete(id); fixture.set({ deviceId: undefined }); } });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const ended = vi.fn();
    const degraded = vi.fn();
    source.onEnded(ended);
    source.onDegraded(degraded);
    fake.endTrack();
    await settle();
    expect(fake.calls).not.toContain('begin:default');
    expect(ended).not.toHaveBeenCalled();
    // Every device notice is transient: the surfaces hide it after a while (#481).
    expect(degraded).toHaveBeenLastCalledWith(expect.objectContaining({ code: MIC_LOST_WAITING, severity: 'warning', params: { lost: 'Built-in Mic' }, lifetime: 'transient' }));

    fixture.set({ deviceId: 'mic-3' });
    await settle();
    expect(fake.calls.slice(-2)).toEqual(['begin:mic-3', 'record']);
    expect(degraded).toHaveBeenLastCalledWith(expect.objectContaining({ code: MIC_NOW_USING, severity: 'info', params: { device: 'Webcam Mic' }, lifetime: 'transient' }));
    expect(degraded).toHaveBeenCalledTimes(2);
  });

  it('says "now using" once it leaves the fallback for the user\'s device coming back', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: (id) => { fixture.listed.delete(id); fixture.set({ deviceId: 'mic-2' }); } });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    fake.endTrack();
    await settle();
    fixture.listed.add('mic-1');
    fixture.set({ deviceId: 'mic-1' });
    await settle();
    expect(degraded).toHaveBeenLastCalledWith(expect.objectContaining({ code: MIC_NOW_USING, severity: 'info', params: { device: 'Built-in Mic' } }));
    // Back on the user's device: a later switch of theirs is a plain switch again.
    fixture.set({ deviceId: 'mic-3' });
    await settle();
    expect(degraded).toHaveBeenCalledTimes(2);
  });

  it('no longer ends the run when a switch fails: the device is marked unusable and the next one opens', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: () => fixture.set({ deviceId: 'mic-3' }) });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const ended = vi.fn();
    const degraded = vi.fn();
    source.onEnded(ended);
    source.onDegraded(degraded);
    fixture.set({ deviceId: 'gone' });
    await settle();
    expect(ended).not.toHaveBeenCalled();
    expect(fixture.unusable).toEqual(['gone']);
    expect(fake.calls.slice(-2)).toEqual(['begin:mic-3', 'record']);
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: MIC_LOST_USING_OTHER, params: { lost: 'gone', device: 'Webcam Mic' } }));
  });

  it('stays muted through a fallback', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({ muted: true }, { onUnusable: (id) => { fixture.listed.delete(id); fixture.set({ deviceId: 'mic-2' }); } });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const heard = vi.fn();
    source.onPcm(heard);
    fake.endTrack();
    await settle();
    fake.push();
    expect(heard).not.toHaveBeenCalled();
    fixture.set({ muted: false });
    await settle();
    fake.push();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('a stop during a loss leaves nothing open, marks nothing and says nothing more', async () => {
    // The reopen's begin is hung; stop while it is in flight, then let it fail.
    const fake2 = fakeRecorder({ failBegins: [2] });
    const fixture2 = settingsFixture({}, { onUnusable: () => fixture2.set({ deviceId: 'mic-2' }) });
    const source2 = await openMic(fixture2.settings, live(), () => fake2.recorder);
    const degraded2 = vi.fn();
    source2.onDegraded(degraded2);
    const release = fake2.hangNextBegin();
    fake2.endTrack();
    await settle();
    const stopping = source2.stop();
    release();
    await stopping;
    await settle();
    expect(fixture2.unusable).toEqual([]);
    expect(fake2.calls).not.toContain('begin:mic-2');
    expect(fake2.calls[fake2.calls.length - 1]).toBe('quit');
    expect(degraded2).not.toHaveBeenCalled();
  });

  it('does not open the failed device again while the store has yet to move off it', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const fixture = settingsFixture({}, { onUnusable: (id) => { fixture.listed.delete(id); fixture.notify(); setTimeout(() => fixture.set({ deviceId: 'mic-2' }), 0); } });
    const source = await openMic(fixture.settings, live(), () => fake.recorder);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    fake.endTrack();
    await settle();
    expect(fake.calls.filter((c) => c === 'begin:mic-1')).toHaveLength(2);
    expect(fixture.unusable).toEqual(['mic-1']);
    expect(fake.calls.slice(-2)).toEqual(['begin:mic-2', 'record']);
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: MIC_LOST_USING_OTHER }));
  });

  describe('a permission failure, which is not about the device', () => {
    const denied = (name: string) => new MicrophoneCaptureError(new DOMException('Permission denied', name));

    it('ends the source when a switch is refused the microphone, marking nothing and raising no notice', async () => {
      const fake = fakeRecorder({ throwOn: { 2: denied('NotAllowedError') } });
      const fixture = settingsFixture();
      const source = await openMic(fixture.settings, live(), () => fake.recorder);
      const ended = vi.fn();
      const degraded = vi.fn();
      source.onEnded(ended);
      source.onDegraded(degraded);
      fixture.set({ deviceId: 'mic-2' });
      await settle();
      expect(ended).toHaveBeenCalledTimes(1);
      expect(ended).toHaveBeenCalledWith(expect.stringContaining('NotAllowedError'));
      expect(fixture.unusable).toEqual([]);
      expect(degraded).not.toHaveBeenCalled();
    });

    // Older Chromium spells a revoked permission the legacy way;
    // describeMicrophoneFailure already treats it as NotAllowedError.
    it('treats the legacy PermissionDeniedError as a refusal too', async () => {
      const fake = fakeRecorder({ throwOn: { 2: denied('PermissionDeniedError') } });
      const fixture = settingsFixture();
      const source = await openMic(fixture.settings, live(), () => fake.recorder);
      const ended = vi.fn();
      source.onEnded(ended);
      fixture.set({ deviceId: 'mic-2' });
      await settle();
      expect(ended).toHaveBeenCalledWith(expect.stringContaining('PermissionDeniedError'));
      expect(fixture.unusable).toEqual([]);
    });

    it('ends the source when the reopen after a lost track is refused, marking nothing', async () => {
      const fake = fakeRecorder({ throwOn: { 2: denied('SecurityError') } });
      const fixture = settingsFixture();
      const source = await openMic(fixture.settings, live(), () => fake.recorder);
      const ended = vi.fn();
      const degraded = vi.fn();
      source.onEnded(ended);
      source.onDegraded(degraded);
      fake.endTrack();
      await settle();
      expect(ended).toHaveBeenCalledTimes(1);
      expect(ended).toHaveBeenCalledWith(expect.stringContaining('SecurityError'));
      expect(fixture.unusable).toEqual([]);
      expect(degraded).not.toHaveBeenCalled();
    });
  });

  describe('a device that keeps dropping', () => {
    afterEach(() => vi.useRealTimers());

    it('does not reopen a device whose track ends again within 5 s of its reopen: marked once, the store followed, one notice', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const fake = fakeRecorder();
      // Still listed: the OS keeps showing it, it only keeps dropping.
      const fixture = settingsFixture({}, { onUnusable: () => fixture.set({ deviceId: 'mic-2' }) });
      const source = await openMic(fixture.settings, live(), () => fake.recorder);
      const ended = vi.fn();
      const degraded = vi.fn();
      source.onEnded(ended);
      source.onDegraded(degraded);
      fake.endTrack();
      await settle();
      vi.setSystemTime(Date.now() + 4_999);
      fake.endTrack();
      await settle();
      expect(fake.calls.filter((c) => c === 'begin:mic-1')).toHaveLength(2);
      expect(fixture.unusable).toEqual(['mic-1']);
      expect(fake.calls.slice(-2)).toEqual(['begin:mic-2', 'record']);
      expect(ended).not.toHaveBeenCalled();
      expect(degraded).toHaveBeenCalledTimes(1);
      expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: MIC_LOST_USING_OTHER, params: { lost: 'Built-in Mic', device: 'USB Mic' } }));
    });

    it('reopens it again when its track ends more than 5 s after the reopen: a new blip, no notice', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const fake = fakeRecorder();
      const fixture = settingsFixture();
      const source = await openMic(fixture.settings, live(), () => fake.recorder);
      const ended = vi.fn();
      const degraded = vi.fn();
      source.onEnded(ended);
      source.onDegraded(degraded);
      fake.endTrack();
      await settle();
      vi.setSystemTime(Date.now() + 5_001);
      fake.endTrack();
      await settle();
      expect(fake.calls.filter((c) => c === 'begin:mic-1')).toHaveLength(3);
      expect(fake.calls.slice(-2)).toEqual(['begin:mic-1', 'record']);
      expect(fixture.unusable).toEqual([]);
      expect(ended).not.toHaveBeenCalled();
      expect(degraded).not.toHaveBeenCalled();
    });

    it('does not reopen a device whose reopened track had already ended when watched: marked, the store followed, no spin', async () => {
      // Every reopen of mic-1 hands out a dead track: unbounded, this spins until RUNAWAY_BEGINS.
      const fake = fakeRecorder({ deadOnArrival: (id, n) => id === 'mic-1' && n > 1 });
      const fixture = settingsFixture({}, { onUnusable: () => fixture.set({ deviceId: 'mic-2' }) });
      const source = await openMic(fixture.settings, live(), () => fake.recorder);
      const ended = vi.fn();
      const degraded = vi.fn();
      source.onEnded(ended);
      source.onDegraded(degraded);
      fake.endTrack();
      await settle();
      expect(fake.calls.filter((c) => c.startsWith('begin:'))).toEqual(['begin:mic-1', 'begin:mic-1', 'begin:mic-2']);
      expect(fixture.unusable).toEqual(['mic-1']);
      expect(fake.calls.slice(-2)).toEqual(['begin:mic-2', 'record']);
      expect(ended).not.toHaveBeenCalled();
      expect(degraded).toHaveBeenCalledTimes(1);
      expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: MIC_LOST_USING_OTHER, params: { lost: 'Built-in Mic', device: 'USB Mic' } }));
    });
  });

  it('refuses to start with no microphone selected, opening nothing', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture({ deviceId: undefined });
    await expect(openMic(settings, live(), () => fake.recorder)).rejects.toThrow(/no microphone/i);
    expect(fake.calls.filter((c) => c.startsWith('begin'))).toEqual([]);
  });
});
