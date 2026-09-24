/**
 * The compact subtitle bands (spec: "The two subtitle surfaces are not the
 * same thing"; "The ranges tile the segment's text"): four lines — each
 * leg's source and its translation — each holding the newest of its rows,
 * drawn as the text was written. Rows of one segment join as they are, since
 * they tile its text; a segment's outer whitespace goes where it meets
 * another segment or a band's end, and between two segments a space goes in
 * only where the script wants one. A notice goes into its leg's translation
 * band, as today's error rows do (a UI rule the rendered pages settle).
 */
import type { Side } from '../contract/adapter';
import type { LegName, SegmentId } from '../conversation/types';
import { needsSpace } from '../projection/join';
import type { Entry } from '../projection/types';
import { showsSide, type LegFilters, type NoticeEntry } from '../view/filter';

/** One stretch of a band. */
export interface BandPiece {
  /** The row's key, or the notice's id. */
  key: string;
  /** What to draw. */
  text: string;
  /** Drawn before `text`: '' or ' '. */
  before: string;
  /** A row's segment, for karaoke; absent on a notice. */
  segmentId?: SegmentId;
  /** Where `text` begins in its segment's text; absent on a notice. */
  start?: number;
  /** Set on a notice's piece. */
  notice?: NoticeEntry;
}

export interface Band {
  /** `${leg}-${side}` */
  id: string;
  leg: LegName;
  side: Side;
  pieces: BandPiece[];
}

/** How much text a band keeps: it shows only its tail (today's `BUCKET_MAX_CHARS`). */
export const BAND_MAX_CHARS = 2000;

const ORDER: ReadonlyArray<{ leg: LegName; side: Side }> = [
  { leg: 'speaker', side: 'source' },
  { leg: 'speaker', side: 'translation' },
  { leg: 'participant', side: 'source' },
  { leg: 'participant', side: 'translation' },
];

interface Item {
  key: string;
  text: string;
  segmentId?: SegmentId;
  start?: number;
  notice?: NoticeEntry;
}

export function buildBands(
  entries: readonly Entry[],
  filters: LegFilters,
  words: (notice: NoticeEntry) => string,
  maxChars = BAND_MAX_CHARS,
): Band[] {
  const items = new Map<string, Item[]>(ORDER.map(({ leg, side }) => [`${leg}-${side}`, []]));
  for (const entry of entries) {
    if (entry.kind === 'notice') {
      items.get(`${entry.leg}-translation`)!.push({ key: entry.id, text: words(entry), notice: entry });
      continue;
    }
    for (const side of ['source', 'translation'] as const) {
      if (!showsSide(filters[entry.leg], side)) continue;
      const band = items.get(`${entry.leg}-${side}`)!;
      for (const row of side === 'source' ? entry.source : entry.translation) {
        band.push({ key: row.key, text: row.text, segmentId: row.segmentId, start: row.start });
      }
    }
  }
  return ORDER
    .map(({ leg, side }) => ({ id: `${leg}-${side}`, leg, side, pieces: piecesOf(items.get(`${leg}-${side}`)!, maxChars) }))
    .filter((band) => band.pieces.length > 0);
}

/**
 * A band's pieces. A run is consecutive items of one segment (a notice is a
 * run of its own): its rows joined are its text as written, and only that
 * joined text's outer whitespace goes — each row keeps the part of itself
 * inside the trimmed stretch, so blank rows at either edge vanish whole. A
 * run's first piece gets a separator only where `needsSpace` says; inside a
 * run there is none. Then only the newest `maxChars` are kept.
 */
function piecesOf(items: readonly Item[], maxChars: number): BandPiece[] {
  const runs: Item[][] = [];
  for (const item of items) {
    const run = runs[runs.length - 1];
    if (run && item.segmentId !== undefined && run[0].segmentId === item.segmentId) run.push(item);
    else runs.push([item]);
  }
  const pieces: BandPiece[] = [];
  for (const run of runs) {
    const whole = run.map((item) => item.text).join('');
    const from = whole.length - whole.trimStart().length;
    const to = whole.trimEnd().length;
    let at = 0;
    let first = true;
    for (const item of run) {
      const start = Math.max(from, at);
      const end = Math.min(to, at + item.text.length);
      if (end > start) {
        const text = item.text.slice(start - at, end - at);
        const previous = pieces[pieces.length - 1];
        const before = first && previous !== undefined && needsSpace(previous.text, text) ? ' ' : '';
        pieces.push({
          key: item.key,
          text,
          before,
          ...(item.segmentId !== undefined ? { segmentId: item.segmentId, start: (item.start ?? 0) + (start - at) } : {}),
          ...(item.notice ? { notice: item.notice } : {}),
        });
        first = false;
      }
      at += item.text.length;
    }
  }
  // Cap: keep only the newest `maxChars` characters.
  let kept = 0;
  let from = pieces.length;
  while (from > 0 && kept < maxChars) {
    from -= 1;
    kept += pieces[from].before.length + pieces[from].text.length;
  }
  const tail = pieces.slice(from);
  if (tail.length > 0 && tail[0].before !== '') tail[0] = { ...tail[0], before: '' };
  return tail;
}
