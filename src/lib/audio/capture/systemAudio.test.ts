import { describe, it, expect, vi } from 'vitest';
import { TRACK_ENDED } from './core';
import {
  APP_CAPTURE_LOST, APP_MONITOR_MISSING, SILENT_NO_PERMISSION, openSystemAudio,
  type ParticipantCapture, type SystemAudioDeps, type SystemAudioSettings,
} from './systemAudio';

/** A participant recorder that records its calls; `push` delivers a chunk while it records. */
function fakeCapture(o: { begins?: boolean; stream?: MediaStream } = {}) {
  let callback: ((data: { mono: Int16Array }) => void) | null = null;
  const capture = {
    begun: [] as Array<{ deviceId?: string } | undefined>,
    ended: 0,
    onLost: null as (() => void) | null,
    onWarning: null as ((code: string) => void) | null,
    onAudioSeen: null as (() => void) | null,
    async begin(options?: { deviceId?: string }) {
      capture.begun.push(options);
      return o.begins ?? true;
    },
    async record(fn: (data: { mono: Int16Array }) => void) {
      callback = fn;
      return true;
    },
    async end() {
      capture.ended += 1;
      // A helper killed by its own teardown reports an exit; `onLost` must be detached by now.
      capture.onLost?.();
      callback = null;
    },
    getStream: () => o.stream ?? null,
    push: (pcm = new Int16Array(4)) => callback?.({ mono: pcm }),
  };
  return capture satisfies ParticipantCapture;
}

function setup(o: {
  answer?: unknown;
  devices?: Array<{ kind: string; label: string; deviceId: string }>;
  app?: ReturnType<typeof fakeCapture>;
  device?: ReturnType<typeof fakeCapture>;
  loopback?: ReturnType<typeof fakeCapture>;
  sourceId?: string;
} = {}) {
  const invoked: Array<[string, unknown]> = [];
  const answers: unknown[] = Array.isArray(o.answer) ? [...o.answer] : [o.answer ?? { success: true, capture: 'system' }];
  const app = o.app ?? fakeCapture();
  const device = o.device ?? fakeCapture();
  const loopback = o.loopback ?? fakeCapture();
  const wait = vi.fn(async () => {});
  const deps: SystemAudioDeps = {
    invoke: async (channel, data) => {
      invoked.push([channel, data]);
      return channel === 'connect-system-audio-source' ? (answers.length > 1 ? answers.shift() : answers[0]) : { success: true };
    },
    enumerateDevices: async () => (o.devices ?? []) as MediaDeviceInfo[],
    wait,
    app: () => app,
    device: () => device,
    loopback: () => loopback,
  };
  let current = { sourceId: o.sourceId ?? 'desktop-audio-loopback', muted: false };
  const listeners = new Set<() => void>();
  const audioSeen = vi.fn();
  const settings: SystemAudioSettings = {
    sourceId: () => current.sourceId,
    muted: () => current.muted,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    audioSeen,
  };
  const set = (patch: Partial<typeof current>) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
  };
  return { deps, settings, set, invoked, app, device, loopback, wait, audioSeen };
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const live = () => new AbortController().signal;

