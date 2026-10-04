// src/lib/share/publisher.ts
/**
 * Mirrors the host's conversation view to the LAN caption-share server
 * (spec 2026-10-04 §3.1): patches against what main acknowledged, an
 * explicit clear on every reset, and the share state when it changes.
 */
import type { Entry } from '../projection/types';
import type { Readable } from '../view/conversationView';
import { describeCause, reportError } from '../diagnostics/report';
import { applyDiff, diffEntries, type EntryDiff, type ShareItem } from './diff';
import type { ResetReason, ShareState } from './types';
import { toViewerEntry } from './viewerEntry';

export interface SharePort {
  patch(diff: Pick<EntryDiff, 'upsert' | 'remove'>): Promise<unknown>;
  clear(reason: ResetReason): Promise<unknown>;
  state(state: ShareState): Promise<unknown>;
}

export interface PublisherSources {
  view: Readable<{ entries: readonly Entry[] }>;
  state: Readable<ShareState>;
  onReset(listener: (reason: ResetReason) => void): () => void;
}

export function startSharePublisher(sources: PublisherSources, port: SharePort): () => void {
  const acked = new Map<string, string>();
  const cache = new WeakMap<Entry, ShareItem | null>();
  let failing = false;
  let stopped = false;
  // Bumped by every reset: a patch acknowledged after one belongs to the page
  // the reset emptied, and its lines must not count as delivered.
  let generation = 0;

  const failed = (error: unknown) => {
    if (!failing) {
      reportError('CaptionShare', `Sending captions to viewers failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'caption-share:publish' });
    }
    failing = true;
  };

  const items = (): ShareItem[] => {
    const out: ShareItem[] = [];
    for (const entry of sources.view.get().entries) {
      let item = cache.get(entry);
      if (item === undefined) {
        const viewer = toViewerEntry(entry);
        item = viewer ? { entry: viewer, json: JSON.stringify(viewer) } : null;
        cache.set(entry, item);
      }
      if (item) out.push(item);
    }
    return out;
  };

  const publish = () => {
    if (stopped) return;
    const diff = diffEntries(acked, items());
    if (diff.upsert.length === 0 && diff.remove.length === 0) return;
    const sentIn = generation;
    port.patch({ upsert: diff.upsert, remove: diff.remove }).then(
      () => { failing = false; if (sentIn === generation) applyDiff(acked, diff); },
      failed,
    );
  };

  let lastState = '';
  const sendState = () => {
    if (stopped) return;
    const state = sources.state.get();
    const text = JSON.stringify(state);
    if (text === lastState) return;
    lastState = text;
    port.state(state).catch(failed);
  };

  sendState();
  publish();
  const offView = sources.view.subscribe(publish);
  const offState = sources.state.subscribe(sendState);
  const offReset = sources.onReset((reason) => {
    generation += 1;
    acked.clear();
    port.clear(reason).catch(failed);
  });

  return () => {
    stopped = true;
    offView();
    offState();
    offReset();
  };
}
