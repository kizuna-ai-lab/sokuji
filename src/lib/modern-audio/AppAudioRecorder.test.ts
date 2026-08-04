import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppAudioRecorder } from './AppAudioRecorder';

// Mirrors preload.js: receive(channel, fn) registers fn, the wrapper strips the
// IPC event so handlers get the payload directly, and removeListener resolves
// the handler by its original reference.
const handlers: Record<string, (payload: any) => void> = {};
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  invoke = vi.fn().mockResolvedValue({ ok: true });
  (window as any).electron = {
    invoke,
    receive: vi.fn((channel: string, fn: (payload: any) => void) => { handlers[channel] = fn; }),
    removeListener: vi.fn((channel: string) => { delete handlers[channel]; }),
  };
});

const pushPcm = (bytes: number[]) => handlers['app-audio:pcm']?.(new Uint8Array(bytes));

async function started() {
  const rec = new AppAudioRecorder(24000);
  await rec.begin({ deviceId: 'app:pid:42' });
  return rec;
}

describe('AppAudioRecorder.begin', () => {
  it('starts the helper for the selected source', async () => {
    const rec = await started();
    expect(invoke).toHaveBeenCalledWith('start-app-audio-capture', 'app:pid:42');
    expect(rec.getStatus()).toBe('paused');
  });

  it('subscribes before invoking, so the first chunks are not dropped', async () => {
    const order: string[] = [];
    (window as any).electron.receive = vi.fn((c: string, fn: any) => {
      order.push(`receive:${c}`);
      handlers[c] = fn;
    });
    invoke.mockImplementation(async () => { order.push('invoke'); return { ok: true }; });

    await started();

    expect(order.indexOf('receive:app-audio:pcm')).toBeLessThan(order.indexOf('invoke'));
  });

  it('returns false without a deviceId and never starts the helper', async () => {
    const rec = new AppAudioRecorder(24000);
    expect(await rec.begin({})).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns false and unsubscribes when the main process has no helper', async () => {
    invoke.mockResolvedValue({ ok: false, error: 'Capture helper unavailable' });
    const rec = new AppAudioRecorder(24000);

    expect(await rec.begin({ deviceId: 'app:pid:42' })).toBe(false);
    expect(handlers['app-audio:pcm']).toBeUndefined();
  });
});

describe('AppAudioRecorder PCM handling', () => {
  it('delivers pushed PCM as Int16Array', async () => {
    const rec = await started();
    const seen: Int16Array[] = [];
    await rec.record(({ mono }) => seen.push(mono));

    // 0x0100 -> 256, 0xFF7F -> -129 (little-endian)
    pushPcm([0x00, 0x01, 0x7f, 0xff]);

    expect(seen).toHaveLength(1);
    expect(Array.from(seen[0])).toEqual([256, -129]);
    expect(rec.getStatus()).toBe('recording');
  });

  it('carries an odd trailing byte into the next chunk instead of dropping it', async () => {
    const rec = await started();
    const seen: Int16Array[] = [];
    await rec.record(({ mono }) => seen.push(mono));

    // A chunk boundary splitting a sample must not corrupt the stream.
    pushPcm([0x00, 0x01, 0x7f]);
    expect(Array.from(seen[0])).toEqual([256]);

    pushPcm([0xff]);
    expect(Array.from(seen[1])).toEqual([-129]);
  });

  it('emits nothing for a chunk that is a single odd byte', async () => {
    const rec = await started();
    const seen: Int16Array[] = [];
    await rec.record(({ mono }) => seen.push(mono));

    pushPcm([0x42]);

    expect(seen).toHaveLength(0);
  });

  it('drops audio while paused and resumes afterwards', async () => {
    const rec = await started();
    const seen: Int16Array[] = [];
    await rec.record(({ mono }) => seen.push(mono));

    await rec.pause();
    pushPcm([0x00, 0x01]);
    expect(seen).toHaveLength(0);

    await rec.record(({ mono }) => seen.push(mono));
    pushPcm([0x00, 0x01]);
    expect(seen).toHaveLength(1);
  });

  it('hands out a detachable buffer per chunk', async () => {
    const rec = await started();
    const seen: Int16Array[] = [];
    await rec.record(({ mono }) => seen.push(mono));

    pushPcm([0x00, 0x01]);
    pushPcm([0x00, 0x02]);

    // Consumers transfer the ArrayBuffer to a worker; sharing one across chunks
    // would detach the previous chunk's data.
    expect(seen[0].buffer).not.toBe(seen[1].buffer);
  });
});

