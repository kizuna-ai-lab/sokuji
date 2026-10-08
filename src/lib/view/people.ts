/**
 * Who is speaking, numbered for display (spec 2026-10-08, slice 2): per leg,
 * each adapter label in order of first appearance → 1, 2, 3, …. A leg is
 * labelled once it has had two people; until then it reads as its leg. One
 * function, so the list, the subtitle bands, the LAN viewer and the export
 * agree on every number.
 */
import type { LegName } from '../conversation/types';
import type { Entry } from '../projection/types';

export interface People {
  /** 1-based display number of `person` on `leg`, by first appearance in the entries; undefined when `person` is undefined or the leg is not labelled. */
  numberOf(leg: LegName, person: string | undefined): number | undefined;
  /** The leg has had two or more distinct people. */
  labelled(leg: LegName): boolean;
}

type Exchange = Extract<Entry, { kind: 'exchange' }>;

/** An exchange's person: a group is one utterance, so its rows share one — the source's first, else the translation's. */
export function entryPerson(entry: Exchange): string | undefined {
  for (const row of entry.source) if (row.person !== undefined) return row.person;
  for (const row of entry.translation) if (row.person !== undefined) return row.person;
  return undefined;
}

export function people(entries: readonly Entry[]): People {
  const order: Record<LegName, Map<string, number>> = { speaker: new Map(), participant: new Map() };
  for (const entry of entries) {
    if (entry.kind !== 'exchange') continue;
    const person = entryPerson(entry);
    const seen = order[entry.leg];
    if (person !== undefined && !seen.has(person)) seen.set(person, seen.size + 1);
  }
  const labelled = (leg: LegName) => order[leg].size >= 2;
  return {
    labelled,
    numberOf: (leg, person) => (person !== undefined && labelled(leg) ? order[leg].get(person) : undefined),
  };
}

/** Which of a leg's three person shades the display number `n` (1-based) takes: 1, 4, 7 … → 0; 2, 5 … → 1; 3, 6 … → 2. */
export function personShade(n: number): 0 | 1 | 2 {
  return ((n - 1) % 3) as 0 | 1 | 2;
}
