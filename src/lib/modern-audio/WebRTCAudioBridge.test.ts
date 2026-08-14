import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebRTCAudioBridge } from './WebRTCAudioBridge';

/**
 * jsdom has no Web Audio, so stand up a minimal fake — same idiom as
 * AppAudioRecorder.test.ts's `(globalThis as any).AudioContext = class {...}`.
 */
class FakeAudioContext {
  state: AudioContextState;
  sampleRate: number;
  resumeCalls = 0;

  constructor(opts?: { sampleRate?: number }, initialState: AudioContextState = 'running') {
    this.sampleRate = opts?.sampleRate ?? 24000;
    this.state = initialState;
  }
  createMediaStreamSource(_stream: MediaStream) {
    return { connect: () => {}, disconnect: () => {} };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 128,
      connect: () => {},
      disconnect: () => {},
      getFloatFrequencyData: (arr: Float32Array) => arr.fill(-50),
    };
  }
  resume() {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

const getUserMedia = vi.fn();

beforeEach(() => {
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue(fakeStream());
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
});

const fakeStream = () => ({
  getTracks: () => [{ stop: () => {} }],
  getAudioTracks: () => [{ stop: () => {} }],
}) as unknown as MediaStream;

describe('WebRTCAudioBridge local analyser lifecycle', () => {
  it('survives cleanupRemoteAudio: the local context is dedicated, not the shared remote one', async () => {
    (globalThis as any).AudioContext = FakeAudioContext;
    try {
      const bridge = new WebRTCAudioBridge({ sampleRate: 24000 });

      // Remote audio starts first, exactly the sequence CodeRabbit flagged:
      // switchInputDevice (local setup) running after remote audio started.
      await (bridge as any).setupAudioProcessing(fakeStream());
      const remoteCtx = (bridge as any).audioContext as FakeAudioContext;
      expect(remoteCtx).toBeInstanceOf(FakeAudioContext);

      // Local device is then set up while the remote context is still open.
      await bridge.getLocalStream('mic-1');
      const localCtx = (bridge as any).localAudioContext as FakeAudioContext;
      expect(localCtx).toBeInstanceOf(FakeAudioContext);
      expect(localCtx).not.toBe(remoteCtx);
      expect(bridge.getLocalFrequencies()).not.toBeNull();

      // A later handleRemoteStream (or any remote teardown) must not take the
      // local analyser down with it.
      (bridge as any).cleanupRemoteAudio();

      expect(remoteCtx.state).toBe('closed');
      expect(localCtx.state).not.toBe('closed');
      expect(bridge.getLocalFrequencies()).not.toBeNull();
    } finally {
      delete (globalThis as any).AudioContext;
    }
  });

  it('resumes a dedicated context that starts suspended under autoplay policy', async () => {
    class SuspendedAudioContext extends FakeAudioContext {
      constructor(opts?: { sampleRate?: number }) {
        super(opts, 'suspended');
      }
    }
    (globalThis as any).AudioContext = SuspendedAudioContext;
    try {
      const bridge = new WebRTCAudioBridge({ sampleRate: 24000 });

      await bridge.getLocalStream('mic-1');

      const localCtx = (bridge as any).localAudioContext as FakeAudioContext;
      expect(localCtx.resumeCalls).toBeGreaterThanOrEqual(1);
      expect(localCtx.state).toBe('running');
    } finally {
      delete (globalThis as any).AudioContext;
    }
  });

  it('getLocalFrequencies retries resume() if the context is still suspended', async () => {
    (globalThis as any).AudioContext = FakeAudioContext;
    try {
      const bridge = new WebRTCAudioBridge({ sampleRate: 24000 });
      await bridge.getLocalStream('mic-1');

      const localCtx = (bridge as any).localAudioContext as FakeAudioContext;
      // Simulate the context falling back to suspended after setup (e.g. tab
      // backgrounding), independent of whatever resumed it during setup.
      localCtx.state = 'suspended';
      localCtx.resumeCalls = 0;

      const result = bridge.getLocalFrequencies();

      expect(localCtx.resumeCalls).toBe(1);
      expect(result).not.toBeNull();
    } finally {
      delete (globalThis as any).AudioContext;
    }
  });

  it('warns once per bridge instance when the backstop resume() rejects, without leaking an unhandled rejection', async () => {
    (globalThis as any).AudioContext = FakeAudioContext;
    try {
      const bridge = new WebRTCAudioBridge({ sampleRate: 24000 });
      await bridge.getLocalStream('mic-1');

      const localCtx = (bridge as any).localAudioContext as FakeAudioContext;
      // Stays suspended across both calls: resume() keeps rejecting instead of
      // flipping state to 'running', so getLocalFrequencies() retries it twice.
      localCtx.state = 'suspended';
      localCtx.resume = () => Promise.reject(new Error('resume failed'));

      const warns: string[] = [];
      const spy = vi.spyOn(console, 'warn').mockImplementation((m: any) => { warns.push(String(m)); });

      const result1 = bridge.getLocalFrequencies();
      const result2 = bridge.getLocalFrequencies();
      // Flush microtasks so the rejected resume() promises settle here — if
      // they weren't caught, vitest would surface them as unhandled rejections.
      await Promise.resolve();
      await Promise.resolve();

      spy.mockRestore();

      // Fallback (flat) analyser data must still come back both times.
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(warns.filter((w) => w.includes('Failed to resume local audio context'))).toHaveLength(1);
    } finally {
      delete (globalThis as any).AudioContext;
    }
  });
});
