/**
 * Client-side Silero VAD edge detector for the local_native (sidecar) provider.
 * Receives PCM16 frames, resamples to 16 kHz, runs Silero VAD, and posts EDGE
 * EVENTS ONLY back to the main thread — speech_start / speech_end /
 * speech_cancel. No utterance audio leaves this worker: the sidecar receives
 * the continuous PCM directly and segments on the client's vad_mark events
 * (spec Amendment A1). Mirrors zoom-vad.worker.ts's ORT + FrameProcessor loop.
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';
import type { VadWebConfig } from '../types';
import { resolveVadThresholds } from './_shared/vad-thresholds';

const VAD_SAMPLE_RATE = 16000;
const VAD_FRAME_SAMPLES = 512; // 32ms @ 16kHz
const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

interface VadSession { session: InferenceSession; state: Tensor; }
let vadSession: VadSession | null = null;
let frameProcessor: FrameProcessor | null = null;
let audioBuffer = new Float32Array(0);
let maxSpeechFrames = Math.ceil(20000 / VAD_FRAME_MS);
let speechFramesSinceStart = 0;

type WorkerInbound =
  | { type: 'init'; ortWasmBaseUrl?: string; vadModelUrl?: string; vadConfig?: VadWebConfig }
  | { type: 'audio'; pcm: Int16Array; sampleRate: number }
  | { type: 'flush' }
  | { type: 'dispose' };

type WorkerOutbound =
  | { type: 'ready' }
  | { type: 'speech_start' }
  | { type: 'speech_end' }
  | { type: 'speech_cancel' }
  | { type: 'error'; message: string };

const post = (msg: WorkerOutbound, transfer?: Transferable[]) =>
  (self as any).postMessage(msg, transfer ?? []);

/** Linear resample Int16 PCM to Float32 [-1,1] @ 16kHz. */
function resampleInt16ToFloat32_16k(samples: Int16Array, sampleRate: number): Float32Array {
  const float = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) float[i] = samples[i] / 32768;
  if (sampleRate === VAD_SAMPLE_RATE) return float;
  const ratio = VAD_SAMPLE_RATE / sampleRate;
  const outLen = Math.floor(float.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = float[idx] ?? 0;
    const b = float[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

async function vadInfer(frame: Float32Array): Promise<{ isSpeech: number; notSpeech: number }> {
  if (!vadSession) return { isSpeech: 0, notSpeech: 1 };
  const input = new Tensor('float32', frame, [1, VAD_FRAME_SAMPLES]);
  const sr = new Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), []);
  const result = await vadSession.session.run({ input, sr, state: vadSession.state });
  vadSession.state = result.stateN as Tensor;
  const prob = (result.output as Tensor).data[0] as number;
  return { isSpeech: prob, notSpeech: 1 - prob };
}

function vadResetStates() {
  if (!vadSession) return;
  vadSession.state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
}

async function initVad(vadConfig?: VadWebConfig, vadModelUrl?: string): Promise<void> {
  const session = await InferenceSession.create(vadModelUrl || './wasm/vad/silero_vad_v5.onnx', {
    executionProviders: ['wasm'],
  });
  vadSession = { session, state: new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]) };

  const { positive: positiveSpeechThreshold, negative: negativeSpeechThreshold } =
    resolveVadThresholds(vadConfig);
  const redemptionMs = (vadConfig?.minSilenceDuration ?? 1.4) * 1000;
  const minSpeechMs = (vadConfig?.minSpeechDuration ?? 0.4) * 1000;
  const preSpeechPadMs = (vadConfig?.preSpeechPadDuration ?? 0.8) * 1000;
  maxSpeechFrames = Math.ceil(((vadConfig?.maxSpeechDuration ?? 20) * 1000) / VAD_FRAME_MS);

  frameProcessor = new FrameProcessor(
    vadInfer,
    vadResetStates,
    {
      positiveSpeechThreshold,
      negativeSpeechThreshold,
      redemptionMs,
      minSpeechMs,
      preSpeechPadMs,
      submitUserSpeechOnPause: false,
    },
    VAD_FRAME_MS,
  );
  frameProcessor.resume();
  audioBuffer = new Float32Array(0);
  post({ type: 'ready' });
}

