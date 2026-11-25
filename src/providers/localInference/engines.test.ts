import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockWorker, installMockWorker } from '../../lib/local-inference/engine/testing/mockWorker';
import { ModelManager } from '../../lib/local-inference/ModelManager';
import { AsrEngine } from '../../lib/local-inference/engine/AsrEngine';
import { StreamingAsrEngine } from '../../lib/local-inference/engine/StreamingAsrEngine';
import { TranslationEngine } from '../../lib/local-inference/engine/TranslationEngine';
import { TtsEngine } from '../../lib/local-inference/engine/TtsEngine';
import * as voiceStorage from '../../lib/local-inference/voiceStorage';
import { TurnDetector } from '../../lib/local-inference/engine/TurnDetector';
import { defaultEngines, type AsrLike } from './engines';

const vad = { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30 };

/** The init message the (only) worker was sent. */
const initMessage = (worker: MockWorker) => worker.postMessage.mock.calls.find((call) => (call[0] as { type?: string } | undefined)?.type === 'init')![0];

async function ready<T>(initP: Promise<T>, extra: Record<string, unknown> = {}): Promise<MockWorker> {
  await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
  const worker = MockWorker.last();
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  worker.emit({ type: 'ready', loadTimeMs: 1, ...extra });
  await initP;
  return worker;
}

function listen(asr: AsrLike) {
  const heard = { errors: [] as string[], fatal: [] as string[], partials: [] as string[], finals: [] as string[] };
  asr.onError = (e) => heard.errors.push(e);
  asr.onFatal = (e) => heard.fatal.push(e);
  asr.onPartialResult = (t) => heard.partials.push(t);
  asr.onResult = (r) => heard.finals.push(r.text);
  return heard;
}

