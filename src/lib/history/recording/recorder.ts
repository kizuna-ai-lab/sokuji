// src/lib/history/recording/recorder.ts
//
// A record's recording: one track per leg, fed by the runner's tap, sent to the main process once a second as
// complete Ogg pages. Only pages not yet answered are held, so memory does not grow with the session, and no more
// than MAX_QUEUED_BYTES of them. The first write or encoder that fails, or storage that cannot keep up, stops the
// record's recording, which is reported and told to the user once; the session and its transcript go on.
//
// A session's audio starts before its record exists, and may start while the previous record is still closing: from
// `prepare` on, audio is the new record's — held, with the times it arrived, until `begin` says the record exists —
// and each record is ended by its id.
import type { Clock } from '../../contract/clock';
import type { LegName } from '../../conversation/types';
import type { HistoryPort } from '../port';
import type { HistoryTrackPiece } from '../types';
import { SAMPLE_RATE } from '../../contract/adapter';
import { createTrack, type OpusEncoderFactory, type Track, type TrackPiece } from './track';

/** Complete pages go to the main process this often (plan ruling 5). */
export const FLUSH_MS = 1000;
/** Pieces waiting for the main process past this many bytes (some minutes of both tracks) stop the recording. */
export const MAX_QUEUED_BYTES = 8 * 1024 * 1024;
/** Audio held for a record not yet opened, at most this much per leg; what comes later is not held. */
export const MAX_HELD_MS = 30_000;
/** A record's end waits this long for its last pages to be answered; after it, the recording is stopped. */
export const END_WAIT_MS = 10_000;

export interface HistoryRecorder {
  /** From now on audio is this record's: held until `begin`. */
  prepare(recordId: string, startedAt: number): void;
  /** The record exists: its held audio and what follows go to its tracks (prepared now if it was not). */
  begin(recordId: string, startedAt: number): void;
  /** The record could not be opened: its held audio is let go. */
  drop(recordId: string): void;
  /** A leg's audio as it goes to recognition; ignored with no record or after a failure. */
  pcm(leg: LegName, pcm: Int16Array): void;
  /** The record's last pages, written; resolves when they are answered. Without an id, the current record's. */
  end(recordId?: string): Promise<void>;
  /** Bytes taken from the tracks and not yet answered by the main process. */
  queuedBytes(): number;
}

export interface HistoryRecorderDeps {
  port: HistoryPort;
  clock: Clock;
  encoder: OpusEncoderFactory;
  report(message: string, cause: unknown): void;
  /** Tells the user, once per record, that its recording stopped. */
  tell(recordId: string): void;
  /** MAX_QUEUED_BYTES unless given. */
  maxQueuedBytes?: number;
}

interface Recording {
  id: string;
  startedAt: number;
  tracks: Map<LegName, Track>;
  /** Audio that came before the record existed, with the times it arrived; null once begun. */
  held: Array<{ leg: LegName; pcm: Int16Array; at: number }> | null;
  heldMs: Map<LegName, number>;
  ended: boolean;
  failed: boolean;
  queued: number;
  /** Pieces go out one at a time, in order. */
  chain: Promise<void>;
  cancelFlush: (() => void) | null;
}

export function createHistoryRecorder(d: HistoryRecorderDeps): HistoryRecorder {
  /** The record audio goes to now. */
  let current: Recording | null = null;
  /** Every record prepared and not yet ended: one may still be closing while the next one starts. */
  const recordings = new Map<string, Recording>();
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
    d.tell(r.id);
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
      if (r.failed || r.ended) return;
      flush(r);
      if (!r.failed) arm(r);
    }, FLUSH_MS);
  };

  const prepare = (recordId: string, startedAt: number): Recording => {
    const r: Recording = {
      id: recordId, startedAt, tracks: new Map(), held: [], heldMs: new Map(), ended: false, failed: false, queued: 0,
      chain: Promise.resolve(), cancelFlush: null,
    };
    recordings.set(recordId, r);
    current = r;
    return r;
  };

  const write = (r: Recording, leg: LegName, pcm: Int16Array, at: number) => {
    let track = r.tracks.get(leg);
    if (!track) {
      track = createTrack({ startedAt: r.startedAt, encoder: d.encoder, serial: serial++ });
      r.tracks.set(leg, track);
    }
    try {
      track.pcm(pcm, at);
    } catch (error) {
      stop(r, `History stopped recording ${r.id}: the ${leg} track failed`, error);
    }
  };

  const forget = (r: Recording) => {
    r.ended = true;
    r.held = null;
    recordings.delete(r.id);
    if (current === r) current = null;
  };

  return {
    prepare(recordId, startedAt) {
      if (recordings.has(recordId)) return;
      prepare(recordId, startedAt);
    },

    begin(recordId, startedAt) {
      const r = recordings.get(recordId) ?? prepare(recordId, startedAt);
      if (!r.held) return;
      const held = r.held;
      r.held = null;
      for (const h of held) {
        if (r.failed) break;
        write(r, h.leg, h.pcm, h.at);
      }
      arm(r);
    },

    drop(recordId) {
      const r = recordings.get(recordId);
      if (r) forget(r);
    },

    pcm(leg, pcm) {
      const r = current;
      if (!r || r.failed) return;
      const at = d.clock.now();
      if (r.held) {
        const ms = pcm.length / (SAMPLE_RATE / 1000);
        const sum = (r.heldMs.get(leg) ?? 0) + ms;
        if (sum > MAX_HELD_MS) {
          // The record is still not open: the recording would miss its start without a word. It stops, and says so.
          r.held.length = 0;
          stop(r, `History stopped recording ${r.id}: its record was not opened within ${MAX_HELD_MS / 1000} s`, null);
          return;
        }
        r.heldMs.set(leg, sum);
        r.held.push({ leg, pcm, at });
        return;
      }
      write(r, leg, pcm, at);
    },

    async end(recordId) {
      const r = recordId === undefined ? current : recordings.get(recordId);
      if (!r) return;
      const begun = r.held === null;
      forget(r);
      r.cancelFlush?.();
      r.cancelFlush = null;
      if (!begun) return;
      // A stopped recording writes nothing more: its end never waits on a write that may not answer.
      if (r.failed) return;
      const finish = async () => {
        // Each track's last take carries the end of the stream on its last page.
        for (const [leg, track] of r.tracks) {
          if (r.failed) break;
          try {
            const last = await track.end();
            // The encoder failed at the end: its last piece is lost, and that is said as any encoder failure is.
            if (track.failed) {
              stop(r, `History stopped recording ${r.id}: the ${leg} encoder failed`, null);
              break;
            }
            send(r, leg, track, last);
          } catch (error) {
            stop(r, `History stopped recording ${r.id}: the ${leg} track could not be finished`, error);
          }
        }
        if (!r.failed) await r.chain;
      };
      // One wait for the whole end, the encoder's last flush and the last pages' writes: the writer closes the record,
      // and opens the next, after this.
      await new Promise<void>((resolve) => {
        const cancel = d.clock.setTimeout(() => {
          stop(r, `History stopped recording ${r.id}: its last pages were not written; the encoder or storage did not answer within ${END_WAIT_MS / 1000} s`, null);
          resolve();
        }, END_WAIT_MS);
        void finish().then(() => { cancel(); resolve(); });
      });
    },

    queuedBytes: () => [...recordings.values()].reduce((n, r) => n + r.queued, 0),
  };
}
