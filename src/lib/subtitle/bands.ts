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

/** Two items of the same segment, which join as written. */
function sameSegment(a: Item | undefined, b: Item | undefined): boolean {
  return a !== undefined && b !== undefined && a.segmentId !== undefined && a.segmentId === b.segmentId;
}

/** A band's pieces: segment edges trimmed, separators decided, only the newest `maxChars` kept. */
function piecesOf(items: readonly Item[], maxChars: number): BandPiece[] {
  const pieces: BandPiece[] = [];
  let last: Item | undefined;
  items.forEach((item, i) => {
    let text = item.text;
    let start = item.start;
    if (!sameSegment(items[i - 1], item)) {
      const trimmed = text.trimStart();
      if (start !== undefined) start += text.length - trimmed.length;
      text = trimmed;
    }
    if (!sameSegment(item, items[i + 1])) text = text.trimEnd();
    if (text.length === 0) return;
    const previous = pieces[pieces.length - 1];
    const before = previous && !sameSegment(last, item) && needsSpace(previous.text, text) ? ' ' : '';
    pieces.push({
      key: item.key,
      text,
      before,
      ...(item.segmentId !== undefined ? { segmentId: item.segmentId, start } : {}),
      ...(item.notice ? { notice: item.notice } : {}),
    });
    last = item;
  });
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
