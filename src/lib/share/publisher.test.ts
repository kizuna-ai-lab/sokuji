// src/lib/share/publisher.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Entry } from '../projection/types';
import type { ShareState, ViewerEntry } from './types';
import { startSharePublisher, type SharePort } from './publisher';

vi.mock('../diagnostics/report', () => ({ reportError: vi.fn(), describeCause: (e: unknown) => String(e) }));
import { reportError } from '../diagnostics/report';

const exchange = (id: string, text: string): Entry => ({
  kind: 'exchange', id, leg: 'speaker', languages: { source: 'ja', target: 'en' }, pairing: 'none', t: 1,
  source: [{ key: `${id}:0`, segmentId: id, side: 'source', start: 0, end: text.length, text, final: true }], translation: [],
});

function readable<T>(value: T) {
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) { value = next; for (const l of listeners) l(); },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The last element (the project's lib is ES2020: no Array.prototype.at). */
const lastOf = <T,>(list: readonly T[]): T | undefined => list[list.length - 1];

function harness() {
  const view = readable<{ entries: readonly Entry[] }>({ entries: [exchange('a', '1')] });
  const state = readable<ShareState>({ phase: 'live', pair: { source: 'ja', target: 'en' }, allowSave: false });
  let resetListener: ((r: 'clear' | 'restart') => void) | null = null;
  const port = {
    patch: vi.fn<SharePort['patch']>(async () => undefined),
    clear: vi.fn<SharePort['clear']>(async () => undefined),
    state: vi.fn<SharePort['state']>(async () => undefined),
  };
  const stop = startSharePublisher(
    { view, state, onReset: (l) => { resetListener = l; return () => { resetListener = null; }; } },
    port,
  );
  return { view, state, port, stop, reset: (r: 'clear' | 'restart') => resetListener?.(r) };
}

describe('startSharePublisher', () => {
  it('sends the state and the current entries at once, then only what changes', async () => {
    const h = harness();
    await flush();
    expect(h.port.state).toHaveBeenCalledTimes(1);
    expect(h.port.patch).toHaveBeenCalledTimes(1);
    expect(h.port.patch.mock.calls[0][0].upsert.map((e) => e.id)).toEqual(['a']);

    h.view.set({ entries: [exchange('a', '1'), exchange('b', '1')] });
    await flush();
    expect(h.port.patch.mock.calls[1][0].upsert.map((e) => e.id)).toEqual(['b']);

    h.view.set({ entries: [exchange('b', '1')] });
    await flush();
    expect(h.port.patch.mock.calls[2][0]).toMatchObject({ upsert: [], remove: ['a'] });
    h.stop();
  });

  it('sends a state only when it changed', async () => {
    const h = harness();
    await flush();
    h.state.set({ ...h.state.get() });
    h.state.set({ ...h.state.get(), allowSave: true });
    await flush();
    expect(h.port.state.mock.calls.map((c) => c[0].allowSave)).toEqual([false, true]);
    h.stop();
  });

  it('on a reset sends clear with the reason and resends everything after it', async () => {
    const h = harness();
    await flush();
    h.reset('restart');
    await flush();
    expect(h.port.clear).toHaveBeenCalledWith('restart');
    h.view.set({ entries: [exchange('a', '1')] });
    await flush();
    expect(lastOf(h.port.patch.mock.calls)?.[0].upsert.map((e: ViewerEntry) => e.id)).toEqual(['a']);
    h.stop();
  });

  it('retries what a failed patch carried and reports the failure once per streak', async () => {
    const h = harness();
    await flush();
    h.port.patch.mockRejectedValueOnce(new Error('ipc down')).mockRejectedValueOnce(new Error('ipc down'));
    h.view.set({ entries: [exchange('a', '1'), exchange('b', '1')] });
    await flush();
    h.view.set({ entries: [exchange('a', '1'), exchange('b', '1'), exchange('c', '1')] });
    await flush();
    h.view.set({ entries: [exchange('a', '1'), exchange('b', '1'), exchange('c', '1')] });
    await flush();
    const last = lastOf(h.port.patch.mock.calls)?.[0];
    expect(last?.upsert.map((e: ViewerEntry) => e.id)).toEqual(['b', 'c']);
    expect(reportError).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('stops listening when stopped', async () => {
    const h = harness();
    await flush();
    h.stop();
    h.view.set({ entries: [] });
    await flush();
    expect(h.port.patch).toHaveBeenCalledTimes(1);
  });

  // PR #597 review: a patch acknowledged after a reset belongs to the page the
  // reset emptied. Counting its lines as delivered would keep them from ever
  // being sent again when the view shows them after the reset.
  it('does not count a patch acknowledged after a reset as delivered', async () => {
    const h = harness(); // the first patch (line a) is in flight
    h.reset('clear'); // the reset lands before its acknowledgement
    await flush();
    h.view.set({ entries: [exchange('a', '1')] });
    await flush();
    expect(h.port.patch).toHaveBeenCalledTimes(2);
    expect(lastOf(h.port.patch.mock.calls)![0].upsert.map((e) => e.id)).toEqual(['a']);
    h.stop();
  });
});
