// src/lib/history/recording/track.ts
//
// One leg's recording track. It takes the audio that was sent for recognition on that side, with the clock time it
// arrived, and keeps the file on the record's clock: a stretch that was held back (the microphone muted, the
// push-to-talk key up) becomes encoded silence. Encoded packets go straight onto Ogg pages; only the pages not yet
// taken are kept.
import { SAMPLE_RATE } from '../../contract/adapter';
import { SENT_JOIN_MS } from '../../contract/sentClock';
import { createOggOpusWriter, type OggOpusWriter } from './ogg';

export interface OpusEncoderPort {
  encode(pcm: Int16Array): void;
  flush(): Promise<void>;
  close(): void;
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
  /** The encoder's last packets and the end of the stream. */
  end(): Promise<TrackPiece>;
  /** Where the first sample lies on the record's clock; null before any audio. */
  readonly offsetMs: number | null;
  readonly failed: boolean;
}

const SAMPLES_PER_MS = SAMPLE_RATE / 1000;
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
      const start = at - pcm.length / SAMPLES_PER_MS - o.startedAt;
      if (offsetMs === null) {
        offsetMs = Math.max(0, Math.round(start));
        open();
      } else {
        // Held back since the last chunk: silence for it, so a position in the file stays a time on the record.
        const gap = start - (offsetMs + samplesIn / SAMPLES_PER_MS);
        if (gap > SENT_JOIN_MS) {
          const zeros = new Int16Array(Math.round(gap * SAMPLES_PER_MS));
          samplesIn += zeros.length;
          encode(zeros);
        }
      }
      samplesIn += pcm.length;
      encode(pcm);
    },

    take: () => piece(false),

    async end() {
      if (failed || !encoder) return EMPTY;
      try {
        await encoder.flush();
      } catch {
        fail();
        return EMPTY;
      }
      try { encoder.close(); } catch { /* closing is best effort */ }
      return piece(true) ?? { bytes: new Uint8Array(0), durationMs };
    },

    get offsetMs() { return offsetMs; },
    get failed() { return failed; },
  };
}
