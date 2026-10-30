import { describe, it, expect } from 'vitest';
import type { Entry } from '@shared/lib/projection/types';
import { createEntriesFeed } from './entriesFeed';

// A transcript stand-in whose entries and notifications the test controls.
function fakeTranscript() {
  let entries: Entry[] = [];
  const listeners = new Set<() => void>();
  return {
    entries: () => entries as readonly Entry[],
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
    push(n = 1) {
      for (let i = 0; i < n; i++) entries = [...entries, exchange(`e${entries.length}`, entries.length)];
      listeners.forEach((l) => l());
    },
  };
}
const exchange = (id: string, t: number): Entry => ({
  kind: 'exchange', id, leg: 'participant', languages: { source: 'en', target: 'zh' }, pairing: 'none', source: [], translation: [], t,
});

// Fake time and scheduling: the feed's batch timer runs only when the test advances.
function harness(active = true) {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  let activeCb: ((active: boolean) => void) | null = null;
  let isActive = active;
  const transcript = fakeTranscript();
  const feed = createEntriesFeed({
    transcript,
    isActive: () => isActive,
    onActiveChange: (cb) => { activeCb = cb; return () => { activeCb = null; }; },
    now: () => now,
    schedule: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }; },
  });
  const updates: Array<readonly Entry[]> = [];
  feed.subscribe((e) => updates.push(e));
  const advance = (ms: number) => {
    now += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) {
      if (t.at <= now) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    }
  };
  const setActive = (v: boolean) => { isActive = v; activeCb?.(v); };
  return { transcript, feed, updates, advance, setActive };
}

describe('createEntriesFeed', () => {
  it('folds ten notifications within the batch window into one update', () => {
    const h = harness();
    for (let i = 0; i < 10; i++) { h.transcript.push(); h.advance(10); }
    h.advance(250);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toHaveLength(10);
  });

  it('forwards nothing while inactive, then exactly one update with everything on becoming active', () => {
    const h = harness(false);
    h.transcript.push(3000);
    h.advance(10000);
    expect(h.updates).toHaveLength(0);
    h.setActive(true);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toHaveLength(3000);
  });

  it('sends no update after stop()', () => {
    const h = harness();
    h.feed.stop();
    h.transcript.push();
    h.advance(1000);
    expect(h.updates).toHaveLength(0);
  });

  it('hands the list its entries newest first', () => {
    const h = harness();
    h.transcript.push(2);
    h.advance(250);
    expect(h.updates[0].map((e) => e.id)).toEqual(['e1', 'e0']);
  });
});
