import { describe, it, expect } from 'vitest';
import { bytesToInt16, int16ToBytes } from '../../modules/audio-capture/src/int16';
import type { CaptureInfo, CaptureOptions } from '../../modules/audio-capture/src/AudioCaptureModule';
import { createCaptureAdapter, createModuleSpeechPlayer } from './captureAdapter';

// The native module stood in for: records its calls and fires its events the way
// the wrapper does, through the real byte conversion.
function fakeModule() {
  const m = {
    starts: [] as CaptureOptions[],
    stops: 0,
    info: { chain: 'none', sampleRate: 16000 } as CaptureInfo,
    audio: new Set<(pcm: Int16Array) => void>(),
    stopped: new Set<(e: { reason: 'interrupted' | 'error'; message?: string }) => void>(),
    frame(bytes: Uint8Array) { for (const cb of m.audio) cb(bytesToInt16(bytes)); },
    async startCapture(o: CaptureOptions) { m.starts.push(o); return m.info; },
    async stopCapture() { m.stops += 1; },
    addAudioListener(cb: (pcm: Int16Array) => void) { m.audio.add(cb); return { remove: () => { m.audio.delete(cb); } }; },
    addStoppedListener(cb: (e: { reason: 'interrupted' | 'error'; message?: string }) => void) { m.stopped.add(cb); return { remove: () => { m.stopped.delete(cb); } }; },
  };
  return m;
}
const options: CaptureOptions = { echoCancellation: true, sampleRate: 16000, inputDeviceId: null };
const samples = new Uint8Array([1, 0, 0xfe, 0xff]); // little-endian 1, -2

describe('the capture adapter', () => {
  it('starts with the options given and hands frames on as Int16', async () => {
    const m = fakeModule();
    const frames: Int16Array[] = [];
    await createCaptureAdapter(m, { options, onAudio: (p) => frames.push(p), onStopped: () => {} }).start();
    expect(m.starts).toEqual([options]);
    m.frame(samples);
    expect(Array.from(frames[0])).toEqual([1, -2]);
  });

  it('stops listening when stopped, and reports why', async () => {
    const m = fakeModule();
    const frames: Int16Array[] = [];
    const why: string[] = [];
    const c = createCaptureAdapter(m, { options, onAudio: (p) => frames.push(p), onStopped: (r) => why.push(r) });
    await c.start();
    for (const cb of m.stopped) cb({ reason: 'interrupted' });
    expect(why).toEqual(['interrupted']);
    await c.stop();
    expect(m.stops).toBe(1);
    m.frame(samples);
    expect(frames).toEqual([]);
  });

  it('resumes with the same options and returns the fresh info', async () => {
    const m = fakeModule();
    const frames: Int16Array[] = [];
    const c = createCaptureAdapter(m, { options, onAudio: (p) => frames.push(p), onStopped: () => {} });
    await c.start();
    await c.pause();
    expect(m.stops).toBe(1);
    m.info = { chain: 'vendor', sampleRate: 16000 };
    expect(await c.resume()).toEqual(m.info);
    expect(m.starts).toEqual([options, options]);
    m.frame(samples);
    expect(frames).toHaveLength(1);
  });

  it('leaves no listener behind when the start is refused', async () => {
    const m = fakeModule();
    m.startCapture = async () => { throw new Error('refused'); };
    await expect(createCaptureAdapter(m, { options, onAudio: () => {}, onStopped: () => {} }).start()).rejects.toThrow('refused');
    expect(m.audio.size).toBe(0);
    expect(m.stopped.size).toBe(0);
  });
});

describe('the byte conversion', () => {
  it('reads a frame that sits at an odd offset of its buffer', () => {
    const backing = new Uint8Array([9, 1, 0, 0xfe, 0xff]);
    expect(Array.from(bytesToInt16(backing.subarray(1)))).toEqual([1, -2]);
  });

  it('hands a chunk to the native side as its own bytes', () => {
    const whole = new Int16Array([7, 1, -2]);
    expect(Array.from(int16ToBytes(whole.subarray(1)))).toEqual([1, 0, 0xfe, 0xff]);
  });
});

describe('the speech player over the module', () => {
  function fakeSpeech() {
    const m = {
      calls: [] as string[],
      open: null as (() => void) | null,
      speechOpen: (rate: number) => new Promise<void>((resolve) => { m.calls.push(`open ${rate}`); m.open = resolve; }),
      speechWrite: (pcm: Int16Array, pan: string) => { m.calls.push(`write ${pcm.length} ${pan}`); },
      speechStop: () => { m.calls.push('stop'); },
      speechQueuedSeconds: () => 1.5,
      speechHeld: () => 3,
      speechClose: async () => { m.calls.push('close'); },
    };
    return m;
  }
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  it('holds chunks until the track is open, then writes them in order', async () => {
    const m = fakeSpeech();
    const p = createModuleSpeechPlayer(m, 24000, () => {});
    p.play(new Int16Array(10));
    p.play(new Int16Array(20), 'left');
    expect(m.calls).toEqual(['open 24000']);
    expect(p.queuedSeconds()).toBeCloseTo(30 / 24000);
    expect(p.held()).toBe(2);
    m.open!();
    await flush();
    p.play(new Int16Array(30));
    expect(m.calls.slice(1)).toEqual(['write 10 both', 'write 20 left', 'write 30 both']);
    expect(p.queuedSeconds()).toBe(1.5);
    expect(p.held()).toBe(3);
  });

  it('drops what it held when stopped before the track is open', async () => {
    const m = fakeSpeech();
    const p = createModuleSpeechPlayer(m, 24000, () => {});
    p.play(new Int16Array(10));
    p.stop();
    m.open!();
    await flush();
    expect(m.calls).toEqual(['open 24000']);
  });

  it('closes after the open has settled, and drops speech when the track never opens', async () => {
    const m = fakeSpeech();
    const failures: string[] = [];
    m.speechOpen = async () => { throw new Error('no track'); };
    const p = createModuleSpeechPlayer(m, 24000, (e) => failures.push(e));
    p.play(new Int16Array(10));
    await flush();
    p.play(new Int16Array(10));
    expect(failures).toEqual(['no track']);
    expect(m.calls).toEqual([]);
    expect(p.held()).toBe(0);
    await p.close();
    expect(m.calls).toEqual(['close']);
  });
});
