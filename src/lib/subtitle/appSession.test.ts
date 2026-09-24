import { afterEach, describe, it, expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { Runner } from '../session/runner';
import type { RunState } from '../session/types';
import type { ConversationViewState, Readable } from '../view/conversationView';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { appSubtitleSession } from './appSession';

const providersBefore = useProviderStore.getState();
const turnBefore = useTurnModeStore.getState();
afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useTurnModeStore.setState(turnBefore, true);
});

function setup() {
  const state = createStore<RunState>(() => ({ phase: 'idle' }));
  const runner = { state } as unknown as Runner;
  const view: Readable<ConversationViewState> = { get: () => ({ legs: [], entries: [] }), subscribe: () => () => {} };
  return { state, session: appSubtitleSession(runner, view) };
}

describe('appSubtitleSession', () => {
  it("reads the selected provider's readiness and pair, and the turn mode", () => {
    useProviderStore.setState({
      selected: 'fake',
      readiness: { fake: { state: 'not-ready', reason: 'no key' } },
      entries: { fake: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { session } = setup();
    expect(session.get()).toMatchObject({ pair: { source: 'en', target: 'ja' }, idle: { kind: 'unready', message: 'no key' }, canStart: false });
  });

  it('tells its listeners when the run changes, and keeps its identity when nothing it shows changed', () => {
    const { state, session } = setup();
    const listener = vi.fn();
    session.subscribe(listener);
    const first = session.get();
    state.setState({ phase: 'idle' });
    expect(session.get()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    state.setState({ phase: 'starting', step: 'checking' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.get().idle).toEqual({ kind: 'starting' });
  });
});