async function feedAudio(samples: Int16Array, sampleRate: number): Promise<void> {
  if (!vadSession || !frameProcessor) return;
  const resampled = resampleInt16ToFloat32_16k(samples, sampleRate);
  const newBuf = new Float32Array(audioBuffer.length + resampled.length);
  newBuf.set(audioBuffer);
  newBuf.set(resampled, audioBuffer.length);
  audioBuffer = newBuf;

  while (audioBuffer.length >= VAD_FRAME_SAMPLES) {
    const frame = audioBuffer.slice(0, VAD_FRAME_SAMPLES);
    audioBuffer = audioBuffer.slice(VAD_FRAME_SAMPLES);
    const events: FrameProcessorEvent[] = [];
    await frameProcessor.process(frame, (ev) => events.push(ev));
    for (const ev of events) {
      switch (ev.msg) {
        case Message.SpeechStart:
          speechFramesSinceStart = 0;
          post({ type: 'speech_start' });
          break;
        case Message.SpeechEnd:
          speechFramesSinceStart = 0;
          post({ type: 'speech_end' });
          break;
        case Message.VADMisfire:
          speechFramesSinceStart = 0;
          post({ type: 'speech_cancel' });
          break;
      }
    }
    if (frameProcessor.speaking) {
      speechFramesSinceStart++;
      if (speechFramesSinceStart >= maxSpeechFrames) {
        const endEvents: FrameProcessorEvent[] = [];
        frameProcessor.endSegment((ev) => endEvents.push(ev));
        for (const ev of endEvents) {
          if (ev.msg === Message.SpeechEnd) post({ type: 'speech_end' });
          else if (ev.msg === Message.VADMisfire) post({ type: 'speech_cancel' });
        }
        speechFramesSinceStart = 0;
      }
    } else {
      speechFramesSinceStart = 0;
    }
  }
}

function flush(): void {
  if (!frameProcessor) return;
  const endEvents: FrameProcessorEvent[] = [];
  frameProcessor.endSegment((ev) => endEvents.push(ev));
  for (const ev of endEvents) {
    if (ev.msg === Message.SpeechEnd) post({ type: 'speech_end' });
    else if (ev.msg === Message.VADMisfire) post({ type: 'speech_cancel' });
  }
  speechFramesSinceStart = 0;
}

// Messages are queued and processed one at a time. Without this, a slow
// 'init' (async model load) racing an 'audio' or 'dispose' message could
// interleave — e.g. dropping audio fed before init completes, or disposing
// state mid-flush. Serializing preserves the order the main thread sent them.
const messageQueue: WorkerInbound[] = [];
let isHandling = false;

self.onmessage = (e: MessageEvent<WorkerInbound>) => {
  messageQueue.push(e.data);
  void processQueue();
};

async function processQueue(): Promise<void> {
  if (isHandling) return;
  isHandling = true;
  try {
    while (messageQueue.length) {
      const msg = messageQueue.shift()!;
      try {
        await handleMessage(msg);
      } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    isHandling = false;
  }
}

async function handleMessage(msg: WorkerInbound): Promise<void> {
  switch (msg.type) {
    case 'init':
      if (msg.ortWasmBaseUrl && ortEnv?.wasm) {
        ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
      }
      await initVad(msg.vadConfig, msg.vadModelUrl);
      break;
    case 'audio':
      await feedAudio(msg.pcm, msg.sampleRate);
      break;
    case 'flush':
      flush();
      break;
    case 'dispose':
      vadSession?.session?.release?.();
      vadSession = null;
      frameProcessor = null;
      audioBuffer = new Float32Array(0);
      break;
  }
}
