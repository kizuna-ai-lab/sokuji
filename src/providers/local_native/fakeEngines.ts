/**
 * Test support: Local Native's seams driven by hand. Each `init` stays
 * pending until the test settles it; `calls` records the order the adapter
 * initialised them in.
 */
import type { LocalNativeConfig } from './config';
import type {
  LocalNativeEngines, NativeAsrLike, NativeInitReport, NativeTranslationLike, NativeTtsLike, NativeTtsReady, NativeVadLike,
} from './engines';
import type { NativeHost, NativePlan, NativeStage } from './host';

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const REPORT: NativeInitReport = { loadTimeMs: 3, device: 'cpu', backend: 'ct2', computeType: 'int8' };

export class FakeNativeAsr implements NativeAsrLike {
  onPartialResult: NativeAsrLike['onPartialResult'] = null;
  onResult: NativeAsrLike['onResult'] = null;
  onError: NativeAsrLike['onError'] = null;
  onClosed: NativeAsrLike['onClosed'] = null;
  inits: Array<Parameters<NativeAsrLike['init']>[0]> = [];
  fed: Int16Array[] = [];
  marks: string[] = [];
  flushes = 0;
  disposes = 0;
  flushResult: Promise<void> = Promise.resolve();
  private loading = deferred<NativeInitReport>();
  constructor(private readonly calls: string[]) {}
  init(o: Parameters<NativeAsrLike['init']>[0]) { this.calls.push('asr'); this.inits.push(o); return this.loading.promise; }
  ready(report: NativeInitReport = REPORT) { this.loading.resolve(report); }
  failInit(message: string) { this.loading.reject(new Error(message)); }
  feedAudio(pcm: Int16Array) { this.fed.push(new Int16Array(pcm)); }
  sendVadMark(event: 'start' | 'end' | 'cancel') { this.marks.push(event); }
  flush() { this.flushes++; return this.flushResult; }
  dispose() { this.disposes++; }
  partial(text: string) { this.onPartialResult?.(text); }
  final(text: string) { this.onResult?.({ text, durationMs: 1000, recognitionTimeMs: 100 }); }
  fail(message: string) { this.onError?.(message); }
  close(message = 'native host disconnected') { this.onClosed?.(message); }
}

export class FakeNativeTranslation implements NativeTranslationLike {
  onPartial: NativeTranslationLike['onPartial'] = null;
  onError: NativeTranslationLike['onError'] = null;
  onClosed: NativeTranslationLike['onClosed'] = null;
  inits: Array<Parameters<NativeTranslationLike['init']>[0]> = [];
  calls: Array<{ text: string; systemPrompt: string; wrapTranscript: boolean }> = [];
  disposes = 0;
  private loading = deferred<NativeInitReport>();
  private pending: Array<Deferred<{ translatedText: string; inferenceTimeMs: number }>> = [];
  constructor(private readonly order: string[]) {}
  init(o: Parameters<NativeTranslationLike['init']>[0]) { this.order.push('translation'); this.inits.push(o); return this.loading.promise; }
  ready(report: NativeInitReport = { ...REPORT, tokensPerSec: 40 }) { this.loading.resolve(report); }
  failInit(message: string) { this.loading.reject(new Error(message)); }
  translate(text: string, systemPrompt: string, wrapTranscript: boolean) {
    this.calls.push({ text, systemPrompt, wrapTranscript });
    const d = deferred<{ translatedText: string; inferenceTimeMs: number }>();
    this.pending.push(d);
    return d.promise;
  }
  /** A `translate_partial` push for the request in flight. */
  stream(text: string) { this.onPartial?.(text); }
  answer(translatedText: string) { this.pending.shift()!.resolve({ translatedText, inferenceTimeMs: 12 }); }
  reject(message: string) { this.pending.shift()!.reject(new Error(message)); }
  dispose() { this.disposes++; }
  close(message = 'native host disconnected') { this.onClosed?.(message); }
}

