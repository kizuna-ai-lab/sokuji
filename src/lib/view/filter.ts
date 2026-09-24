/**
 * Filtering is L3's (spec: "L2 — the projection"): one function, called by
 * each bubble surface with its own settings. The cut and the grouping are
 * computed once, upstream; what differs per surface is which rows it shows.
 */
import type { Side } from '../contract/adapter';
import type { Languages, LegName } from '../conversation/types';
import type { Entry, Row } from '../projection/types';

/** Which sides of a leg a surface shows: the same union as the stored display modes. */
export type SideFilter = 'both' | 'source' | 'translation' | 'none';
export type LegFilters = Readonly<Record<LegName, SideFilter>>;
export type NoticeEntry = Extract<Entry, { kind: 'notice' }>;

/** One line a bubble surface draws, in order. */
export type DisplayItem =
  | {
      kind: 'row';
      row: Row;
      leg: LegName;
      languages: Languages;
      /** The group's time: its earliest `openedAt`. */
      t: number;
      /** A header opens here: the leg changed since the last row drawn. */
      header: boolean;
      /** The last row drawn of its segment: where that segment's replay button goes. */
      endsSegment: boolean;
    }
  | { kind: 'notice'; notice: NoticeEntry };

export function showsSide(filter: SideFilter, side: Side): boolean {
  return filter === 'both' || filter === side;
}

/**
 * The lines a bubble surface draws. Within an exchange the source rows come
 * first. A header opens where the leg changes from the last row drawn; a
 * notice is drawn under every filter and neither opens nor breaks a header
 * group — today's panel on each count (spec: "UI rules deferred to the UI
 * work").
 */
export function displayItems(entries: readonly Entry[], filters: LegFilters): DisplayItem[] {
  const out: DisplayItem[] = [];
  let lastLeg: LegName | null = null;
  for (const entry of entries) {
    if (entry.kind === 'notice') {
      out.push({ kind: 'notice', notice: entry });
      continue;
    }
    const filter = filters[entry.leg];
    const rows = [
      ...(showsSide(filter, 'source') ? entry.source : []),
      ...(showsSide(filter, 'translation') ? entry.translation : []),
    ];
    rows.forEach((row, i) => {
      out.push({
        kind: 'row',
        row,
        leg: entry.leg,
        languages: entry.languages,
        t: entry.t,
        header: lastLeg !== entry.leg,
        endsSegment: rows[i + 1]?.segmentId !== row.segmentId,
      });
      lastLeg = entry.leg;
    });
  }
  return out;
}
