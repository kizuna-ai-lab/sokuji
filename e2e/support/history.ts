import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface StoredRecord {
  id: string;
  state: string;
  sentences: number;
  /** The record's services as stored (JSON). */
  services: string;
  /** `fileBytes` is the size of the recording on disk, or null when the file is not there. */
  tracks: { source: string; file: string; bytes: number; durationMs: number; fileBytes: number | null }[];
  /**
   * The conversation as the session wrote it, in order: what was heard (`source`) and what it was translated to, with the
   * clock time each began (`openedAt`, ms on the run's clock, which is `Date.now()`). `startMs`/`endMs` are the segment's
   * timing (the `start_ms`/`end_ms` columns of `segments`), or null where the service gave none.
   */
  segments: { side: 'source' | 'translation'; text: string; openedAt: number; startMs: number | null; endMs: number | null }[];
  /**
   * What was heard, as the sentences the session cut it into (the `original` transcript), in order, with the span each
   * covers in ms from the record's start. A local recognizer gives its segments no timing (`startMs`/`endMs` above stay
   * null); these spans are where its turn boundaries are kept. `timeKind` says what the span is: `given` is audio-based
   * (the recognizer's heard pieces overlap the sentence), `estimated` is where the sentence arrived, which is not a
   * boundary of the audio.
   */
  heard: { text: string; startMs: number; endMs: number; timeKind: string }[];
}

/** What the history database holds, read from disk. Call it after the app has closed: the app owns the file while it runs. */
export function readHistory(userData: string): StoredRecord[] {
  const file = path.join(userData, 'history', 'history.db');
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const records = db.prepare('select * from records').all() as Record<string, unknown>[];
    return records.map((record) => {
      const id = String(record.id);
      const sentences = (db.prepare('select count(*) as n from sentences where transcript_id in (select id from transcripts where record_id = ?)').get(id) as { n: number }).n;
      const tracks = (db.prepare('select * from tracks where record_id = ?').all(id) as Record<string, unknown>[])
        .map((track) => {
          const onDisk = path.join(userData, 'history', 'records', id, String(track.file));
          return {
            source: String(track.source), file: String(track.file), bytes: Number(track.bytes), durationMs: Number(track.duration_ms),
            fileBytes: fs.existsSync(onDisk) ? fs.statSync(onDisk).size : null,
          };
        });
      const segments = (db.prepare('select side, text, opened_at as openedAt, start_ms as startMs, end_ms as endMs from segments where record_id = ? order by leg, position').all(id) as Record<string, unknown>[])
        .map((row) => ({ side: row.side as 'source' | 'translation', text: String(row.text), openedAt: Number(row.openedAt),
          startMs: row.startMs === null ? null : Number(row.startMs), endMs: row.endMs === null ? null : Number(row.endMs),
        }));
      const heard = (db.prepare("select s.text as text, s.start_ms as startMs, s.end_ms as endMs, s.time_kind as timeKind from sentences s join transcripts t on t.id = s.transcript_id where t.record_id = ? and t.text_kind = 'original' order by t.id, s.start_ms").all(id) as Record<string, unknown>[])
        .map((row) => ({ text: String(row.text), startMs: Number(row.startMs), endMs: Number(row.endMs), timeKind: String(row.timeKind) }));
      return { id, state: String(record.state), services: String(record.services), sentences, tracks, segments, heard };
    });
  } finally {
    db.close();
  }
}

/** One version of a record's notes as stored: who wrote it (`writtenBy`, parsed), its state, and why it failed. */
export interface StoredNotes {
  recordId: string;
  state: string;
  failure: string | null;
  writtenBy: { kind: string; model?: string; service?: string; promptVersion?: number | string };
  /** The notes' title, when the version is complete. */
  title: string | null;
}

/** Every notes version the history database holds, oldest first. Call it after the app has closed. */
export function readNotes(userData: string): StoredNotes[] {
  const file = path.join(userData, 'history', 'history.db');
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('select record_id, state, failure, written_by, body from notes order by id').all() as Record<string, unknown>[]).map((row) => ({
      recordId: String(row.record_id),
      state: String(row.state),
      failure: row.failure === null ? null : String(row.failure),
      writtenBy: JSON.parse(String(row.written_by)) as StoredNotes['writtenBy'],
      title: row.body === null ? null : String((JSON.parse(String(row.body)) as { title?: unknown }).title ?? ''),
    }));
  } finally {
    db.close();
  }
}
