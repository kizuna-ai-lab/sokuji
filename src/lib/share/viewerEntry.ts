// src/lib/share/viewerEntry.ts
import type { Entry, Row } from '../projection/types';
import type { ViewerEntry, ViewerRow } from './types';

const row = (r: Row): ViewerRow => ({ key: r.key, text: r.text, final: r.final });

/** What a viewer reads of one entry; notices stay with the host (spec 2026-10-04 §3.1). */
export function toViewerEntry(entry: Entry): ViewerEntry | null {
  if (entry.kind !== 'exchange') return null;
  return {
    id: entry.id,
    leg: entry.leg,
    t: entry.t,
    languages: { source: entry.languages.source, target: entry.languages.target },
    source: entry.source.map(row),
    translation: entry.translation.map(row),
  };
}
