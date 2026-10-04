// src/lib/share/diff.ts
import type { ViewerEntry } from './types';

export interface ShareItem { entry: ViewerEntry; json: string }
export interface EntryDiff { upsert: ViewerEntry[]; remove: string[]; json: Map<string, string> }

/** What differs from what main acknowledged (`acked`: id → the JSON it holds). Pure: `applyDiff` records a success. */
export function diffEntries(acked: ReadonlyMap<string, string>, items: readonly ShareItem[]): EntryDiff {
  const upsert: ViewerEntry[] = [];
  const json = new Map<string, string>();
  const seen = new Set<string>();
  for (const { entry, json: text } of items) {
    seen.add(entry.id);
    if (acked.get(entry.id) !== text) {
      upsert.push(entry);
      json.set(entry.id, text);
    }
  }
  const remove: string[] = [];
  for (const id of acked.keys()) if (!seen.has(id)) remove.push(id);
  return { upsert, remove, json };
}

export function applyDiff(acked: Map<string, string>, diff: EntryDiff): void {
  for (const id of diff.remove) acked.delete(id);
  for (const [id, text] of diff.json) acked.set(id, text);
}
