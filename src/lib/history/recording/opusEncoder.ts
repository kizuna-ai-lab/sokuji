// src/lib/history/recording/opusEncoder.ts
//
// The browser's own Opus encoder (WebCodecs `AudioEncoder`) behind the recording track's encoder port. The page has
// it built in; the main process has none, so the audio is compressed where it is captured.
import { SAMPLE_RATE } from '../../contract/adapter';
import type { OpusEncoderFactory } from './track';

/** Opus at 48 kbit/s a track, mono, at the contract's 24 kHz, in 20 ms frames (spec ruling 26). */
export const OPUS_CONFIG = { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 48000, opus: { frameDuration: 20000 } } as const;

interface EncodedChunk { byteLength: number; duration: number | null; copyTo(destination: Uint8Array): void }
interface EncoderMeta { decoderConfig?: { description?: ArrayBuffer | ArrayBufferView } }
interface WebAudioEncoder {
  configure(config: typeof OPUS_CONFIG): void;
  encode(data: unknown): void;
  flush(): Promise<void>;
  close(): void;
  readonly encodeQueueSize: number;
  addEventListener(type: 'dequeue', listener: () => void): void;
  removeEventListener(type: 'dequeue', listener: () => void): void;
}

/** Pieces left waiting in the encoder at which a caller may go on: about twenty seconds of audio at most. */
const SETTLED_QUEUE = 1;
const SETTLE_LOOK_MS = 50;
interface WebCodecsGlobals {
  AudioEncoder?: {
    new (init: { output(chunk: EncodedChunk, meta?: EncoderMeta): void; error(e: unknown): void }): WebAudioEncoder;
    isConfigSupported(config: typeof OPUS_CONFIG): Promise<{ supported?: boolean }>;
  };
  AudioData?: new (init: { format: 'f32'; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: Float32Array }) => { close(): void };
}

const globals = (): WebCodecsGlobals => globalThis as unknown as WebCodecsGlobals;

const bytesOf = (d: ArrayBuffer | ArrayBufferView): Uint8Array =>
  d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));

/** Whether this page can encode a recording. */
export async function opusRecordingSupported(): Promise<boolean> {
  const { AudioEncoder, AudioData } = globals();
  if (!AudioEncoder || !AudioData) return false;
  try {
    return (await AudioEncoder.isConfigSupported(OPUS_CONFIG)).supported === true;
  } catch {
    return false;
  }
}

export const webCodecsOpusEncoder: OpusEncoderFactory = (onPacket, onHead, onError) => {
  const { AudioEncoder, AudioData } = globals();
  if (!AudioEncoder || !AudioData) throw new Error('This page has no Opus encoder');
  let headGiven = false;
  /** Microseconds of audio given so far: each piece's timestamp. */
  let timestampUs = 0;
  /** Callers waiting for the queue to shorten: let go on an error too, which no dequeue follows. */
  let waiting: Array<() => void> = [];
  const letGo = () => { const w = waiting; waiting = []; for (const f of w) f(); };
  const encoder = new AudioEncoder({
    output(chunk, meta) {
      const description = meta?.decoderConfig?.description;
      if (!headGiven && description) {
        headGiven = true;
        onHead(bytesOf(description));
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      onPacket(data, Math.round(((chunk.duration ?? 20_000) * 48) / 1000));
    },
    error: (e) => { letGo(); onError(e); },
  });
  encoder.configure(OPUS_CONFIG);
  return {
    encode(pcm) {
      const data = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
      const audio = new AudioData({ format: 'f32', sampleRate: SAMPLE_RATE, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: timestampUs, data });
      timestampUs += Math.round((pcm.length * 1_000_000) / SAMPLE_RATE);
      try {
        encoder.encode(audio);
      } finally {
        audio.close();
      }
    },
    flush: () => encoder.flush(),
    close: () => { letGo(); encoder.close(); },
    settle: () => new Promise<void>((resolve) => {
      if (encoder.encodeQueueSize <= SETTLED_QUEUE) { resolve(); return; }
      // The dequeue event, and a look every 50 ms besides: the event is not raised in every runtime.
      let timer: ReturnType<typeof setInterval> | null = null;
      const done = () => {
        encoder.removeEventListener('dequeue', check);
        if (timer !== null) clearInterval(timer);
        waiting = waiting.filter((f) => f !== done);
        resolve();
      };
      const check = () => { if (encoder.encodeQueueSize <= SETTLED_QUEUE) done(); };
      waiting.push(done);
      encoder.addEventListener('dequeue', check);
      timer = setInterval(check, SETTLE_LOOK_MS);
    }),
  };
};