describe('openSystemAudio — opening', () => {
  it('records an application through the helper when the main process asks for it', async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const heard = vi.fn();
    source.onPcm(heard);
    s.app.push();
    expect(s.invoked[0]).toEqual(['connect-system-audio-source', 'app:42']);
    expect(s.app.begun).toEqual([{ deviceId: 'app:42' }]);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("records a PipeWire tap through its monitor device, found by label", async () => {
    const s = setup({
      sourceId: 'app:7',
      answer: { success: true, monitorLabel: 'Sokuji Capture' },
      devices: [{ kind: 'audioinput', label: 'Monitor of Sokuji Capture', deviceId: 'mon-1' }],
    });
    await openSystemAudio(s.settings, live(), s.deps);
    expect(s.device.begun).toEqual([{ deviceId: 'mon-1' }]);
  });

  it("widens to whole-system capture, visibly, when the tap's monitor never appears", async () => {
    const s = setup({ sourceId: 'app:7', answer: { success: true, monitorLabel: 'Sokuji Capture' } });
    const degraded = vi.fn();
    const source = await openSystemAudio(s.settings, live(), s.deps);
    // Raised while it opened, held by the core for the first listener (the leg's).
    source.onDegraded(degraded);
    expect(s.wait).toHaveBeenCalledTimes(10);
    expect(s.loopback.begun).toEqual([undefined]);
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: APP_MONITOR_MISSING }));
  });

  it('records the whole system through loopback otherwise', async () => {
    const s = setup();
    await openSystemAudio(s.settings, live(), s.deps);
    expect(s.loopback.begun).toEqual([undefined]);
  });

  it('rejects when the source will not connect', async () => {
    const s = setup({ answer: { success: false, error: 'helper missing' } });
    await expect(openSystemAudio(s.settings, live(), s.deps)).rejects.toThrow('helper missing');
    expect(s.invoked.map(([c]) => c)).toEqual(['connect-system-audio-source']);
  });

  it('rejects and disconnects when the recorder will not begin', async () => {
    const s = setup({ loopback: fakeCapture({ begins: false }) });
    await expect(openSystemAudio(s.settings, live(), s.deps)).rejects.toThrow();
    expect(s.invoked.map(([c]) => c)).toEqual(['connect-system-audio-source', 'disconnect-system-audio-source']);
  });

  it('stops what it opened when the run was cancelled while it opened', async () => {
    const s = setup();
    const cancel = new AbortController();
    cancel.abort(new Error('the run ended'));
    await expect(openSystemAudio(s.settings, cancel.signal, s.deps)).rejects.toThrow('the run ended');
    expect(s.loopback.ended).toBe(1);
    expect(s.invoked.map(([c]) => c)).toContain('disconnect-system-audio-source');
  });
});

describe('openSystemAudio — running', () => {
  it('falls back to whole-system capture, visibly, when the helper dies', async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    s.app.onLost?.();
    await settle();
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: APP_CAPTURE_LOST }));
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(s.app.ended).toBe(1);
    expect(s.loopback.begun).toEqual([undefined]);
  });

  it('ends when the fallback cannot start', async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' }, loopback: fakeCapture({ begins: false }) });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const ended = vi.fn();
    source.onEnded(ended);
    s.app.onLost?.();
    await settle();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("passes the helper's warning on as a coded degradation, and its first audible audio to the settings", async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    s.app.onWarning?.(SILENT_NO_PERMISSION);
    s.app.onAudioSeen?.();
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: SILENT_NO_PERMISSION }));
    expect(s.audioSeen).toHaveBeenCalledTimes(1);
  });

  it('ends when the captured track ends', async () => {
    const track = new EventTarget() as MediaStreamTrack;
    const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    const s = setup({ loopback: fakeCapture({ stream }) });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const ended = vi.fn();
    source.onEnded(ended);
    track.dispatchEvent(new Event('ended'));
    expect(ended).toHaveBeenCalledWith(TRACK_ENDED);
  });

  it('delivers nothing while muted', async () => {
    const s = setup();
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const heard = vi.fn();
    source.onPcm(heard);
    s.set({ muted: true });
    s.loopback.push();
    expect(heard).not.toHaveBeenCalled();
  });

  it('moves to a newly chosen source in place: stops, disconnects, connects and records again', async () => {
    const s = setup({ answer: [{ success: true, capture: 'system' }, { success: true, capture: 'app' }] });
    await openSystemAudio(s.settings, live(), s.deps);
    s.set({ sourceId: 'app:9' });
    await settle();
    expect(s.loopback.ended).toBe(1);
    expect(s.invoked.map(([c, d]) => `${c}:${d ?? ''}`)).toEqual([
      'connect-system-audio-source:desktop-audio-loopback',
      'disconnect-system-audio-source:',
      'connect-system-audio-source:app:9',
    ]);
    expect(s.app.begun).toEqual([{ deviceId: 'app:9' }]);
  });

  it('stops once: ends the recorder without reading its own teardown as a loss, then disconnects', async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    await source.stop();
    await source.stop();
    expect(s.app.ended).toBe(1);
    expect(degraded).not.toHaveBeenCalled();
    expect(s.loopback.begun).toEqual([]);
    expect(s.invoked.filter(([c]) => c === 'disconnect-system-audio-source')).toHaveLength(1);
  });
});