describe('AppAudioRecorder lifecycle', () => {
  it('stops the helper and unsubscribes on end', async () => {
    const rec = await started();
    await rec.end();

    expect(invoke).toHaveBeenCalledWith('stop-app-audio-capture');
    expect(handlers['app-audio:pcm']).toBeUndefined();
    expect(handlers['app-audio:event']).toBeUndefined();
    expect(rec.getStatus()).toBe('ended');
  });

  it('removeListener receives the same reference that was registered', async () => {
    const rec = await started();
    const registered = (window as any).electron.receive.mock.calls
      .find((c: any[]) => c[0] === 'app-audio:pcm')[1];

    await rec.end();

    const removed = (window as any).electron.removeListener.mock.calls
      .find((c: any[]) => c[0] === 'app-audio:pcm')[1];
    expect(removed).toBe(registered);
  });

  it('surfaces a helper exit through onLost', async () => {
    const rec = await started();
    const onLost = vi.fn();
    rec.onLost = onLost;

    handlers['app-audio:event']({ event: 'exit', code: 1 });

    expect(onLost).toHaveBeenCalled();
  });

  it('surfaces a helper error through onLost', async () => {
    const rec = await started();
    const onLost = vi.fn();
    rec.onLost = onLost;

    handlers['app-audio:event']({ event: 'error', code: 'target_gone' });

    expect(onLost).toHaveBeenCalled();
  });

  it('surfaces a helper warning through onWarning, not onLost', async () => {
    const rec = await started();
    const onWarning = vi.fn();
    const onLost = vi.fn();
    rec.onWarning = onWarning;
    rec.onLost = onLost;

    handlers['app-audio:event']({ event: 'warning', code: 'silent_no_permission' });

    expect(onWarning).toHaveBeenCalledWith('silent_no_permission');
    // A permission warning is recoverable; tearing the capture down and falling
    // back to whole-system audio would hide the very problem being reported.
    expect(onLost).not.toHaveBeenCalled();
  });

  it('does not treat the format event as a loss', async () => {
    const rec = await started();
    const onLost = vi.fn();
    rec.onLost = onLost;

    handlers['app-audio:event']({ event: 'format', sampleRate: 24000, channels: 1 });

    expect(onLost).not.toHaveBeenCalled();
  });

  it('exposes an analyser once audio has been pushed, so the waveform animates', async () => {
    // jsdom has no Web Audio, so stand one up. A permanently flat waveform gave
    // no way to tell working capture from silent capture, which is exactly the
    // question this analyser exists to answer.
    const analyser = { fftSize: 0, frequencyBinCount: 128 };
    const connected: unknown[] = [];
    (globalThis as any).AudioContext = class {
      currentTime = 0;
      state = 'running';
      createAnalyser() { return analyser; }
      createBuffer(_c: number, len: number) {
        return { duration: len / 24000, getChannelData: () => new Float32Array(len) };
      }
      createBufferSource() {
        return { buffer: null, connect: (n: unknown) => connected.push(n), start: () => {} };
      }
      close() { return Promise.resolve(); }
    };

    const rec = await started();
    expect(rec.getAnalyser()).toBeNull();   // nothing captured yet

    await rec.record(() => {});
    pushPcm([0x00, 0x01, 0x00, 0x02]);

    expect(rec.getAnalyser()).toBe(analyser);
    // Never wired to the destination: playing the capture back would feed it
    // straight into itself.
    expect(connected).toEqual([analyser]);

    delete (globalThis as any).AudioContext;
  });

  it('reports the captured level so silence is a stated fact, not an inference', async () => {
    const rec = await started();
    await rec.record(() => {});
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((m: any) => { logged.push(String(m)); });

    // Two seconds at 24 kHz is 48000 samples; push them as full-scale silence.
    for (let i = 0; i < 100; i++) pushPcm(new Array(960).fill(0));

    spy.mockRestore();
    const level = logged.find((l) => l.includes('captured level'));
    expect(level).toBeDefined();
    expect(level).toContain('silent');
  });
});
