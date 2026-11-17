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
  /** The conversation as the session wrote it, in order: what was heard (`source`) and what it was translated to, with the clock time each began. */
  segments: { side: 'source' | 'translation'; text: string; openedAt: number }[];
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
      const segments = (db.prepare('select side, text, opened_at as openedAt from segments where record_id = ? order by leg, position').all(id) as Record<string, unknown>[])
        .map((row) => ({ side: row.side as 'source' | 'translation', text: String(row.text), openedAt: Number(row.openedAt) }));
      return { id, state: String(record.state), services: String(record.services), sentences, tracks, segments };
    });
  } finally {
    db.close();
  }
}
