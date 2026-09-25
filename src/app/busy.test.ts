import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { RunState } from '../lib/session/types';
import { trackBusy } from './busy';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A runner whose `settled()` returns a new promise per call, resolved by hand. */
function fakeRunner() {
  const state = createStore<RunState>(() => ({ phase: 'idle' }));
  const resolvers: Array<() => void> = [];
  const settled = vi.fn(() => new Promise<void>((resolve) => { resolvers.push(resolve); }));
  return { state, settled, resolvers };
}

describe('trackBusy', () => {
  it('says busy once when a start leaves idle, and nothing more while it runs', () => {
    const { state, settled } = fakeRunner();
    const sent: boolean[] = [];
    trackBusy({ state, settled }, (busy) => sent.push(busy));

    state.setState({ phase: 'starting', step: 'checking' });
    state.setState({ phase: 'running', since: 0, legs: {} });

    expect(sent).toEqual([true]);
  });

  it('says not busy only once the ending has settled', async () => {
    const { state, resolvers, settled } = fakeRunner();
    const sent: boolean[] = [];
    trackBusy({ state, settled }, (busy) => sent.push(busy));

    state.setState({ phase: 'starting', step: 'checking' });
    state.setState({ phase: 'stopping' });
    state.setState({ phase: 'idle' });
    expect(sent).toEqual([true]);

    resolvers[0]();
    await flush();
    expect(sent).toEqual([true, false]);
  });

  it('stays busy through a start that begins before the last ending settled', async () => {
    const { state, resolvers, settled } = fakeRunner();
    const sent: boolean[] = [];
    trackBusy({ state, settled }, (busy) => sent.push(busy));

    state.setState({ phase: 'starting', step: 'checking' });
    state.setState({ phase: 'idle' }); // ends, settle #0 pending
    state.setState({ phase: 'starting', step: 'checking' }); // starts again before settle #0 resolves

    resolvers[0]();
    await flush();
    expect(sent).toEqual([true]); // the stale settle said nothing

    state.setState({ phase: 'idle' }); // ends again, settle #1
    resolvers[1]();
    await flush();
    expect(sent).toEqual([true, false]);
  });

  it('says not busy after a refused start', async () => {
    const { state, resolvers, settled } = fakeRunner();
    const sent: boolean[] = [];
    trackBusy({ state, settled }, (busy) => sent.push(busy));

    state.setState({ phase: 'starting', step: 'checking' });
    state.setState({ phase: 'idle' });
    resolvers[0]();
    await flush();
    expect(sent).toEqual([true, false]);
  });

  it('sends nothing after unsubscribing', () => {
    const { state, settled } = fakeRunner();
    const sent: boolean[] = [];
    const unsubscribe = trackBusy({ state, settled }, (busy) => sent.push(busy));

    unsubscribe();
    state.setState({ phase: 'starting', step: 'checking' });

    expect(sent).toEqual([]);
  });
});