describe('defaultEngines over the real engine classes', () => {
  let restore: () => void;
  const createObjectURL = URL.createObjectURL;

  beforeEach(() => {
    restore = installMockWorker();
    vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(true);
    vi.spyOn(ModelManager.prototype, 'getModelVariantInfo').mockResolvedValue({ dtype: 'q4' } as any);
    vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({ 'package-metadata.json': 'blob:meta', 'model.onnx': 'blob:m' });
    vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {});
    vi.spyOn(voiceStorage, 'listVoices').mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) }) as any));
    URL.createObjectURL = vi.fn(() => 'blob:x');
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); URL.createObjectURL = createObjectURL; });

  it('ASR: an error message from the ready worker is recoverable; the worker dying is fatal, and not also an error', async () => {
    const asr = defaultEngines.asr({ modelId: 'sensevoice-int8', streaming: false, turnDetection: 'shared' });
    const heard = listen(asr);
    const { port1, port2 } = new MessageChannel();
    const worker = await ready(asr.init('sensevoice-int8', { language: 'ja', segmentPort: port1 }));
    worker.emit({ type: 'partial', text: 'こん' });
    worker.emit({ type: 'result', text: 'こんにちは', durationMs: 1, recognitionTimeMs: 1 });
    worker.emit({ type: 'error', error: 'decode failed' });
    worker.emitError('RuntimeError: unreachable');
    expect(heard).toEqual({ errors: ['decode failed'], fatal: ['RuntimeError: unreachable'], partials: ['こん'], finals: ['こんにちは'] });
    expect(initMessage(worker)).toMatchObject({ segmentPort: port1 });
    expect(initMessage(worker)).not.toHaveProperty('vadConfig');
    port1.close();
    port2.close();
  });

  it('ASR: the streaming engine for Voxtral 4B, its worker told the language, the pre-roll config, the port and to keep its own endpoint', async () => {
    const asr = defaultEngines.asr({ modelId: 'voxtral-mini-4b-webgpu', streaming: true, turnDetection: 'shared' });
    const heard = listen(asr);
    const { port1, port2 } = new MessageChannel();
    const worker = await ready(asr.init('voxtral-mini-4b-webgpu', { vadConfig: vad, language: 'en', segmentPort: port1 }));
    expect(initMessage(worker)).toMatchObject({ language: 'en', vadConfig: vad, punctuationEndpoint: true, segmentPort: port1 });
    worker.emitError('device hung');
    expect(heard.fatal).toEqual(['device hung']);
    expect(heard.errors).toEqual([]);
    port1.close();
    port2.close();
  });

  it('ASR: a streaming sherpa engine (its own turns) is fed audio and flushed', async () => {
    const asr = defaultEngines.asr({ modelId: 'stream-en-kroko', streaming: true, turnDetection: 'own' });
    const worker = await ready(asr.init('stream-en-kroko', { language: 'en' }));
    const samples = new Int16Array([1, 2]);
    asr.feedAudio(samples, 24000);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'audio', samples, sampleRate: 24000 }, [samples.buffer]);
    asr.flush();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'flush' });
  });

  it('ASR: an explicit punctuationEndpoint: false reaches the streaming worker as false (the adapter sealing its own stream)', async () => {
    const asr = defaultEngines.asr({ modelId: 'voxtral-mini-4b-webgpu', streaming: true, turnDetection: 'shared' });
    const { port1, port2 } = new MessageChannel();
    const worker = await ready(asr.init('voxtral-mini-4b-webgpu', { vadConfig: vad, language: 'en', punctuationEndpoint: false, segmentPort: port1 }));
    expect(initMessage(worker)).toMatchObject({ punctuationEndpoint: false });
    port1.close();
    port2.close();
  });

  it('ASR: AST asks the offline engine to translate into the target', async () => {
    const asr = defaultEngines.asr({ modelId: 'granite-speech', streaming: false, turnDetection: 'own' });
    const { port1, port2 } = new MessageChannel();
    const worker = await ready(asr.init('granite-speech', { language: 'ja', translateTo: 'en', segmentPort: port1 }));
    expect(initMessage(worker)).toMatchObject({ task: 'translate', targetLanguage: 'en', language: 'ja', segmentPort: port1 });
    port1.close();
    port2.close();
  });

  it('TTS: the ready worker dying is fatal', async () => {
    const tts = defaultEngines.tts();
    const fatal: string[] = [];
    tts.onFatal = (e) => fatal.push(e);
    const initP = tts.init('supertonic-3');
    await ready(initP, { numSpeakers: 1, sampleRate: 44100, voices: [{ sid: 0 }] });
    await expect(initP).resolves.toMatchObject({ sampleRate: 44100, voices: [{ sid: 0 }] });
    MockWorker.last().emitError('tts crashed');
    expect(fatal).toEqual(['tts crashed']);
  });

  it('translation is the engine class itself', () => {
    expect(defaultEngines.translation()).toBeInstanceOf(TranslationEngine);
  });

  describe("the engines' public onFatal hook", () => {
    type Engine = { onError: ((e: string) => void) | null; onFatal: ((e: string) => void) | null };
    const cases: Array<[string, () => Engine & { load: () => Promise<unknown> }]> = [
      ['AsrEngine', () => { const e = new AsrEngine(); return Object.assign(e, { load: () => e.init('sensevoice-int8', 'ja', undefined, new MessageChannel().port1) }); }],
      ['StreamingAsrEngine', () => { const e = new StreamingAsrEngine(); return Object.assign(e, { load: () => e.init('voxtral-mini-4b-webgpu', { segmentPort: new MessageChannel().port1 }) }); }],
      ['TtsEngine', () => { const e = new TtsEngine(); return Object.assign(e, { load: () => e.init('supertonic-3') }); }],
    ];

    for (const [name, make] of cases) {
      it(`${name}: a ready worker dying goes to onFatal alone; its error messages still go to onError`, async () => {
        const engine = make();
        const heard = { errors: [] as string[], fatal: [] as string[] };
        engine.onError = (e) => heard.errors.push(e);
        engine.onFatal = (e) => heard.fatal.push(e);
        const worker = await ready(engine.load(), { numSpeakers: 1, sampleRate: 24000 });
        worker.emit({ type: 'error', error: 'one chunk failed' });
        worker.emitError('RuntimeError: unreachable');
        expect(heard).toEqual({ errors: ['one chunk failed'], fatal: ['RuntimeError: unreachable'] });
      });

      it(`${name}: without onFatal, a dying worker still reaches onError, as today`, async () => {
        const engine = make();
        const errors: string[] = [];
        engine.onError = (e) => errors.push(e);
        const worker = await ready(engine.load(), { numSpeakers: 1, sampleRate: 24000 });
        worker.emitError('RuntimeError: unreachable');
        expect(errors).toEqual(['RuntimeError: unreachable']);
      });
    }

    it('TtsEngine: a death reported to onFatal still rejects the generation in flight', async () => {
      const engine = new TtsEngine();
      engine.onFatal = () => {};
      const worker = await ready(engine.init('supertonic-3'), { numSpeakers: 1, sampleRate: 24000 });
      const generating = engine.generate('hello');
      worker.emitError('tts crashed');
      await expect(generating).rejects.toThrow('tts crashed');
    });
  });

  it('ASR: the segment port reaches a WebGPU recognizer in its init message, transferred, with no VAD config', async () => {
    const asr = defaultEngines.asr({ modelId: 'granite-speech', streaming: false, turnDetection: 'shared' } as any);
    const { port1, port2 } = new MessageChannel();
    const worker = await ready(asr.init('granite-speech', { vadConfig: vad, language: 'ja', segmentPort: port1 }));
    const call = worker.postMessage.mock.calls.find((c) => (c[0] as { type?: string }).type === 'init')!;
    expect((call[0] as { segmentPort?: MessagePort }).segmentPort).toBe(port1);
    expect(call[0]).not.toHaveProperty('vadConfig');
    expect(call[1]).toEqual([port1]);
    port1.close();
    port2.close();
  });

  it('ASR: a WebGPU recognizer without a segment port does not start', async () => {
    const asr = defaultEngines.asr({ modelId: 'whisper-base-webgpu', streaming: false, turnDetection: 'shared' } as any);
    await expect(asr.init('whisper-base-webgpu', { language: 'ja' })).rejects.toThrow(/no segment port/);
  });

  it("ASR: drained, stop and the partial's tag pass through the offline engine", async () => {
    const asr = defaultEngines.asr({ modelId: 'cohere-transcribe-webgpu', streaming: false, turnDetection: 'shared' } as any);
    const { port1, port2 } = new MessageChannel();
    const drained: number[] = [];
    const partials: Array<[string, unknown]> = [];
    const results: Array<{ press?: number; epoch?: number }> = [];
    asr.onDrained = (seq) => drained.push(seq);
    asr.onPartialResult = (text, tag) => partials.push([text, tag]);
    asr.onResult = (r) => results.push(r);
    const worker = await ready(asr.init('cohere-transcribe-webgpu', { language: 'ja', segmentPort: port1 }));
    worker.emit({ type: 'drained', epoch: 1, seq: 4 });
    worker.emit({ type: 'partial', text: 'a', press: 2, epoch: 1 });
    worker.emit({ type: 'result', text: 'ab', durationMs: 1, recognitionTimeMs: 1, press: 2, epoch: 1 });
    asr.stop(5);
    expect(drained).toEqual([4]);
    expect(partials).toEqual([['a', { press: 2, epoch: 1 }]]);
    expect(results[0]).toMatchObject({ press: 2, epoch: 1 });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'stop', epoch: 5 });
    port1.close();
    port2.close();
  });

  it('ASR: the streaming engine\'s stop is a no-op and its partials carry no tag', async () => {
    const asr = defaultEngines.asr({ modelId: 'voxtral-mini-4b-webgpu', streaming: true, turnDetection: 'shared' });
    const partials: Array<[string, unknown]> = [];
    asr.onPartialResult = (text, tag) => partials.push([text, tag]);
    const { port1, port2 } = new MessageChannel();
    const worker = await ready(asr.init('voxtral-mini-4b-webgpu', { vadConfig: vad, language: 'en', segmentPort: port1 }));
    worker.postMessage.mockClear();
    asr.stop(2);
    expect(worker.postMessage).not.toHaveBeenCalled();
    worker.emit({ type: 'partial', text: 'hi' });
    expect(partials).toEqual([['hi', undefined]]);
    port1.close();
    port2.close();
  });

  it('the detector is a TurnDetector', () => {
    const detector = defaultEngines.detector!();
    expect(detector).toBeInstanceOf(TurnDetector);
    detector.dispose();
  });
});
