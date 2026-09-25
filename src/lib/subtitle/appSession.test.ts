import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { createStore } from 'zustand/vanilla';
import type { Runner } from '../session/runner';
import type { RunState } from '../session/types';
import type { ConversationViewState, Readable } from '../view/conversationView';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { appSubtitleSession } from './appSession';

const providersBefore = useProviderStore.getState();
const turnBefore = useTurnModeStore.getState();
const audioBefore = useAudioStore.getState();
afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useTurnModeStore.setState(turnBefore, true);
  useAudioStore.setState(audioBefore, true);
});

function setup(options?: { microphoneRequired?(): boolean }) {
  const state = createStore<RunState>(() => ({ phase: 'idle' }));
  const runner = { state } as unknown as Runner;
  const view: Readable<ConversationViewState> = { get: () => ({ legs: [], entries: [], info: null }), subscribe: () => () => {} };
  return { state, session: appSubtitleSession(runner, view, options) };
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

describe('appSubtitleSession — the microphone gate (1e-3 ruling 5)', () => {
  it('keeps Start off with no microphone chosen only when the caller asks for one', () => {
    useAudioStore.setState({ mode: 'speaker', selectedInputDevice: null });
    const { session } = setup({ microphoneRequired: () => true });
    expect(session.get()).toMatchObject({ canStart: false, idle: { kind: 'unready', code: 'no_microphone' } });
  });

  it('tells its listeners once a microphone is chosen, and turns Start back on', () => {
    useAudioStore.setState({ mode: 'speaker', selectedInputDevice: null });
    const { session } = setup({ microphoneRequired: () => true });
    const listener = vi.fn();
    session.subscribe(listener);
    useAudioStore.setState({ selectedInputDevice: { deviceId: 'mic-1', label: 'Mic' } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.get().canStart).toBe(true);
  });

  it('never gates a start with no options, or a mode without the speaker leg', () => {
    useAudioStore.setState({ mode: 'speaker', selectedInputDevice: null });
    expect(setup().session.get().canStart).toBe(true);
    useAudioStore.setState({ mode: 'participant', selectedInputDevice: null });
    expect(setup({ microphoneRequired: () => true }).session.get().canStart).toBe(true);
  });
});
