// src/lib/history/file/decode.ts
//
// The page's decoder for an imported file. The container is read with mediabunny, a range of the file at a time, and
// its audio decoded by the browser's own WebCodecs decoder, a block at a time: memory does not grow with the file.
// A codec WebCodecs cannot decode is tried whole by `decodeAudioData` instead, for files of up to an hour (an hour of
// 48 kHz stereo takes about 2.1 GB that way); longer ones are refused. That is no way in for AC-3, E-AC-3 or ALAC: the
// app's Chromium decodes none of them either way, on any platform, so such a file is refused as unreadable, with the
// advice to convert it to AAC or MP3 (owner, 2026-11-17: they are not supported).
import { SAMPLE_RATE } from '../../contract/adapter';
import type { DecodedAudio } from './importFile';
import { toPcm24k, type DecodedPiece } from './toPcm24k';

/** The longest file decoded whole when its codec cannot be streamed. */
export const MAX_WHOLE_FILE_MS = 60 * 60_000;

/** Seconds handed to the encoder at a time. */
const SLICE_S = 10;

/** The channels' average from `from` to `to` as 16-bit samples, clipped at full scale. */
export function mixToInt16(channels: readonly Float32Array[], from: number, to: number): Int16Array {
  const out = new Int16Array(Math.max(0, to - from));
  const n = channels.length;
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (const c of channels) sum += c[from + i] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / n));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767.5 - 0.25);
  }
  return out;
}

/** The file holds no audio track at all (a video without sound): it holds no audio, rather than one that cannot be read. */
export class NoAudioTrack extends Error {
  constructor() {
    super('The file has no audio track');
    this.name = 'NoAudioTrack';
  }
}

/** An opened media file: its length, whether its audio can be streamed, its decoded blocks. */
export interface MediaFile {
  /** From the earliest start of its tracks (`startS`) to the end of its audio. */
  durationMs: number;
  /** Where the file starts, in its own timestamps: an MPEG-TS capture may start hours in. Never below 0. */
  startS: number;
  canStream: boolean;
  pieces(signal?: AbortSignal): AsyncIterable<DecodedPiece>;
  close(): void;
}

/** The file's main audio track, opened; throws when there is none or the container cannot be read. */
export async function openMedia(file: File): Promise<MediaFile> {
  // Loaded when a file is imported, not with the page.
  const { ALL_FORMATS, AudioSampleSink, BlobSource, Input } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new NoAudioTrack();
    const canStream = await track.canDecode();
    // Where players start: the earliest track. A negative start (an encoder's priming) is cut, not kept.
    const startS = Math.max(0, await input.getFirstTimestamp(await input.getTracks()));
    const durationMs = ((await input.computeDuration([track])) - startS) * 1000;
    return {
      durationMs,
      startS,
      canStream,
      async *pieces(signal) {
        for await (const sample of new AudioSampleSink(track).samples()) {
          try {
            if (signal?.aborted) return;
            const planes = Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
              const plane = new Float32Array(sample.allocationSize({ planeIndex, format: 'f32-planar' }) / 4);
              sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
              return plane;
            });
            yield { timestampS: sample.timestamp, sampleRate: sample.sampleRate, planes };
          } finally {
            sample.close();
          }
        }
      },
      close: () => input.dispose(),
    };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

/** The file's length in ms: 0 when it has no audio track, NaN when it cannot be read. */
export async function readDuration(file: File, deps: { openMedia(file: File): Promise<MediaFile> } = { openMedia }): Promise<number> {
  try {
    const media = await deps.openMedia(file);
    media.close();
    return Number.isFinite(media.durationMs) ? media.durationMs : Number.NaN;
  } catch (error) {
    return error instanceof NoAudioTrack ? 0 : Number.NaN;
  }
}

/** The file's audio as 24 kHz mono, a block at a time; whole, for a short file whose codec cannot be streamed. */
export async function decodeFile(
  file: File,
  signal?: AbortSignal,
  deps: { openMedia(file: File): Promise<MediaFile>; decodeWholeFile(file: File): Promise<DecodedAudio> } = { openMedia, decodeWholeFile },
): Promise<DecodedAudio> {
  const media = await deps.openMedia(file);
  if (!media.canStream) {
    media.close();
    if (media.durationMs > MAX_WHOLE_FILE_MS) throw new Error('The codec cannot be decoded a block at a time and the file is too long to decode whole');
    return deps.decodeWholeFile(file);
  }
  const fromStart = async function* () {
    for await (const piece of media.pieces(signal)) yield { ...piece, timestampS: piece.timestampS - media.startS };
  };
  return {
    durationMs: media.durationMs,
    async *pcm24k() {
      try {
        // A second more than the file's length at most: a timestamp far ahead is not hours of silence.
        yield* toPcm24k(fromStart(), { signal, maxSamples: Math.ceil(((media.durationMs + 1000) / 1000) * SAMPLE_RATE) });
      } finally {
        media.close();
      }
    },
  };
}

/** The file's audio, decoded whole at 24 kHz and mixed to one channel. */
export async function decodeWholeFile(file: File): Promise<DecodedAudio> {
  const bytes = await file.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await context.decodeAudioData(bytes);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const slice = SLICE_S * SAMPLE_RATE;
  return {
    durationMs: Math.round(buffer.duration * 1000),
    async *pcm24k() {
      for (let at = 0; at < buffer.length; at += slice) yield mixToInt16(channels, at, Math.min(buffer.length, at + slice));
    },
  };
}
