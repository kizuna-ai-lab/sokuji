import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

// The live gate (Stage 2 foundation, F7) refuses the participant leg on the
// web, jsdom's platform: the file runs as Electron, so a participant-only
// start is refused only where a case asks for the web.
const environment = vi.hoisted(() => ({ value: 'electron' as 'web' | 'electron' | 'extension' }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  getEnvironment: () => environment.value,
}));

// The providers offered here are the registry's, unless a case offers the fake first.
const offered = vi.hoisted(() => ({ fakeFirst: false }));
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return {
    ...actual,
    presentProviders: () => {
      const present = actual.presentProviders();
      return offered.fakeFirst ? [...present.filter((p) => p.id === 'fake'), ...present.filter((p) => p.id !== 'fake')] : present;
    },
  };
});

// The plan a start would run is the stores' unless a case builds one by hand (a plan of two providers).
const planned = vi.hoisted(() => ({ found: null as unknown }));
vi.mock('../plan/fromStores', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plan/fromStores')>();
  return { ...actual, planFromStores: () => (planned.found ?? actual.planFromStores()) as ReturnType<typeof actual.planFromStores> };
});

import { createStore } from 'zustand/vanilla';
import type { Leg } from '../conversation/types';
import type { PlannedUnit } from '../plan/types';
import { unitsOf } from '../plan/wholeUnit';
import type { Runner } from '../session/runner';
import type { RunState } from '../session/types';
import type { ConversationViewState, Readable } from '../view/conversationView';
import { fakeProvider } from '../../providers/fake/provider';
import { fakeLeasedProvider } from '../../providers/fake/leased';
import { FAKE_LEASED_DEFAULTS } from '../../providers/fake/settings';
import { setUseOwnBalance } from '../session/payerChoice';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { runsOn } from '../../stores/lineUpStore.testing';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { appSubtitleSession } from './appSession';

const speakerLeg: Leg = { leg: 'speaker', session: 's', languages: { source: 'en', target: 'ja' }, segments: [], notices: [] };

const providersBefore = useProviderStore.getState();
const turnBefore = useTurnModeStore.getState();
const audioBefore = useAudioStore.getState();
const accountBefore = useAccountStore.getState();
const settingsBefore = useSettingsStore.getState();
const routingBefore = useRoutingStore.getState();
afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useTurnModeStore.setState(turnBefore, true);
  useAudioStore.setState(audioBefore, true);
  useAccountStore.setState(accountBefore, true);
  useSettingsStore.setState(settingsBefore, true);
  useRoutingStore.setState(routingBefore, true);
  environment.value = 'electron';
  offered.fakeFirst = false;
  planned.found = null;
});

