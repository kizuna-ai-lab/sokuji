// src/lib/history/file/decode.ts
//
// The page's decoder for an imported file: the browser's own (no added library). Its length is read from a media
// element first, cheaply; the audio is then decoded at the recording's 24 kHz with `decodeAudioData` — which holds
// the whole of it in memory, hence the import's length limit — and handed on as one channel, ten seconds at a time.
import { SAMPLE_RATE } from '../../contract/adapter';
import type { DecodedAudio } from './importFile';

/** Seconds handed to the encoder at a time. */
const SLICE_S = 10;
/** A media element that says nothing in this long is taken as one that cannot read the file. */
const METADATA_WAIT_MS = 15_000;

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

/**
 * The file's length in ms from a media element's metadata; NaN when the element cannot read it. Some files only
 * know their length once played to the end: the element is sent far forward to learn it.
 */
export function readMediaDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (ms: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    const timer = setTimeout(() => finish(Number.NaN), METADATA_WAIT_MS);
    el.preload = 'metadata';
    el.muted = true;
    el.onerror = () => finish(Number.NaN);
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) { finish(el.duration * 1000); return; }
      el.ondurationchange = () => { if (Number.isFinite(el.duration)) finish(el.duration * 1000); };
      el.currentTime = 1e9;
    };
    el.src = url;
  });
}

/** The file's audio, decoded at 24 kHz and mixed to one channel. */
export async function decodeFile(file: File): Promise<DecodedAudio> {
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
