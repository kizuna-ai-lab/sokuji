/**
 * Filtering is L3's (spec: "L2 — the projection"): one function, called by
 * each bubble surface with its own settings. The cut and the grouping are
 * computed once, upstream; what differs per surface is which rows it shows.
 */
import type { Side } from '../contract/adapter';
import type { Languages, LegName } from '../conversation/types';
import { sameRow } from '../projection/project';
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

/**
 * How long the surfaces show a transient notice (`Notice.lifetime`), from the
 * moment it was recorded. One number for every transient notice: #481 asks
 * that a notice's lifetime follow its kind, not its call site. The microphone's
 * device notices are the first; jiangzhuo chose eight seconds (2026-10-05).
 */
export const TRANSIENT_NOTICE_MS = 8000;

/** The entries a surface shows at `now`: every entry but a transient notice whose time is up. The same array when none is. */
export function visibleEntries(entries: readonly Entry[], now: number): readonly Entry[] {
  const expired = (e: Entry) => e.kind === 'notice' && e.lifetime === 'transient' && now >= e.at + TRANSIENT_NOTICE_MS;
  return entries.some(expired) ? entries.filter((e) => !expired(e)) : entries;
}

/** When the next transient notice still shown at `now` hides, or null when none is. */
export function nextNoticeExpiry(entries: readonly Entry[], now: number): number | null {
  let next: number | null = null;
  for (const e of entries) {
    if (e.kind !== 'notice' || e.lifetime !== 'transient') continue;
    const hidesAt = e.at + TRANSIENT_NOTICE_MS;
    if (hidesAt > now && (next === null || hidesAt < next)) next = hidesAt;
  }
  return next;
}

export function showsSide(filter: SideFilter, side: Side): boolean {
  return filter === 'both' || filter === side;
}

/**
 * The lines a bubble surface draws. Within an exchange the source rows come
 * first. A header opens where the leg changes from the last row drawn; a
 * notice is drawn under every filter and neither opens nor breaks a header
 * group — today's panel on each count (spec: "UI rules deferred to the UI
 * work"). `previous`, the last call's output, keeps an unchanged line's
 * object, so a memoized row does not re-render (plan 1e-3b-1 ruling 14).
 */
export function displayItems(entries: readonly Entry[], filters: LegFilters, previous: readonly DisplayItem[] = []): DisplayItem[] {
  const byKey = new Map<string, DisplayItem>();
  for (const item of previous) {
    byKey.set(item.kind === 'notice' ? `n:${item.notice.id}` : item.row.key, item);
  }
  const out: DisplayItem[] = [];
  let lastLeg: LegName | null = null;
  for (const entry of entries) {
    if (entry.kind === 'notice') {
      const old = byKey.get(`n:${entry.id}`);
      out.push(old?.kind === 'notice' && old.notice === entry ? old : { kind: 'notice', notice: entry });
      continue;
    }
    const filter = filters[entry.leg];
    const rows = [
      ...(showsSide(filter, 'source') ? entry.source : []),
      ...(showsSide(filter, 'translation') ? entry.translation : []),
    ];
    rows.forEach((row, i) => {
      const header = lastLeg !== entry.leg;
      const endsSegment = rows[i + 1]?.segmentId !== row.segmentId;
      const old = byKey.get(row.key);
      out.push(
        old?.kind === 'row' && sameRow(old.row, row) && old.header === header && old.endsSegment === endsSegment
          && old.t === entry.t && old.leg === entry.leg
          && old.languages.source === entry.languages.source && old.languages.target === entry.languages.target
          ? old
          : { kind: 'row', row, leg: entry.leg, languages: entry.languages, t: entry.t, header, endsSegment },
      );
      lastLeg = entry.leg;
    });
  }
  return out;
}
