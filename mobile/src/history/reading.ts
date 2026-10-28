import type { Entry, Row } from '@shared/lib/projection/types';
import { entryPerson, people } from '@shared/lib/view/people';

/** A line of a saved session as the reader shows it, oldest first. */
export interface ReadingLine {
  id: string;
  /** When the line was first heard (ms since the epoch). */
  t: number;
  /** A heading with the time: on the first line, when the minute changes, and when someone else starts speaking. */
  showTime: boolean;
  /** The speaker's number, when the session had two or more (the desktop's numbering). */
  person?: number;
  /** The speaker changes here. */
  showPerson: boolean;
  source: readonly Row[];
  translation: readonly Row[];
  /** The session ended before this line was final. */
  unfinished: boolean;
}

const minute = (t: number) => Math.floor(t / 60000);

/**
 * The reading lines of a saved session's entries (the projector's, as the
 * exporters use them). Notices are what the session said while it ran (a
 * reconnect, an error) and are left out of the reading.
 */
export function readingLines(entries: readonly Entry[]): ReadingLine[] {
  const who = people(entries);
  const lines: ReadingLine[] = [];
  let prev: ReadingLine | undefined;
  for (const e of entries) {
    if (e.kind !== 'exchange') continue;
    const person = who.numberOf(e.leg, entryPerson(e));
    const showPerson = person !== undefined && person !== prev?.person;
    const line: ReadingLine = {
      id: e.id,
      t: e.t,
      showTime: !prev || minute(e.t) !== minute(prev.t) || showPerson,
      ...(person !== undefined ? { person } : {}),
      showPerson,
      source: e.source,
      translation: e.translation,
      unfinished: [...e.source, ...e.translation].some((r) => !r.final),
    };
    lines.push(line);
    prev = line;
  }
  return lines;
}
