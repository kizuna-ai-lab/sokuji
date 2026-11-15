// src/lib/history/recording/recorder.ts
//
// A record's recording: one track per leg, fed by the runner's tap, sent to the main process once a second as
// complete Ogg pages. Only pages not yet answered are held, so memory does not grow with the session, and no more
// than MAX_QUEUED_BYTES of them. The first write or encoder that fails, or storage that cannot keep up, stops the
// record's recording, which is reported and told to the user once; the session and its transcript go on.
import type { Clock } from '../../contract/clock';
import type { LegName } from '../../conversation/types';
import type { HistoryPort } from '../port';
import type { HistoryTrackPiece } from '../types';
import { createTrack, type OpusEncoderFactory, type Track, type TrackPiece } from './track';

/** Complete pages go to the main process this often (plan ruling 5). */
export const FLUSH_MS = 1000;
/** Pieces waiting for the main process past this many bytes (some minutes of both tracks) stop the recording. */
export const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

export interface HistoryRecorder {
  begin(recordId: string, startedAt: number): void;
  /** A leg's audio as it goes to recognition; ignored with no record or after a failure. */
  pcm(leg: LegName, pcm: Int16Array): void;
  /** The tracks' last pages, written; resolves when they are answered. */
  end(): Promise<void>;
  /** Bytes taken from the tracks and not yet answered by the main process. */
  queuedBytes(): number;
}

export interface HistoryRecorderDeps {
  port: HistoryPort;
  clock: Clock;
  encoder: OpusEncoderFactory;
  report(message: string, cause: unknown): void;
  /** Tells the user, once per record, that its recording stopped. */
  tell(): void;
  /** MAX_QUEUED_BYTES unless given. */
  maxQueuedBytes?: number;
}

interface Recording {
  id: string;
  startedAt: number;
  tracks: Map<LegName, Track>;
  failed: boolean;
  queued: number;
  /** Pieces go out one at a time, in order. */
  chain: Promise<void>;
  cancelFlush: (() => void) | null;
}

export function createHistoryRecorder(d: HistoryRecorderDeps): HistoryRecorder {
  let current: Recording | null = null;
  let serial = 1;
  const maxQueued = d.maxQueuedBytes ?? MAX_QUEUED_BYTES;

  const stop = (r: Recording, message: string, cause: unknown) => {
    if (r.failed) return;
    r.failed = true;
    r.cancelFlush?.();
    r.cancelFlush = null;
    // Nothing more is written: every track's encoder is closed now, the healthy ones' too.
    for (const track of r.tracks.values()) track.close();
    d.report(message, cause);
    d.tell();
  };

  const send = (r: Recording, leg: LegName, track: Track, piece: TrackPiece | null) => {
    // Nothing new (the last take had it all): the main process would refuse an empty piece.
    if (!piece || piece.bytes.length === 0 || r.failed) return;
    if (r.queued + piece.bytes.length > maxQueued) {
      stop(r, `History stopped recording ${r.id}: storage cannot keep up`, null);
      return;
    }
    const message: HistoryTrackPiece = { recordId: r.id, source: leg, offsetMs: track.offsetMs ?? 0, durationMs: piece.durationMs, data: piece.bytes };
    r.queued += piece.bytes.length;
    r.chain = r.chain.then(async () => {
      if (r.failed) return;
      try {
        await d.port.appendTrack(message);
      } catch (error) {
        stop(r, `History stopped recording ${r.id}: a piece could not be written`, error);
      } finally {
        r.queued -= piece.bytes.length;
      }
    });
  };

  const flush = (r: Recording) => {
    for (const [leg, track] of r.tracks) {
      if (track.failed) {
        stop(r, `History stopped recording ${r.id}: the ${leg} encoder failed`, null);
        return;
      }
      send(r, leg, track, track.take());
    }
  };

  const arm = (r: Recording) => {
    r.cancelFlush = d.clock.setTimeout(() => {
      r.cancelFlush = null;
      if (r.failed || current !== r) return;
      flush(r);
      if (!r.failed) arm(r);
    }, FLUSH_MS);
  };

  return {
    begin(recordId, startedAt) {
      const r: Recording = { id: recordId, startedAt, tracks: new Map(), failed: false, queued: 0, chain: Promise.resolve(), cancelFlush: null };
      current = r;
      arm(r);
    },

    pcm(leg, pcm) {
      const r = current;
      if (!r || r.failed) return;
      let track = r.tracks.get(leg);
      if (!track) {
        track = createTrack({ startedAt: r.startedAt, encoder: d.encoder, serial: serial++ });
        r.tracks.set(leg, track);
      }
      try {
        track.pcm(pcm, d.clock.now());
      } catch (error) {
        stop(r, `History stopped recording ${r.id}: the ${leg} track failed`, error);
      }
    },

    async end() {
      const r = current;
      if (!r) return;
      current = null;
      r.cancelFlush?.();
      r.cancelFlush = null;
      if (!r.failed) {
        // Each track's last take carries the end of the stream on its last page.
        for (const [leg, track] of r.tracks) {
          if (r.failed) break;
          try {
            send(r, leg, track, await track.end());
          } catch (error) {
            stop(r, `History stopped recording ${r.id}: the ${leg} track could not be finished`, error);
          }
        }
      }
      await r.chain;
    },

    queuedBytes: () => current?.queued ?? 0,
  };
}
