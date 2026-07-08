/**
 * Client-side Silero VAD segmenter for the Zoom AI cascade provider.
 * Receives PCM16 frames, resamples to 16 kHz, runs Silero VAD, and posts each
 * detected utterance (Float32Array @16k) back to the main thread. No ASR here —
 * the ZoomAIClient sends utterances to Zoom Scribe over HTTPS.
 *
 * VAD scaffolding mirrors whisper-webgpu.worker.ts (same constants/loop).
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import { FrameProcessor, Message } from '@ricky0123/vad-web';
import type { FrameProcessorEvent } from '@ricky0123/vad-web/dist/frame-processor';

const VAD_SAMPLE_RATE = 16000;
const VAD_FRAME_SAMPLES = 512; // 32ms @ 16kHz
const VAD_FRAME_MS = (VAD_FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000;

interface VadSession { session: InferenceSession; state: Tensor; }
let vadSession: VadSession | null = null;
let frameProcessor: FrameProcessor | null = null;
let audioBuffer = new Float32Array(0);
let maxSpeechFrames = Math.ceil(20000 / VAD_FRAME_MS);
let speechFramesSinceStart = 0;
let processing = false;

const post = (msg: any, transfer?: Transferable[]) =>
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

async function initVad(vadModelUrl?: string): Promise<void> {
  const session = await InferenceSession.create(vadModelUrl || './wasm/vad/silero_vad_v5.onnx', {
    executionProviders: ['wasm'],
  });
  vadSession = { session, state: new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]) };
  frameProcessor = new FrameProcessor(
    vadInfer,
    vadResetStates,
    {
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.25,
      redemptionMs: 1400,
      minSpeechMs: 400,
      preSpeechPadMs: 800,
      submitUserSpeechOnPause: false,
    },
    VAD_FRAME_MS,
  );
  frameProcessor.resume();
  audioBuffer = new Float32Array(0);
  post({ type: 'ready' });
}

function emitUtterance(audio: Float32Array) {
  post({ type: 'utterance', audio }, [audio.buffer]);
}

async function feedAudio(samples: Int16Array, sampleRate: number): Promise<void> {
  if (!vadSession || !frameProcessor || processing) return;
  processing = true;
  try {
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
            emitUtterance(ev.audio);
            break;
          case Message.VADMisfire:
            speechFramesSinceStart = 0;
            break;
        }
      }
      if (frameProcessor.speaking) {
        speechFramesSinceStart++;
        if (speechFramesSinceStart >= maxSpeechFrames) {
          const endEvents: FrameProcessorEvent[] = [];
          frameProcessor.endSegment((ev) => endEvents.push(ev));
          for (const ev of endEvents) {
            if (ev.msg === Message.SpeechEnd) emitUtterance(ev.audio);
          }
          speechFramesSinceStart = 0;
        }
      } else {
        speechFramesSinceStart = 0;
      }
    }
  } finally {
    processing = false;
  }
}

function flush(): void {
  if (!frameProcessor) return;
  const endEvents: FrameProcessorEvent[] = [];
  frameProcessor.endSegment((ev) => endEvents.push(ev));
  for (const ev of endEvents) {
    if (ev.msg === Message.SpeechEnd) emitUtterance(ev.audio);
  }
  speechFramesSinceStart = 0;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        if (msg.ortWasmBaseUrl && ortEnv?.wasm) {
          ortEnv.wasm.wasmPaths = msg.ortWasmBaseUrl;
        }
        await initVad(msg.vadModelUrl);
        break;
      case 'audio': await feedAudio(msg.pcm as Int16Array, msg.sampleRate as number); break;
      case 'flush': flush(); break;
      case 'dispose':
        vadSession?.session?.release?.();
        vadSession = null; frameProcessor = null; audioBuffer = new Float32Array(0);
        break;
    }
  } catch (err: any) {
    post({ type: 'error', message: err?.message ?? String(err) });
  }
};
