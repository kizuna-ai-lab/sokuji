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
import type { Leg } from '../conversation/types';
import type { Runner } from '../session/runner';
import type { RunState } from '../session/types';
import type { ConversationViewState, Readable } from '../view/conversationView';
import { fakeProvider } from '../../providers/fake/provider';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { appSubtitleSession } from './appSession';

const speakerLeg: Leg = { leg: 'speaker', session: 's', languages: { source: 'en', target: 'ja' }, segments: [], notices: [] };

const providersBefore = useProviderStore.getState();
const turnBefore = useTurnModeStore.getState();
const audioBefore = useAudioStore.getState();
afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useTurnModeStore.setState(turnBefore, true);
  useAudioStore.setState(audioBefore, true);
});

function setup(options?: { microphoneRequired?(): boolean; provider?: boolean; view?: Readable<ConversationViewState> }) {
  const state = createStore<RunState>(() => ({ phase: 'idle' }));
  const runner = { state } as unknown as Runner;
  const view: Readable<ConversationViewState> = options?.view ?? { get: () => ({ legs: [], entries: [], info: null }), subscribe: () => () => {} };
  // Every case but one about `providerLoaded` itself wants a loaded provider
  // (plan 1e-3b-1 ruling 11): otherwise every canStart it checks would be
  // false for a reason unrelated to what the case is testing.
  if (options?.provider !== false) {
    useProviderStore.setState({
      selected: 'fake',
      entries: { fake: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
  }
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

describe("appSubtitleSession — legs follow the audio mode's intent (1e-3b-1 ruling 12)", () => {
  it('offers both legs once the mode is "both", even with nothing on screen yet', () => {
    useAudioStore.setState({ mode: 'both' });
    expect(setup().session.get().legs).toEqual(['speaker', 'participant']);
  });

  it('keeps a leg the conversation already shows, even once the mode narrows past it', () => {
    useAudioStore.setState({ mode: 'participant' });
    const view: Readable<ConversationViewState> = { get: () => ({ legs: [speakerLeg], entries: [], info: null }), subscribe: () => () => {} };
    expect(setup({ view }).session.get().legs).toEqual(['speaker', 'participant']);
  });

  it("offers only the mode's leg with nothing on screen", () => {
    useAudioStore.setState({ mode: 'speaker' });
    expect(setup().session.get().legs).toEqual(['speaker']);
  });
});

describe('appSubtitleSession — providerLoaded (1e-3b-1 ruling 11)', () => {
  it("keeps Start off until the selected provider's entry has loaded, then turns it back on", async () => {
    useProviderStore.setState({ selected: 'fake', entries: {} });
    const { session } = setup({ provider: false });
    expect(session.get().canStart).toBe(false);
    const listener = vi.fn();
    session.subscribe(listener);
    await useProviderStore.getState().load(fakeProvider);
    expect(listener).toHaveBeenCalled();
    expect(session.get().canStart).toBe(true);
  });
});
