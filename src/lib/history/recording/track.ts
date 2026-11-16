// src/lib/history/recording/track.ts
//
// One leg's recording track. It takes the audio that was sent for recognition on that side, with the clock time it
// arrived, and keeps the file on the record's clock: a stretch that was held back (the microphone muted, the
// push-to-talk key up) becomes encoded silence. Encoded packets go straight onto Ogg pages; only the pages not yet
// taken are kept.
//
// Two things look like a pause and are not treated alike. After a real pause the audio comes back at its usual pace;
// after a stall of the page, the audio it held back arrives all at once. So the first chunk after a gap waits for the
// next: a burst is the held-back audio and fills the gap itself; a chunk at the usual pace means the gap was a pause.
// Silence is written at each take, at most a minute of it, so a long pause never sits in memory at once; audio
// that comes after it waits its turn.
import { SAMPLE_RATE } from '../../contract/adapter';
import { SENT_JOIN_MS } from '../../contract/sentClock';
import { createOggOpusWriter, type OggOpusWriter } from './ogg';

export interface OpusEncoderPort {
  encode(pcm: Int16Array): void;
  flush(): Promise<void>;
  close(): void;
  /** Resolves once little is left waiting to be encoded (without ending anything, unlike a flush). */
  settle?(): Promise<void>;
}

export type OpusEncoderFactory = (
  onPacket: (data: Uint8Array, samples48k: number) => void,
  onHead: (head: Uint8Array) => void,
  onError: (error: unknown) => void,
) => OpusEncoderPort;

export interface TrackPiece { bytes: Uint8Array; durationMs: number }

export interface Track {
  /** Audio that arrived at clock time `at`: it covers `[at − its length, at]`. */
  pcm(pcm: Int16Array, at: number): void;
  /** The pages written since the last take (the head pages first), or null when there is nothing new. */
  take(): TrackPiece | null;
  /** Waits until little is left for the encoder to encode: a caller faster than the encoder waits here. */
  drain(): Promise<void>;
  /** The encoder's last packets and the end of the stream. */
  end(): Promise<TrackPiece>;
  /** Stops the track without finishing it: its encoder is closed and what waits is dropped (the recording stopped). */
  close(): void;
  /** Where the first sample lies on the record's clock; null before any audio. */
  readonly offsetMs: number | null;
  readonly failed: boolean;
}

const SAMPLES_PER_MS = SAMPLE_RATE / 1000;
/** Silence goes to the encoder in slices of this many samples (one second), from one buffer. */
const SILENCE_SLICE = SAMPLE_RATE;
/** At most this much silence is written per take (a minute); the rest at the next. */
const SILENCE_PER_TAKE = 60 * SAMPLE_RATE;
const ZEROS = new Int16Array(SILENCE_SLICE);

type Work = { silence: number } | { pcm: Int16Array };
const EMPTY: TrackPiece = { bytes: new Uint8Array(0), durationMs: 0 };

