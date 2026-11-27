/**
 * public/workers/sherpa-onnx-asr.worker.js is a classic script, so it runs here in a vm sandbox with a fake
 * recognizer and a fake port. Its segment inbox is the plain-JS twin of SegmentInbox (workers/_shared/segment-inbox.ts):
 * these tests pin the same rules (epochs, `taken` acks, cancel, `drained`, close).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SOURCE = readFileSync(join(__dirname, '../../../../public/workers/sherpa-onnx-asr.worker.js'), 'utf8');

interface FakePort {
  onmessage: ((e: { data: unknown }) => void) | null;
  sent: unknown[];
  closed: boolean;
  postMessage(msg: unknown): void;
  close(): void;
  deliver(msg: unknown): void;
}

function fakePort(): FakePort {
  return {
    onmessage: null,
    sent: [],
    closed: false,
    postMessage(msg) { this.sent.push(msg); },
    close() { this.closed = true; },
    deliver(msg) { this.onmessage?.({ data: msg }); },
  };
}

interface Harness {
  posted: any[];
  calls: { createVad: number; decodes: number[]; config: any };
  send(msg: unknown): void;
  /** Runs the Emscripten ready callback the worker installed. */
  runtimeReady(): void;
  sandbox: any;
}

/** `decodeText` is what the fake recognizer returns for a segment of `n` samples. */
function load(decodeText: (n: number) => string = (n) => `text${n}`): Harness {
  const posted: any[] = [];
  const calls = { createVad: 0, decodes: [] as number[], config: null as any };
  const self: any = {};
  const sandbox: any = {
    self,
    postMessage: (m: unknown) => posted.push(m),
    performance,
    setTimeout,
    importScripts: () => {
      sandbox.createVad = () => {
        calls.createVad++;
        return {
          config: { sileroVad: { windowSize: 512 } },
          isEmpty: () => true, pop() {}, front() {}, flush() {}, acceptWaveform() {}, isDetected: () => false, free() {},
        };
      };
      sandbox.CircularBuffer = class { push() {} size() { return 0; } head() { return 0; } get() { return new Float32Array(0); } pop() {} free() {} };
      sandbox.OfflineRecognizer = class {
        constructor(config: unknown) { calls.config = config; }
        createStream() {
          return { samples: new Float32Array(0) as Float32Array, acceptWaveform(_sr: number, s: Float32Array) { this.samples = s; }, free() {} };
        }
        decode(stream: { samples: Float32Array }) { calls.decodes.push(stream.samples.length); }
        getResult(stream: { samples: Float32Array }) { return { text: decodeText(stream.samples.length) }; }
        free() {}
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return {
    posted,
    calls,
    sandbox,
    send: (msg) => self.onmessage({ data: msg }),
    runtimeReady: () => sandbox.Module.onRuntimeInitialized(),
  };
}

const INIT = {
  type: 'init',
  fileUrls: { 'm.data': 'blob:x' },
  asrEngine: 'sensevoice',
  runtimeBaseUrl: 'https://app/asr',
  dataPackageMetadata: {},
};

const segment = (seq: number, n: number, over: Record<string, unknown> = {}) => ({
  type: 'segment', epoch: 1, seq, audio: new Float32Array(n), start: seq * 1000, end: seq * 1000 + n, endedBy: 'silence', ...over,
});

const settle = () => new Promise<void>((r) => setTimeout(r, 20));
const results = (h: Harness) => h.posted.filter((m) => m.type === 'result');
const taken = (p: FakePort) => p.sent.map((m: any) => m.seq);

async function ready(port: FakePort, decodeText?: (n: number) => string): Promise<Harness> {
  const h = load(decodeText);
  h.send({ ...INIT, segmentPort: port });
  h.runtimeReady();
  await settle();
  return h;
}

describe('sherpa-onnx worker, with a segment port', () => {
  let port: FakePort;
  beforeEach(() => { port = fakePort(); });

  // Left to decide, SenseVoice wrote the Japanese of a Japanese session in Chinese characters without kana (会议,
  // 电车): it is told the leg's language where it knows it, and decides only for a language it does not.
  it("tells SenseVoice the leg's language where SenseVoice knows it, and lets it decide otherwise", async () => {
    const senseVoiceLanguage = async (language?: string) => {
      const h = load();
      h.send({ ...INIT, ...(language === undefined ? {} : { language }), segmentPort: fakePort() });
      h.runtimeReady();
      await settle();
      return h.calls.config?.modelConfig?.senseVoice?.language;
    };
    expect(await senseVoiceLanguage('ja')).toBe('ja');
    expect(await senseVoiceLanguage('zh')).toBe('zh');
    expect(await senseVoiceLanguage('yue')).toBe('yue');
    expect(await senseVoiceLanguage('fr')).toBe('');
    expect(await senseVoiceLanguage(undefined)).toBe('');
  });

  it('gives another engine no language field it does not take', async () => {
    const h = load();
    h.send({ ...INIT, asrEngine: 'whisper', language: 'ja', segmentPort: fakePort() });
    h.runtimeReady();
    await settle();
    expect(h.calls.config.modelConfig.whisper).not.toHaveProperty('language');
  });

  it('runs no VAD, and is ready', async () => {
    const h = await ready(port);
    expect(h.calls.createVad).toBe(0);
    expect(h.posted.some((m) => m.type === 'ready')).toBe(true);
  });

  it('decodes a segment, acknowledges it before its result, and tags the result with what the detector tagged it with', async () => {
    const h = await ready(port);
    port.deliver(segment(7, 480, { press: 3, smartTurnProbability: 0.9, endedBy: 'smart' }));
    await settle();
    expect(taken(port)).toEqual([7]);
    expect(port.sent[0]).toEqual({ type: 'taken', epoch: 1, seq: 7 });
    expect(results(h)).toEqual([
      expect.objectContaining({ text: 'text480', startSample: 7000, durationMs: 30, epoch: 1, seq: 7, press: 3, endedBy: 'smart', smartTurnProbability: 0.9 }),
    ]);
  });

  it('leaves out the tags a segment does not carry', async () => {
    const h = await ready(port);
    port.deliver(segment(1, 160));
    await settle();
    const [r] = results(h);
    expect(r).not.toHaveProperty('press');
    expect(r).not.toHaveProperty('smartTurnProbability');
  });

  it('posts nothing for a segment the recognizer heard no text in, and still acknowledges it', async () => {
    const h = await ready(port, () => '   ');
    port.deliver(segment(1, 160));
    await settle();
    expect(results(h)).toEqual([]);
    expect(taken(port)).toEqual([1]);
  });

  it('removes the spaces between CJK characters', async () => {
    const h = await ready(port, () => ' 日 本 語 ');
    port.deliver(segment(1, 160));
    await settle();
    expect(results(h)[0].text).toBe('日本語');
  });

  it('decodes in arrival order and answers a drain mark only after the segments before it', async () => {
    const h = await ready(port);
    port.deliver(segment(1, 160));
    port.deliver(segment(2, 320));
    port.deliver({ type: 'drained', epoch: 1, seq: 3 });
    await settle();
    await settle();
    expect(h.posted.filter((m) => m.type === 'result' || m.type === 'drained').map((m) => (m.type === 'drained' ? 'drained' : m.seq))).toEqual([1, 2, 'drained']);
    expect(h.posted.find((m) => m.type === 'drained')).toEqual({ type: 'drained', epoch: 1, seq: 3 });
  });

  it('a stop drops the older epoch\'s queued segments, acknowledging them, and leaves the newer', async () => {
    const h = await ready(port);
    port.deliver(segment(1, 160)); // starts at once
    port.deliver(segment(2, 160)); // queued behind it
    port.deliver(segment(3, 160, { epoch: 2 }));
    h.send({ type: 'stop', epoch: 2 });
    await settle();
    await settle();
    expect(results(h).map((r) => r.seq)).toEqual([1, 3]);
    expect(taken(port).sort()).toEqual([1, 2, 3]);
  });

  it('a stop that does not exceed the current epoch changes nothing', async () => {
    const h = await ready(port);
    port.deliver(segment(1, 160));
    port.deliver(segment(2, 160));
    h.send({ type: 'stop', epoch: 1 });
    await settle();
    await settle();
    expect(results(h).map((r) => r.seq)).toEqual([1, 2]);
  });

  it('a segment of an epoch already stopped is dropped and acknowledged', async () => {
    const h = await ready(port);
    h.send({ type: 'stop', epoch: 2 });
    port.deliver(segment(1, 160, { epoch: 1 }));
    await settle();
    expect(results(h)).toEqual([]);
    expect(taken(port)).toEqual([1]);
  });

  it("a cancel drops that press's segments not yet started", async () => {
    const h = await ready(port);
    port.deliver(segment(1, 160, { press: 1 }));
    port.deliver(segment(2, 160, { press: 1 }));
    port.deliver(segment(3, 160, { press: 2 }));
    port.deliver({ type: 'cancel', epoch: 1, seq: 4, press: 1 });
    await settle();
    await settle();
    expect(results(h).map((r) => r.seq)).toEqual([1, 3]);
    expect(taken(port).sort()).toEqual([1, 2, 3]);
  });

  it('a decode that throws is reported, was already acknowledged, and does not stop the next', async () => {
    const h = await ready(port, (n) => { if (n === 160) throw new Error('boom'); return 'ok'; });
    port.deliver(segment(1, 160));
    port.deliver(segment(2, 320));
    await settle();
    await settle();
    expect(h.posted.find((m) => m.type === 'error')).toEqual({ type: 'error', error: 'ASR processing error: boom' });
    expect(results(h).map((r) => r.seq)).toEqual([2]);
    expect(taken(port)).toEqual([1, 2]);
  });

  it('takes no audio or flush: the detector has the audio', async () => {
    const h = await ready(port);
    h.send({ type: 'audio', samples: new Int16Array(480), sampleRate: 24000 });
    h.send({ type: 'flush' });
    await settle();
    expect(h.posted.filter((m) => m.type === 'error').map((m) => m.error)).toEqual(['Unknown message type: audio', 'Unknown message type: flush']);
    expect(h.calls.decodes).toEqual([]);
  });

  it('dispose stops listening, closes the port and says disposed', async () => {
    const h = await ready(port);
    h.send({ type: 'dispose' });
    await settle();
    expect(port.closed).toBe(true);
    expect(port.onmessage).toBeNull();
    expect(h.posted[h.posted.length - 1]).toEqual({ type: 'disposed' });
    port.deliver(segment(1, 160));
    await settle();
    expect(results(h)).toEqual([]);
  });

  it('queued segments are dropped on dispose, and nothing is decoded against the freed recognizer', async () => {
    const h = await ready(port);
    port.deliver(segment(1, 160));
    port.deliver(segment(2, 160));
    h.send({ type: 'dispose' });
    await settle();
    await settle();
    expect(h.calls.decodes).toEqual([160]);
    expect(h.posted[h.posted.length - 1]).toEqual({ type: 'disposed' });
  });
});

describe('sherpa-onnx worker, without a port', () => {
  it('cannot start: it says so, and creates no recognizer', async () => {
    const h = load();
    h.send(INIT);
    await settle();
    expect(h.posted.find((m) => m.type === 'error')?.error).toMatch(/segmentPort is required/);
    expect(h.posted.some((m) => m.type === 'ready')).toBe(false);
    expect(h.calls.createVad).toBe(0);
  });
});