function setup(options?: { microphoneRequired?(): boolean; provider?: boolean; view?: Readable<ConversationViewState> }) {
  const state = createStore<RunState>(() => ({ phase: 'idle' }));
  const runner = { state } as unknown as Runner;
  const view: Readable<ConversationViewState> = options?.view ?? { get: () => ({ legs: [], entries: [], info: null }), subscribe: () => () => {} };
  // Every case but one about `providerLoaded` itself wants a loaded provider
  // (plan 1e-3b-1 ruling 11): otherwise every canStart it checks would be
  // false for a reason unrelated to what the case is testing.
  if (options?.provider !== false) {
    runsOn('fake');
    useProviderStore.setState({
      entries: { fake: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
  }
  return { state, session: appSubtitleSession(runner, view, options) };
}

describe('appSubtitleSession', () => {
  it("reads the selected provider's readiness and pair, and the turn mode", () => {
    runsOn('fake');
    useProviderStore.setState({
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

describe('appSubtitleSession — the live start gate (Stage 2 foundation, F7)', () => {
  it('keeps Start off while the live gate refuses, and turns it back on when the mode changes', () => {
    environment.value = 'web';
    useAudioStore.setState({ mode: 'participant', selectedInputDevice: null });
    const { session } = setup();
    expect(session.get()).toMatchObject({ canStart: false, idle: { kind: 'unready', code: 'participant_source_unavailable' } });
    const listener = vi.fn();
    session.subscribe(listener);
    useAudioStore.setState({ mode: 'speaker' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.get().canStart).toBe(true);
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

describe('appSubtitleSession — the balance floor (Stage 2 Kizuna Soniox, rulings 5, 6)', () => {
  it('keeps Start off below the floor, and turns it on when the balance arrives or text only lowers the floor', () => {
    const { session } = setup();
    runsOn('fake_leased');
    useProviderStore.setState({
      entries: { fake_leased: { settings: { ...FAKE_LEASED_DEFAULTS, minimumBalanceMicroUsd: 1000 }, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 1500, frozen: false } });

    const listener = vi.fn();
    session.subscribe(listener);
    expect(session.get()).toMatchObject({ canStart: false, idle: { kind: 'unready', code: 'balance_below_floor' } });

    useSettingsStore.setState({ textOnly: true });
    expect(listener).toHaveBeenCalled();
    expect(session.get().canStart).toBe(true);

    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 500, frozen: false } });
    expect(session.get().canStart).toBe(false);

    useAccountStore.setState({ account: { status: 'unknown' } });
    expect(session.get()).toMatchObject({ idle: { kind: 'unready', code: 'quota_unknown' } });

    useAccountStore.setState({ account: { status: 'loading' } });
    expect(session.get()).toMatchObject({ idle: { kind: 'unready', code: 'quota_pending' } });
  });
});

describe('appSubtitleSession — the payer switch moves the wallet the gate checks', () => {
  it('re-evaluates Start when a member flips the switch', () => {
    const { session } = setup();
    runsOn('fake_leased');
    useProviderStore.setState({
      entries: { fake_leased: { settings: { ...FAKE_LEASED_DEFAULTS, minimumBalanceMicroUsd: 1000 }, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });
    localStorage.clear();
    useAccountStore.setState({ account: {
      status: 'known', balanceMicroUsd: 0, frozen: false,
      organization: { name: 'Acme', availableMicroUsd: 0, frozen: true }, personal: { balanceMicroUsd: 5000, frozen: false },
    } });
    expect(session.get().canStart).toBe(false);
    const listener = vi.fn();
    session.subscribe(listener);
    setUseOwnBalance(true);
    expect(listener).toHaveBeenCalled();
    expect(session.get().canStart).toBe(true);
    setUseOwnBalance(false);
    expect(session.get().canStart).toBe(false);
    localStorage.clear();
  });
});

describe('appSubtitleSession — the participant-speech switch feeds the balance floor (Stage 2 Kizuna Soniox, choice 8)', () => {
  it('re-evaluates the gate when the participant-speech switch flips, under an application source on Electron', () => {
    environment.value = 'electron';
    // A stub floor that prices the participant's speech directly (review
    // Minor 2): the leased fake's own floor does not, so it cannot show
    // that `useRoutingStore.subscribe(update)` in appSession.ts feeds the
    // recompute. Restored in `finally`.
    const original = fakeLeasedProvider.session!.minimumBalance!;
    fakeLeasedProvider.session!.minimumBalance = (shape) => (shape.participantSpeech ? 2000 : 500);
    try {
      runsOn('fake_leased');
      useProviderStore.setState({
        entries: { fake_leased: { settings: FAKE_LEASED_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      });
      useAudioStore.setState({ mode: 'speaker', selectedParticipantSource: { deviceId: 'app:1', label: 'App' } });
      useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 1000, frozen: false } });
      useRoutingStore.setState({ participantSpeech: false });

      const { session } = setup({ provider: false });
      expect(session.get().canStart).toBe(true);

      const listener = vi.fn();
      session.subscribe(listener);
      useRoutingStore.setState({ participantSpeech: true });

      expect(listener).toHaveBeenCalled();
      expect(session.get()).toMatchObject({ canStart: false, idle: { kind: 'unready', code: 'balance_below_floor' } });
    } finally {
      fakeLeasedProvider.session!.minimumBalance = original;
    }
  });
});

describe('appSubtitleSession — providerLoaded (1e-3b-1 ruling 11)', () => {
  it("keeps Start off until the selected provider's entry has loaded, then turns it back on", async () => {
    runsOn('fake');
    useProviderStore.setState({ entries: {} });
    const { session } = setup({ provider: false });
    expect(session.get().canStart).toBe(false);
    const listener = vi.fn();
    session.subscribe(listener);
    await useProviderStore.getState().load(fakeProvider);
    expect(listener).toHaveBeenCalled();
    expect(session.get().canStart).toBe(true);
  });

  it('keeps Start off while no provider is selected yet, even once the first offered provider has loaded', () => {
    offered.fakeFirst = true;
    runsOn(null);
    useProviderStore.setState({ entries: { fake: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } } } });
    const { session } = setup({ provider: false });
    expect(session.get().canStart).toBe(false);
    // The launch load selects it: Start turns on, so it was the selection that held it off.
    runsOn('fake');
    expect(session.get().canStart).toBe(true);
  });
});

describe('appSubtitleSession — every provider of the plan', () => {
  const pair = { source: 'en', target: 'ja' };
  const ready = { state: 'ready' as const, models: [] };
  const signedOut = { state: 'not-ready' as const, reason: 'Sign in first.', code: 'sign_in_required' };

  /** A plan built by hand: the fake transcribes and translates, the leased fake speaks. */
  function planTwoProviders(): void {
    const tr: PlannedUnit = { provider: fakeProvider, unit: unitsOf(fakeProvider)[0], stages: ['transcription', 'translation'] };
    const sp: PlannedUnit = { provider: fakeLeasedProvider, unit: unitsOf(fakeLeasedProvider)[0], stages: ['speech'] };
    planned.found = {
      state: 'ready',
      plan: { units: [tr, sp], byStage: { transcription: tr, translation: tr, speech: sp } },
      accounts: { fake: { settings: {}, credentials: {}, pair }, fake_leased: { settings: {}, credentials: {}, pair } },
    };
  }

  it('keeps Start off until every provider of the plan is ready, and shows the one that is not', () => {
    planTwoProviders();
    const { session } = setup();
    useProviderStore.setState({ readiness: { fake: ready, fake_leased: signedOut } });
    expect(session.get()).toMatchObject({ canStart: false, idle: { kind: 'unready', message: 'Sign in first.', code: 'sign_in_required' } });

    useProviderStore.setState({ readiness: { fake: ready, fake_leased: { state: 'checking' } } });
    expect(session.get().canStart).toBe(false);

    useProviderStore.setState({ readiness: { fake: ready, fake_leased: ready } });
    expect(session.get().canStart).toBe(true);
  });

  it("shows a provider's reason before another one's check under way", () => {
    planTwoProviders();
    const { session } = setup();
    useProviderStore.setState({ readiness: { fake: { state: 'checking' }, fake_leased: signedOut } });
    expect(session.get()).toMatchObject({ canStart: false, idle: { kind: 'unready', message: 'Sign in first.' } });
  });
});