export function createTrack(o: { startedAt: number; encoder: OpusEncoderFactory; serial: number }): Track {
  let encoder: OpusEncoderPort | null = null;
  let writer: OggOpusWriter | null = null;
  let begun = false;
  let offsetMs: number | null = null;
  let samplesIn = 0;
  let failed = false;
  let durationMs = 0;
  /** Packets the encoder gave before its head: put on pages once the head is known. */
  let early: Array<{ data: Uint8Array; samples48k: number }> = [];
  /** Silence and audio waiting to be encoded, in order. */
  const queue: Work[] = [];
  /** The audio after a gap, waiting for the next chunk to tell a pause from a stall; with the gap it follows. */
  let held: { chunks: Int16Array[]; at: number; gap: number } | null = null;
  /** The chunk length last seen, in ms: what "the usual pace" is. */
  let paceMs = 0;

  const fail = () => {
    failed = true;
    early = [];
    try { encoder?.close(); } catch { /* already failed */ }
  };

  const encode = (pcm: Int16Array) => {
    if (failed || !encoder) return;
    try {
      encoder.encode(pcm);
    } catch {
      fail();
    }
  };

  const open = () => {
    encoder = o.encoder(
      (data, samples48k) => {
        if (failed) return;
        if (writer) writer.packet(data, samples48k);
        else early.push({ data, samples48k });
      },
      (head) => {
        if (failed || writer) return;
        writer = createOggOpusWriter({ serial: o.serial, opusHead: head });
        for (const p of early) writer.packet(p.data, p.samples48k);
        early = [];
      },
      () => fail(),
    );
  };

  const enqueue = (w: Work) => {
    if ('pcm' in w && queue.length === 0) encode(w.pcm);
    else queue.push(w);
  };

  /** The held chunks, now that it is known what they were: a burst fills its gap; one chunk came after a pause. */
  const resolve = () => {
    if (!held) return;
    const { chunks, gap } = held;
    held = null;
    if (chunks.length > 1) {
      const backlog = chunks.reduce((n, c) => n + c.length, 0);
      for (const c of chunks) enqueue({ pcm: c });
      // The held chunks are already counted in `samplesIn`; only a pause longer than what they fill adds silence.
      const rest = gap - backlog;
      if (rest > SENT_JOIN_MS * SAMPLES_PER_MS) {
        samplesIn += rest;
        enqueue({ silence: rest });
      }
    } else {
      samplesIn += gap;
      enqueue({ silence: gap });
      enqueue({ pcm: chunks[0] });
    }
  };

  /** Encodes what waits, with at most `budget` samples of silence. */
  const pump = (budget: number) => {
    while (queue.length > 0 && !failed) {
      const w = queue[0];
      if ('pcm' in w) {
        queue.shift();
        encode(w.pcm);
        continue;
      }
      if (budget <= 0) return;
      const n = Math.min(w.silence, SILENCE_SLICE, budget);
      encode(n === SILENCE_SLICE ? ZEROS : ZEROS.subarray(0, n));
      budget -= n;
      w.silence -= n;
      if (w.silence <= 0) queue.shift();
    }
  };

  const piece = (end: boolean): TrackPiece | null => {
    if (failed || !writer) return null;
    const head = begun ? null : writer.begin();
    begun = true;
    const taken = writer.take(end);
    if (taken.bytes.length === 0 && !head) return null;
    durationMs = taken.durationMs;
    if (!head) return taken;
    const bytes = new Uint8Array(head.length + taken.bytes.length);
    bytes.set(head, 0);
    bytes.set(taken.bytes, head.length);
    return { bytes, durationMs };
  };

  return {
    pcm(pcm, at) {
      if (failed || pcm.length === 0) return;
      const lengthMs = pcm.length / SAMPLES_PER_MS;
      const start = at - lengthMs - o.startedAt;
      if (held) {
        // Arriving with the held chunk (well inside a chunk's time): the held-back audio of a stall.
        if (at - held.at < Math.max(paceMs, lengthMs) / 2) {
          held.chunks.push(pcm);
          samplesIn += pcm.length;
          held.at = at;
          return;
        }
        resolve();
      }
      paceMs = lengthMs;
      if (offsetMs === null) {
        offsetMs = Math.max(0, Math.round(start));
        open();
      } else {
        // Silence since the last chunk is decided by the next one: see the head of this file.
        const gap = start - (offsetMs + samplesIn / SAMPLES_PER_MS);
        if (gap > SENT_JOIN_MS) {
          held = { chunks: [pcm], at, gap: Math.round(gap * SAMPLES_PER_MS) };
          samplesIn += pcm.length;
          return;
        }
      }
      samplesIn += pcm.length;
      enqueue({ pcm });
    },

    take() {
      if (failed) return null;
      resolve();
      pump(SILENCE_PER_TAKE);
      return piece(false);
    },

    async drain() {
      if (failed || !encoder?.settle) return;
      try {
        await encoder.settle();
      } catch {
        fail();
      }
    },

    async end() {
      if (failed || !encoder) return EMPTY;
      resolve();
      // What waits is written a minute at a time, the encoder draining in between.
      while (queue.length > 0 && !failed) {
        pump(SILENCE_PER_TAKE);
        if (queue.length > 0) {
          try { await encoder.flush(); } catch { fail(); }
        }
      }
      if (failed) return EMPTY;
      try {
        await encoder.flush();
      } catch {
        fail();
        return EMPTY;
      }
      try { encoder.close(); } catch { /* closing is best effort */ }
      return piece(true) ?? { bytes: new Uint8Array(0), durationMs };
    },

    close() {
      if (!failed) fail();
      queue.length = 0;
      held = null;
    },

    get offsetMs() { return offsetMs; },
    get failed() { return failed; },
  };
}
