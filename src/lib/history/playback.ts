// src/lib/history/playback.ts
//
// Playing a record: the address a track is read from, where a sentence starts playing, which tracks are kept and
// how long the recording runs, which row is being played, and whether a row has audio at all.
import type { RecordRow } from './recordView';
import type { HistorySentenceSide, HistoryTimeKind, HistoryTrack } from './types';

/** The scheme the main process answers recordings on (`electron/history-audio.js`). */
const HISTORY_SCHEME = 'sokuji-history';

export const trackUrl = (recordId: string, source: string): string =>
  `${HISTORY_SCHEME}://track/${encodeURIComponent(recordId)}/${encodeURIComponent(source)}`;

/** A sentence whose time the service did not give starts this much earlier (spec ruling 25). */
export const EARLY_MS = 2500;

export function startFor(row: { startMs: number; timeKind: HistoryTimeKind }): number {
  return row.timeKind === 'given' ? row.startMs : Math.max(0, row.startMs - EARLY_MS);
}

/** The tracks the player plays: kept, with some audio. */
export function playable(tracks: readonly HistoryTrack[]): HistoryTrack[] {
  return tracks.filter((t) => t.goneAt === null && t.durationMs > 0);
}

/** Where the last kept track ends, on the record's clock. */
export function recordLength(tracks: readonly HistoryTrack[]): number {
  return playable(tracks).reduce((max, t) => Math.max(max, t.offsetMs + t.durationMs), 0);
}

/**
 * The track a side's sentences play from: its own leg's, except face to face, where both people speak into the one
 * microphone and the other side's leg captures nothing.
 */
export function trackOf(side: HistorySentenceSide, mode?: string): 'speaker' | 'participant' {
  return side === 'mine' || mode === 'face-to-face' ? 'speaker' : 'participant';
}

/** The row has audio: its track is kept and the row starts before that track ends. */
export function audible(row: Pick<RecordRow, 'side' | 'startMs'>, tracks: readonly HistoryTrack[], mode?: string): boolean {
  const t = playable(tracks).find((x) => x.source === trackOf(row.side, mode));
  return !!t && row.startMs < t.offsetMs + t.durationMs;
}

/** The row being played at `ms`: the last one that has started. */
export function rowAt<R extends Pick<RecordRow, 'startMs'>>(rows: readonly R[], ms: number): R | null {
  let found: R | null = null;
  for (const r of rows) {
    if (r.startMs <= ms) found = r;
    else break;
  }
  return found;
}
