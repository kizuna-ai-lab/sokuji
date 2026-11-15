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
}
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
    error: onError,
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
    close: () => encoder.close(),
  };
};