export class FakeNativeTts implements NativeTtsLike {
  onError: NativeTtsLike['onError'] = null;
  onClosed: NativeTtsLike['onClosed'] = null;
  inits: Array<Parameters<NativeTtsLike['init']>[0]> = [];
  voices: string[] = [];
  references: Array<{ sampleRate: number; transcript?: string }> = [];
  spoken: string[] = [];
  disposes = 0;
  private loading = deferred<NativeTtsReady>();
  private pending: Array<{ onChunk?: (pcm: Float32Array) => void; d: Deferred<{ samples: Float32Array; sampleRate: number; generationTimeMs: number }> }> = [];
  constructor(private readonly order: string[]) {}
  init(o: Parameters<NativeTtsLike['init']>[0]) { this.order.push('tts'); this.inits.push(o); return this.loading.promise; }
  ready(over: Partial<NativeTtsReady> = {}) { this.loading.resolve({ sampleRate: 24000, streaming: false, clones: false, ...REPORT, ...over }); }
  failInit(message: string) { this.loading.reject(new Error(message)); }
  setVoice(name: string) { this.voices.push(name); return Promise.resolve(); }
  setReferenceVoice(_audio: Float32Array, sampleRate: number, transcript?: string) { this.references.push({ sampleRate, transcript }); return Promise.resolve(); }
  generate(text: string, _speed: number, onChunk?: (pcm: Float32Array) => void) {
    this.spoken.push(text);
    const d = deferred<{ samples: Float32Array; sampleRate: number; generationTimeMs: number }>();
    this.pending.push({ onChunk, d });
    return d.promise;
  }
  /** One-shot: the oldest synthesis answers with this clip. */
  say(samples = new Float32Array(2400).fill(0.1), sampleRate = 24000) { this.pending.shift()!.d.resolve({ samples, sampleRate, generationTimeMs: 5 }); }
  /** Streaming: a chunk for the oldest synthesis. */
  chunk(samples = new Float32Array(1200).fill(0.1)) { this.pending[0].onChunk?.(samples); }
  /** Streaming: the oldest synthesis is done. */
  finish() { this.pending.shift()!.d.resolve({ samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: 7 }); }
  failSpeech(message: string) { this.pending.shift()!.d.reject(new Error(message)); }
  /** Like the real client, a dispose rejects every synthesis in flight. */
  dispose() {
    this.disposes++;
    for (const p of this.pending.splice(0)) p.d.reject(new Error('native host disconnected'));
  }
  close(message = 'native host disconnected') { this.onClosed?.(message); }
}

export class FakeNativeVad implements NativeVadLike {
  onSpeechStart: NativeVadLike['onSpeechStart'] = null;
  onSpeechEnd: NativeVadLike['onSpeechEnd'] = null;
  onSpeechCancel: NativeVadLike['onSpeechCancel'] = null;
  onError: NativeVadLike['onError'] = null;
  inits: Array<LocalNativeConfig['vad']> = [];
  fed: Int16Array[] = [];
  flushes = 0;
  disposes = 0;
  private loading = deferred<void>();
  constructor(private readonly order: string[]) {}
  init(config: LocalNativeConfig['vad']) { this.order.push('vad'); this.inits.push(config); return this.loading.promise; }
  ready() { this.loading.resolve(); }
  failInit(message: string) { this.loading.reject(new Error(message)); }
  feed(pcm: Int16Array) { this.fed.push(new Int16Array(pcm)); }
  flush() { this.flushes++; }
  dispose() { this.disposes++; }
  start() { this.onSpeechStart?.(); }
  end() { this.onSpeechEnd?.(); }
  cancel() { this.onSpeechCancel?.(); }
  fail(message: string) { this.onError?.(message); }
}

export function createFakeNativeEngines() {
  const calls: string[] = [];
  const asr = new FakeNativeAsr(calls);
  const translation = new FakeNativeTranslation(calls);
  const tts = new FakeNativeTts(calls);
  const vad = new FakeNativeVad(calls);
  const engines: LocalNativeEngines = { asr: () => asr, translation: () => translation, tts: () => tts, vad: () => vad };
  return { engines, asr, translation, tts, vad, calls };
}

export function createFakeNativeHost(over: Partial<NativeHost> = {}): NativeHost & { plans: Array<{ stage: NativeStage; plan: NativePlan }> } {
  const plans: Array<{ stage: NativeStage; plan: NativePlan }> = [];
  return {
    plans,
    listVoices: async () => [],
    voiceStore: () => null,
    hardware: async () => null,
    plan: (stage, plan) => { plans.push({ stage, plan }); },
    ...over,
  };
}
