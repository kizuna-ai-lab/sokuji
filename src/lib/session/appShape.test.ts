import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

// appShape.ts calls getEnvironment() directly (not isElectron()): mocking
// isElectron alone would not reach it, since getEnvironment's own internal
// call to isElectron() resolves within environment.ts's module scope, not
// through this mock's exported binding.
const environment = vi.hoisted(() => ({ value: 'web' as 'web' | 'electron' | 'extension' }));
vi.mock('../../utils/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/environment')>();
  return { ...actual, getEnvironment: () => environment.value };
});

import type { AnyProvider, CheckContext } from '../provider/types';
import { createVirtualClock } from '../contract/clock';
import { createSampler } from '../screen/sampler';
import { QWEN_DEFAULTS } from '../../providers/qwen_livetranslate/settings';
import { useScreenContextStore } from '../../stores/screenContextStore';
import { providersIn } from '../plan/read';
import { planOf } from '../plan/testing';
import { capabilitiesAlone } from '../plan/wholeUnit';
import { FAKE_WHOLE, fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS, FAKE_LEASED_DEFAULTS } from '../../providers/fake/settings';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import { PALABRA_DEFAULTS } from '../../providers/palabraai/settings';
import { SONIOX_DEFAULTS } from '../../providers/soniox/settings';
import { useAccountStore } from '../../stores/accountStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { localModels } from '../../stores/localModels';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { runsOn } from '../../stores/lineUpStore.testing';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { useRoutingStore } from '../../stores/routingStore';
import { presentProviders } from '../../providers/registry';
import { appMicMuted, appParticipantSpeech, ensureReadyFromStores, faceToFaceFromStores, legsFor, lineUpNoticeFromStores, liveGate, persistIfUnchanged, planRefusalFromStores, readShapeFromStores, runPlanFromStores, screenContextWanted, speechFromStores, speechInputsFromStores, watchLegsFromStores, watchSpeechFromStores } from './appShape';
import { setUseOwnBalance } from './payerChoice';
import { gate } from './shape';
import type { RunShape } from './types';

const auth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  runsOn(null);
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
  useTurnModeStore.setState({ turnMode: 'auto' });
  useRoutingStore.setState({ participantSpeech: null });
  useAudioStore.setState({ selectedParticipantSource: useAudioStore.getInitialState().selectedParticipantSource });
  useAudioStore.setState({ isMonitorMuted: true, mode: 'speaker', otherSide: 'meeting', participantCaptureWidened: false });
  useAccountStore.setState({ account: null });
  useSettingsStore.setState({ textOnly: false });
  useScreenContextStore.setState({ sampler: null, state: null });
  environment.value = 'web';
});

describe('legsFor', () => {
  it('maps the audio mode to the legs, speaker first', () => {
    expect(legsFor('speaker')).toEqual(['speaker']);
    expect(legsFor('participant')).toEqual(['participant']);
    expect(legsFor('both')).toEqual(['speaker', 'participant']);
  });
});

// The plan a start would run and its accounts, in each state the stores can be in.
describe('runPlanFromStores', () => {
  const pair = { source: 'en', target: 'ja' };
  const entryOf = (p: AnyProvider) => ({ settings: p.settings.defaults, credentials: { apiKey: 'k' }, pair });

  it('is null while nothing has loaded', () => {
    expect(runPlanFromStores()).toBeNull();
  });

  it('is null while the line-up store has not loaded, though the first offered provider has: no fallback to it', () => {
    const first = presentProviders()[0];
    runsOn(null);
    useProviderStore.setState({ entries: { [first.id]: entryOf(first) } });
    expect(runPlanFromStores()).toBeNull();
    expect(readShapeFromStores(auth)).toBeNull();
    expect(liveGate()).toBeNull();
  });

  it('is null while the provider that runs has not loaded, whatever else has', () => {
    const first = presentProviders()[0];
    runsOn('fake');
    useProviderStore.setState({ entries: { [first.id]: entryOf(first) } });
    expect(runPlanFromStores()).toBeNull();
  });

  it("is the plan of the provider that runs, its account, and the transcription provider's entry once it has loaded", () => {
    const entry = { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair };
    runsOn('fake');
    useProviderStore.setState({ entries: { fake: entry } });
    expect(runPlanFromStores()).toEqual({ plan: planOf(fakeProvider), accounts: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' } } }, entry });
    expect(runPlanFromStores()!.entry).toBe(entry);
  });
});

describe('readShapeFromStores', () => {
  it('is null until the chosen provider has loaded', () => {
    expect(readShapeFromStores(auth)).toBeNull();
  });

  it("freezes the chosen provider's settings, credentials and pair with the global settings", () => {
    runsOn('fake');
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } } },
    });
    useAudioStore.setState({ mode: 'both' });
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    useSettingsStore.setState({ textOnly: true, keepReplayAudio: false });
    const shape = readShapeFromStores(auth)!;
    expect(shape).toMatchObject({
      plan: planOf(fakeProvider),
      accounts: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' } } },
      pair: { source: 'en', target: 'ja' },
      legs: ['speaker', 'participant'],
      turnMode: 'push-to-talk',
      textOnly: true,
      participantSpeech: false,
      keepReplayAudio: false,
      auth,
    });
    // The participant's direction is the pair's reverse; instructions are no longer the shape's (Stage 2 Gemini, ruling 4).
    expect(shape.shared.reversed({ source: 'ja', target: 'en' })).toBe(true);
    expect(shape.shared).not.toHaveProperty('instructions');
  });

  it('freezes who pays at Start: a member\'s choice, nothing for a non-member', () => {
    runsOn('fake');
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } } },
    });
    localStorage.clear();
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 9, frozen: false } });
    expect(readShapeFromStores(auth)).not.toHaveProperty('payer');
    setUseOwnBalance(true);
    expect(readShapeFromStores(auth)).not.toHaveProperty('payer');
    const member = { status: 'known' as const, balanceMicroUsd: 9, frozen: false, organization: { name: 'Acme', availableMicroUsd: 9, frozen: false }, personal: { balanceMicroUsd: 5, frozen: false } };
    useAccountStore.setState({ account: member });
    const own = readShapeFromStores(auth)!;
    expect(own.payer).toBe('personal');
    setUseOwnBalance(false);
    // The shape taken at Start keeps its payer when the switch moves afterwards.
    expect(own.payer).toBe('personal');
    expect(readShapeFromStores(auth)!.payer).toBe('organization');
    localStorage.clear();
  });

  // The one production line that turns
  // a provider's own `languages.reverse` into `SharedSettings.reversed` is
  // this call to `reversedPair`. Palabra's documented reverse of `ja →
  // en-US` is `en → ja` (Stage 2 Palabra, ruling 9), not the plain swap
  // `en-US → ja` a naive `{ source: pair.target, target: pair.source }`
  // would give.
  it("finds the participant in a provider's own reverse, not a plain swap (Stage 2 Palabra, ruling 9)", () => {
    runsOn('palabraai');
    useProviderStore.setState({
      entries: { palabraai: { settings: PALABRA_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en-US' } } },
    });
    const shape = readShapeFromStores(auth)!;
    expect(shape.shared.reversed({ source: 'en', target: 'ja' })).toBe(true);
    expect(shape.shared.reversed({ source: 'en-US', target: 'ja' })).toBe(false);
  });
});

// A stored line-up is what runs, and names the run's stages; one that is only shown names nothing about the run.
describe('readShapeFromStores — the line-up id that serves each stage', () => {
  const localEntry = { settings: LOCAL_INFERENCE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } };
  const entryOf = (id: string) => ({ settings: presentProviders().find((p) => p.id === id)!.settings.defaults, credentials: {}, pair: { source: 'en', target: 'ja' } });
  const bingAndEdge = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };
  afterEach(() => { useLineUpStore.setState({ lineUp: null, stored: false }); });

  it("freezes the stored line-up's ids: this device with Bing and Edge, three providers", () => {
    useProviderStore.setState({ entries: { local_inference: localEntry, bing: entryOf('bing'), edge: entryOf('edge') } });
    useLineUpStore.setState({ lineUp: bingAndEdge, stored: true });
    expect(readShapeFromStores(auth)!.lineUp).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
    expect(readShapeFromStores(auth)!.lineUpStored).toBe(true);
  });

  it('freezes the running provider on every stage while no line-up is stored', () => {
    runsOn('fake');
    useProviderStore.setState({ entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } } } });
    useLineUpStore.setState({ lineUp: bingAndEdge, stored: false });
    expect(readShapeFromStores(auth)!.lineUp).toEqual({ transcription: 'fake', translation: 'fake', speech: 'fake' });
    // Not the stored one: the ids say nothing of Bing or Edge, and a builder is handed none of them.
    expect(readShapeFromStores(auth)!.lineUpStored).toBe(false);
  });

  it('freezes the line-up the settings show where this device runs while no line-up is stored', () => {
    useProviderStore.setState({ entries: { local_inference: localEntry, bing: entryOf('bing'), edge: entryOf('edge') } });
    useLineUpStore.setState({ lineUp: bingAndEdge, stored: false, unstoredProvider: 'local_inference' });
    const shape = readShapeFromStores(auth)!;
    expect(shape.lineUp).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
    expect(shape.lineUpStored).toBe(true);
    expect(providersIn(shape.plan).map((p) => p.id)).toEqual(['local_inference', 'bing', 'edge']);
  });

  // The line-up shown where this device runs is the one that runs before one is stored: a refusal of it names its option,
  // as a stored one's does (a split names the option the stage goes with, which only the line-up tells).
  it("a refusal of the line-up shown where this device runs names that line-up's option, as a stored one's does", () => {
    const gemini = { settings: presentProviders().find((p) => p.id === 'gemini')!.settings.defaults, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } };
    useProviderStore.setState({ entries: { local_inference: localEntry, gemini, edge: entryOf('edge') } });
    const split = { transcription: 'local_inference', translation: 'gemini', speech: 'edge', summarisation: null };
    const refusal = { code: 'lineup_stage_split', params: { stage: 'transcription', provider: 'gemini' } };
    useLineUpStore.setState({ lineUp: split, stored: false, unstoredProvider: 'local_inference' });
    expect(planRefusalFromStores()).toMatchObject(refusal);
    expect(lineUpNoticeFromStores()).toMatchObject({ ...refusal, stage: 'transcription' });
    useLineUpStore.setState({ lineUp: split, stored: true, unstoredProvider: null });
    expect(planRefusalFromStores()).toMatchObject(refusal);
  });

  it('freezes the stored line-up, not the provider that ran before it was stored', () => {
    runsOn('fake');
    useProviderStore.setState({ entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } }, local_inference: localEntry, bing: entryOf('bing'), edge: entryOf('edge') } });
    useLineUpStore.setState({ lineUp: bingAndEdge, stored: true });
    const shape = readShapeFromStores(auth)!;
    expect(shape.lineUp).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
    expect(shape.lineUpStored).toBe(true);
    expect(providersIn(shape.plan).map((p) => p.id)).toEqual(['local_inference', 'bing', 'edge']);
    expect(Object.keys(shape.accounts)).toEqual(['local_inference', 'bing', 'edge']);
  });

  it("freezes a stored line-up of two providers: both units, both accounts, the line-up's ids", () => {
    const sonioxEntry = { settings: SONIOX_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } };
    useProviderStore.setState({ entries: { soniox: sonioxEntry, edge: entryOf('edge') } });
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null }, stored: true, unstoredProvider: null });
    const shape = readShapeFromStores(auth)!;
    expect(shape.plan.units.map((u) => [u.provider.id, u.stages])).toEqual([['soniox', ['transcription', 'translation']], ['edge', ['speech']]]);
    expect(shape.accounts).toEqual({
      soniox: { settings: SONIOX_DEFAULTS, credentials: { apiKey: 'k' } },
      edge: { settings: presentProviders().find((p) => p.id === 'edge')!.settings.defaults, credentials: {} },
    });
    expect(shape.lineUp).toEqual({ transcription: 'soniox', translation: 'soniox', speech: 'edge' });
    expect(shape.lineUpStored).toBe(true);
    // The run's pair is the transcription provider's.
    expect(shape.pair).toEqual(sonioxEntry.pair);
  });

  it("a stored line-up the composer refuses gives no shape, and the start gate says the composer's reason", () => {
    useProviderStore.setState({ entries: { local_inference: localEntry } });
    useLineUpStore.setState({ lineUp: { ...bingAndEdge, speech: null }, stored: true, unstoredProvider: null });
    expect(readShapeFromStores(auth)).toBeNull();
    expect(liveGate()).toEqual({ code: 'lineup_incomplete', message: 'The line-up names no provider for speech.', params: { stage: 'speech' } });
    // A provider this build does not offer here.
    useLineUpStore.setState({ lineUp: { transcription: 'later_provider', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    expect(liveGate()).toMatchObject({ code: 'lineup_incomplete', params: { stage: 'transcription' } });
  });

  describe('a line-up that cannot run says why, wherever Start can be pressed', () => {
    const entries = (pair: { source: string; target: string }) => ({
      soniox: { settings: SONIOX_DEFAULTS, credentials: { apiKey: 'k' }, pair },
      kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair },
      gemini: { settings: presentProviders().find((p) => p.id === 'gemini')!.settings.defaults, credentials: { apiKey: 'k' }, pair },
      local_inference: localEntry,
      bing: { settings: presentProviders().find((p) => p.id === 'bing')!.settings.defaults, credentials: {}, pair },
      edge: { settings: presentProviders().find((p) => p.id === 'edge')!.settings.defaults, credentials: {}, pair },
    });
    const stored = (transcription: string, speech: string) =>
      useLineUpStore.setState({ lineUp: { transcription, translation: transcription, speech, summarisation: null }, stored: true, unstoredProvider: null });

    it("Kizuna AI's Soniox voice under own-key Soniox text runs: nothing about the line-up is refused, and the wallet is held to the voice's own floor", () => {
      useProviderStore.setState({ entries: entries({ source: 'en', target: 'ja' }) });
      stored('soniox', 'kizunaai_soniox');
      environment.value = 'electron';
      const shape = readShapeFromStores(auth)!;
      expect(providersIn(shape.plan).map((p) => p.id)).toEqual(['soniox', 'kizunaai_soniox']);
      expect(shape.lineUp).toEqual({ transcription: 'soniox', translation: 'soniox', speech: 'kizunaai_soniox' });
      expect(planRefusalFromStores()).toBeNull();
      expect(lineUpNoticeFromStores()).toBeNull();
      // Signed out, no wallet is known: the gate says nothing, and the start's sign-in check speaks.
      expect(liveGate()).toBeNull();
      // Signed in: the wallet is checked though the text runs on the user's own key, against the floor of the
      // speech stream alone (4 167), not a whole speaking session's (12 500).
      const wallet = (balanceMicroUsd: number) => useAccountStore.setState({ account: { status: 'known', balanceMicroUsd, frozen: false } });
      wallet(4_166);
      expect(liveGate()).toMatchObject({ code: 'balance_below_floor', params: { balance: '$0.004166' } });
      expect(gate(readShapeFromStores(auth)!, 'electron')).toMatchObject({ code: 'balance_below_floor' });
      wallet(4_167);
      expect(liveGate()).toBeNull();
      useAccountStore.setState({ account: { status: 'loading' } });
      expect(liveGate()?.code).toBe('quota_pending');
      useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 1_000_000, frozen: true } });
      expect(liveGate()?.code).toBe('wallet_frozen');
      // Text only: no voice is leased, and no balance is asked.
      wallet(0);
      useSettingsStore.setState({ textOnly: true });
      expect(liveGate()).toBeNull();
    });

    it("Kizuna AI's Qwen text under Kizuna AI's Soniox voice: it takes no other voice, so the two hosted services never run together", () => {
      useProviderStore.setState({ entries: { ...entries({ source: 'en', target: 'ja' }), kizunaai_qwen: { settings: QWEN_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } } });
      stored('kizunaai_qwen', 'kizunaai_soniox');
      environment.value = 'electron';
      expect(readShapeFromStores(auth)).toBeNull();
      const refusal = { code: 'lineup_voice_not_taken', params: { stage: 'speech', provider: 'kizunaai_qwen' } };
      expect(liveGate()).toMatchObject(refusal);
      expect(planRefusalFromStores()).toEqual(liveGate());
      expect(lineUpNoticeFromStores()).toMatchObject({ ...refusal, stage: 'speech' });
    });

    it("an end-to-end provider's text under Edge: it takes no other voice", () => {
      useProviderStore.setState({ entries: entries({ source: 'en', target: 'ja' }) });
      stored('gemini', 'edge');
      expect(liveGate()).toMatchObject({ code: 'lineup_voice_not_taken', params: { stage: 'speech', provider: 'gemini' } });
    });

    it("an end-to-end provider's voice under Soniox text: its stages go together", () => {
      useProviderStore.setState({ entries: entries({ source: 'en', target: 'ja' }) });
      stored('soniox', 'gemini');
      expect(liveGate()).toMatchObject({ code: 'lineup_stage_split', params: { stage: 'transcription', provider: 'gemini' } });
    });

    it('Edge under Soniox text, into a language Edge has no voice for: said before anything connects', () => {
      // Basque: Soniox translates into it, Edge does not speak it.
      useProviderStore.setState({ entries: entries({ source: 'en', target: 'eu' }) });
      stored('soniox', 'edge');
      const refusal = { code: 'lineup_language_not_spoken', params: { stage: 'speech', provider: 'edge', language: 'eu' } };
      expect(liveGate()).toMatchObject(refusal);
      expect(lineUpNoticeFromStores()).toMatchObject({ ...refusal, stage: 'speech' });
      // The plan composes: the runner's gate refuses the frozen shape with the same code.
      expect(planRefusalFromStores()).toBeNull();
      expect(gate(readShapeFromStores(auth)!, 'electron')).toMatchObject(refusal);
      // Text only: nothing is read aloud, and the session may start.
      useSettingsStore.setState({ textOnly: true });
      expect(liveGate()).toBeNull();
      expect(lineUpNoticeFromStores()).toBeNull();
    });

    it('Edge under Soniox text, into a language Edge speaks: nothing is refused', () => {
      useProviderStore.setState({ entries: entries({ source: 'en', target: 'ja' }) });
      stored('soniox', 'edge');
      expect(liveGate()).toBeNull();
      expect(planRefusalFromStores()).toBeNull();
      expect(lineUpNoticeFromStores()).toBeNull();
    });
  });
});

describe('readShapeFromStores — the screen context source (spec 2026-10-22 §4)', () => {
  const qwen = (screenContext: boolean) => ({
    settings: { ...QWEN_DEFAULTS, screenContext }, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' },
  });

  it("carries the store's sampler source as frames while screen context is wanted, and no key without a sampler", () => {
    environment.value = 'electron';
    runsOn('qwen_livetranslate');
    useProviderStore.setState({ entries: { qwen_livetranslate: qwen(true) } });
    expect('frames' in readShapeFromStores(auth)!).toBe(false);
    const sampler = createSampler(createVirtualClock(0));
    useScreenContextStore.getState().set(sampler);
    expect(readShapeFromStores(auth)!.frames).toBe(sampler.source);
    sampler.close();
  });

  it('gives no frames from a sampler still in the store once the switch is off or another provider is selected', () => {
    environment.value = 'electron';
    const sampler = createSampler(createVirtualClock(0));
    useScreenContextStore.getState().set(sampler);
    runsOn('qwen_livetranslate');
    useProviderStore.setState({ entries: { qwen_livetranslate: qwen(false) } });
    expect('frames' in readShapeFromStores(auth)!).toBe(false);
    runsOn('fake');
    useProviderStore.setState({
      entries: { qwen_livetranslate: qwen(true), fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } } },
    });
    expect('frames' in readShapeFromStores(auth)!).toBe(false);
    sampler.close();
  });
});

describe('screenContextWanted', () => {
  const qwen = (screenContext: boolean) => ({
    settings: { ...QWEN_DEFAULTS, screenContext }, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' },
  });

  it('is on only while a Qwen provider is the one a start would run, with its switch on', () => {
    environment.value = 'electron';
    runsOn('qwen_livetranslate');
    useProviderStore.setState({ entries: { qwen_livetranslate: qwen(false) } });
    expect(screenContextWanted()).toBe(false);
    useProviderStore.setState({ entries: { qwen_livetranslate: qwen(true) } });
    expect(screenContextWanted()).toBe(true);
    runsOn('kizunaai_qwen');
    useProviderStore.setState({ entries: { kizunaai_qwen: qwen(true) } });
    expect(screenContextWanted()).toBe(true);
    // Another provider, whatever a Qwen slice says.
    runsOn('fake');
    useProviderStore.setState({
      entries: { qwen_livetranslate: qwen(true), fake: { settings: { ...FAKE_DEFAULTS, screenContext: true } as never, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } } },
    });
    expect(screenContextWanted()).toBe(false);
  });

  it('is off where Qwen is not offered: a start there runs another provider', () => {
    environment.value = 'web';
    runsOn('qwen_livetranslate');
    useProviderStore.setState({ entries: { qwen_livetranslate: qwen(true) } });
    expect(screenContextWanted()).toBe(false);
  });
});

describe("readShapeFromStores — the account's wallet (Stage 2 Kizuna Soniox, rulings 5, 6)", () => {
  it("freezes the account's wallet", () => {
    runsOn('fake');
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 7, frozen: false } });
    expect(readShapeFromStores(auth)?.account).toEqual({ status: 'known', balanceMicroUsd: 7, frozen: false });
    useAccountStore.setState({ account: { status: 'unknown' } });
    expect(readShapeFromStores(auth)?.account).toEqual({ status: 'unknown' });
    useAccountStore.setState({ account: null });
    expect(readShapeFromStores(auth)?.account).toBeNull();
  });
});

describe('persistIfUnchanged', () => {
  it('writes only the fields the user has not changed since the run froze them', async () => {
    const snapshot = FAKE_DEFAULTS;
    useProviderStore.setState({
      entries: { fake: { settings: { ...FAKE_DEFAULTS, startDelayMs: 900 }, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    persistIfUnchanged(fakeProvider, snapshot, { script: 'long', startDelayMs: 100 });
    expect(useProviderStore.getState().entries.fake.settings).toMatchObject({ script: 'long', startDelayMs: 900 });
  });
});

describe('readShapeFromStores', () => {
  it('freezes the participant-TTS switch', () => {
    runsOn('fake');
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useRoutingStore.setState({ participantSpeech: true });
    expect(readShapeFromStores(auth)?.participantSpeech).toBe(true);
  });
});

// 1e-3b-2 ruling 7, completed (final-review Important 1): the run's shape
// must follow the same whole-system rule the switch and `readRouting` do, or
// LocalInference loads Other's TTS model and MainPanel offers a replay slot
// for a leg the switch shows off.
describe("readShapeFromStores — participant speech follows the whole-system rule", () => {
  beforeEach(() => {
    runsOn('fake');
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useRoutingStore.setState({ participantSpeech: true });
  });

  it('is off, live, while the application capture has widened to the whole system (slice 1 final review, Important 2)', () => {
    environment.value = 'electron';
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: { deviceId: 'app:42', label: 'App' }, participantCaptureWidened: true });
    expect(speechFromStores(capabilitiesAlone(fakeProvider, 'speech')).them).toBe(false);
    expect(speechInputsFromStores().participantSpeech).toBe(false);
    useAudioStore.setState({ participantCaptureWidened: false });
    expect(speechFromStores(capabilitiesAlone(fakeProvider, 'speech')).them).toBe(true);
  });

  it('is off on Electron under a whole-system participant source', () => {
    environment.value = 'electron';
    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' } });
    expect(readShapeFromStores(auth)?.participantSpeech).toBe(false);
  });

  it('is on on Electron once an application source is chosen', () => {
    environment.value = 'electron';
    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'app:42', label: 'App' } });
    expect(readShapeFromStores(auth)?.participantSpeech).toBe(true);
  });

  it('is on off Electron whatever the source', () => {
    environment.value = 'web';
    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' } });
    expect(readShapeFromStores(auth)?.participantSpeech).toBe(true);
  });

  it("is off while the provider's flag is off, and follows the switch once it is on", () => {
    environment.value = 'web';
    try {
      Object.assign(FAKE_WHOLE, { participantSpeech: false });
      expect(readShapeFromStores(auth)?.participantSpeech).toBe(false);
      Object.assign(FAKE_WHOLE, { participantSpeech: true });
      expect(readShapeFromStores(auth)?.participantSpeech).toBe(true);
    } finally {
      delete (FAKE_WHOLE as { participantSpeech?: boolean }).participantSpeech;
    }
  });

  it('speechFromStores is the shape\'s own answer', () => {
    expect(speechFromStores({ speech: 'optional', participantSpeech: false }).them).toBe(false);
    expect(speechFromStores({ speech: 'optional' }).them).toBe(readShapeFromStores(auth)?.participantSpeech);
    useRoutingStore.setState({ participantSpeech: false });
    expect(speechFromStores({ speech: 'optional' }).them).toBe(readShapeFromStores(auth)?.participantSpeech);
  });
});

describe('ensureReadyFromStores', () => {
  it("checks the shape's own settings, credentials, pair and legs, with the run's signal", async () => {
    const check = vi.fn(async (_k: unknown, _s: unknown, _ctx: CheckContext) => ({ ok: true as const }));
    // A local kind: nothing cached from another test answers for it.
    const provider = { ...fakeProvider, kind: 'local', check } as unknown as AnyProvider;
    const settings = { ...FAKE_DEFAULTS };
    const shape = {
      plan: planOf(provider), accounts: { fake: { settings, credentials: {} } }, pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'], auth,
    } as unknown as RunShape;
    const signal = new AbortController().signal;
    await expect(ensureReadyFromStores(provider, shape, signal)).resolves.toEqual({ state: 'ready', models: [] });
    expect(check).toHaveBeenCalledWith(expect.anything(), settings, { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'], localModels, signal });
  });

  it('tells each provider the stages it serves in the plan, when they are not all it can serve', async () => {
    const asked: Record<string, CheckContext['stages']> = {};
    const probe = (id: string) => ({ ...fakeProvider, id, kind: 'local', check: vi.fn(async (_k: unknown, _s: unknown, ctx: CheckContext) => { asked[id] = ctx.stages; return { ok: true as const }; }) }) as unknown as AnyProvider;
    const [text, voice] = [probe('text'), probe('voice')];
    const a = { ...planOf(text).units[0], stages: ['transcription', 'translation'] as const };
    const b = { ...planOf(voice).units[0], stages: ['speech'] as const };
    const shape = {
      plan: { units: [a, b], byStage: { transcription: a, translation: a, speech: b } },
      accounts: { text: { settings: {}, credentials: {} }, voice: { settings: {}, credentials: {} } },
      pair: { source: 'ja', target: 'en' }, legs: ['speaker'], auth,
    } as unknown as RunShape;
    const signal = new AbortController().signal;
    await ensureReadyFromStores(text, shape, signal);
    await ensureReadyFromStores(voice, shape, signal);
    expect(asked).toEqual({ text: ['transcription', 'translation'], voice: ['speech'] });
  });

  it("tells it no ids of the line-up, whether the run runs a stored one or not", async () => {
    const asked: Array<CheckContext> = [];
    const probe = (id: string) => ({ ...fakeProvider, id, kind: 'local', check: vi.fn(async (_k: unknown, _s: unknown, ctx: CheckContext) => { asked.push(ctx); return { ok: true as const }; }) }) as unknown as AnyProvider;
    const [text, voice] = [probe('text'), probe('voice')];
    const a = { ...planOf(text).units[0], stages: ['transcription', 'translation'] as const };
    const b = { ...planOf(voice).units[0], stages: ['speech'] as const };
    const shape = {
      plan: { units: [a, b], byStage: { transcription: a, translation: a, speech: b } },
      accounts: { text: { settings: {}, credentials: {} }, voice: { settings: {}, credentials: {} } },
      lineUp: { transcription: 'text', translation: 'bing', speech: 'voice' }, lineUpStored: true,
      pair: { source: 'ja', target: 'en' }, legs: ['speaker'], auth,
    } as unknown as RunShape;
    const signal = new AbortController().signal;
    await ensureReadyFromStores(text, shape, signal);
    await ensureReadyFromStores(voice, shape, signal);
    expect(asked.map((ctx) => ctx.stages)).toEqual([['transcription', 'translation'], ['speech']]);
    for (const ctx of asked) expect(ctx).not.toHaveProperty('stageIds');
  });
});

describe('watchLegsFromStores', () => {
  it("keeps the provider store's legs on the audio mode's, now and on every change, until unsubscribed", () => {
    useAudioStore.setState({ mode: 'participant' });
    const unwatch = watchLegsFromStores();
    expect(useProviderStore.getState().legs).toEqual(['participant']);
    useAudioStore.setState({ mode: 'both' });
    expect(useProviderStore.getState().legs).toEqual(['speaker', 'participant']);
    unwatch();
    useAudioStore.setState({ mode: 'speaker' });
    expect(useProviderStore.getState().legs).toEqual(['speaker', 'participant']);
  });
});

describe('speechInputsFromStores and watchSpeechFromStores (Stage 2 Volcengine AST2, choice 1)', () => {
  it("reads the text-only switch and the participant's speech: its switch, and a source that will not recapture it", () => {
    expect(speechInputsFromStores()).toEqual({ textOnly: false, participantSpeech: false });
    expect(speechFromStores({ speech: 'optional' }).them).toBe(false);
    useSettingsStore.setState({ textOnly: true });
    useRoutingStore.setState({ participantSpeech: true });
    expect(speechInputsFromStores()).toEqual({ textOnly: true, participantSpeech: true });
    environment.value = 'electron';
    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' } });
    expect(speechInputsFromStores().participantSpeech).toBe(false);
    expect(speechFromStores({ speech: 'optional' }).them).toBe(false);
  });

  it("keeps the provider store's speech inputs on the stores', now and on every change, until unsubscribed", () => {
    useSettingsStore.setState({ textOnly: true });
    const unwatch = watchSpeechFromStores();
    expect(useProviderStore.getState().speech).toEqual({ textOnly: true, participantSpeech: false });
    useSettingsStore.setState({ textOnly: false });
    useRoutingStore.setState({ participantSpeech: true });
    expect(useProviderStore.getState().speech).toEqual({ textOnly: false, participantSpeech: true });
    // A source that would recapture the participant's speech reaches the store through the audio store alone.
    environment.value = 'electron';
    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'desktop-audio-loopback', label: 'System' } });
    expect(useProviderStore.getState().speech.participantSpeech).toBe(false);
    unwatch();
    useSettingsStore.setState({ textOnly: true });
    expect(useProviderStore.getState().speech).toEqual({ textOnly: false, participantSpeech: false });
  });

  it("keeps who speaks for each provider of the plan: the speech unit's rules, and none until the plan is ready", () => {
    runsOn('soniox');
    useProviderStore.setState({ entries: {}, speakers: {} });
    const unwatch = watchSpeechFromStores();
    expect(useProviderStore.getState().speakers).toEqual({});
    useProviderStore.setState({ entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } } });
    expect(useProviderStore.getState().speakers).toEqual({ soniox: { speech: 'optional', participantSpeech: true } });
    unwatch();
  });

  it("in a plan of two providers, only the one that serves speech speaks: the one it reads is asked its text offer", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null }, stored: true, unstoredProvider: null });
    const pair = { source: 'ja', target: 'en' };
    useProviderStore.setState({ entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair }, edge: { settings: presentProviders().find((p) => p.id === 'edge')!.settings.defaults, credentials: {}, pair } }, speakers: {} });
    const unwatch = watchSpeechFromStores();
    const { speakers } = useProviderStore.getState();
    expect(Object.keys(speakers).sort()).toEqual(['edge', 'soniox']);
    expect(speakers.soniox).toEqual({ speech: 'never' });
    expect(speakers.edge.speech).not.toBe('never');
    unwatch();
    useLineUpStore.setState({ lineUp: null, stored: false });
  });

  it("follows face-to-face when the picked provider's entry loads after the pick", () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    runsOn('soniox');
    useProviderStore.setState({ entries: {} });
    const unwatch = watchSpeechFromStores();
    expect(useProviderStore.getState().speech.participantSpeech).toBe(false);
    useProviderStore.setState({ entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } } });
    expect(useProviderStore.getState().speech.participantSpeech).toBe(true);
    unwatch();
  });
});

// Stage 2 foundation, F7: the runner's start gate over the stores as they
// stand, so the surfaces keep Start off and say why before it is pressed.
describe('liveGate', () => {
  const loadFake = (pair: { source: string; target: string }) => {
    runsOn('fake');
    useProviderStore.setState({ entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair } } });
  };

  it('is null until the chosen provider has loaded', () => {
    // A shape the gate refuses once loaded (the participant leg on the web):
    // only the missing entry can explain the null.
    useAudioStore.setState({ mode: 'participant' });
    environment.value = 'web';
    runsOn('fake');
    useProviderStore.setState({ entries: {} });
    expect(liveGate()).toBeNull();
    loadFake({ source: 'en', target: 'ja' });
    expect(liveGate()?.code).toBe('participant_source_unavailable');
  });

  it('refuses the participant leg on the web, and lets it through on Electron', () => {
    loadFake({ source: 'en', target: 'ja' });
    useAudioStore.setState({ mode: 'participant' });
    environment.value = 'web';
    expect(liveGate()?.code).toBe('participant_source_unavailable');
    environment.value = 'electron';
    expect(liveGate()).toBeNull();
  });

  it('refuses a pair that does not reverse, for the participant leg (D20)', () => {
    loadFake({ source: 'auto', target: 'en' });
    useAudioStore.setState({ mode: 'both' });
    environment.value = 'electron';
    expect(liveGate()?.code).toBe('participant_unsupported');
  });

  it('reads the speaker-only mode as nothing to refuse', () => {
    loadFake({ source: 'en', target: 'ja' });
    useAudioStore.setState({ mode: 'speaker' });
    environment.value = 'web';
    expect(liveGate()).toBeNull();
  });

  it("refuses below the selected provider's floor, reading text only and the wallet from their stores", () => {
    runsOn('fake_leased');
    useProviderStore.setState({
      entries: { fake_leased: { settings: { ...FAKE_LEASED_DEFAULTS, minimumBalanceMicroUsd: 1000 }, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });
    environment.value = 'electron';
    // The speaker speaks: floor is twice the knob.
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 1500, frozen: false } });
    expect(liveGate()?.code).toBe('balance_below_floor');
    useSettingsStore.setState({ textOnly: true });
    expect(liveGate()).toBeNull();
    useAccountStore.setState({ account: { status: 'loading' } });
    expect(liveGate()?.code).toBe('quota_pending');
    useAccountStore.setState({ account: { status: 'unknown' } });
    expect(liveGate()?.code).toBe('quota_unknown');
    useAccountStore.setState({ account: null });
    expect(liveGate()).toBeNull();
  });
});

describe('liveGate for an organization payer', () => {
  const member = (organization: { availableMicroUsd: number; frozen: boolean }) => ({
    status: 'known' as const, balanceMicroUsd: organization.availableMicroUsd, frozen: organization.frozen,
    organization: { name: 'Acme', ...organization }, personal: { balanceMicroUsd: 0, frozen: false },
  });
  beforeEach(() => {
    localStorage.clear();
    runsOn('fake_leased');
    useProviderStore.setState({
      entries: { fake_leased: { settings: { ...FAKE_LEASED_DEFAULTS, minimumBalanceMicroUsd: 1000 }, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });
    environment.value = 'electron';
  });

  it('leaves Start enabled below the floor, and disables it only while the organization is frozen', () => {
    useAccountStore.setState({ account: member({ availableMicroUsd: 0, frozen: false }) });
    expect(liveGate()).toBeNull();
    useAccountStore.setState({ account: member({ availableMicroUsd: 0, frozen: true }) });
    expect(liveGate()?.code).toBe('org_wallet_frozen');
  });
});

describe('face-to-face from the stores', () => {
  const pick = (id: string) => {
    runsOn(id);
    useProviderStore.setState({ entries: { [id]: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } } });
  };
  beforeEach(() => useAudioStore.setState({ otherSide: 'meeting' }));

  it('is on only for Both, beside me, under a provider that offers it', () => {
    pick('soniox');
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    expect(faceToFaceFromStores()).toBe(true);
    useAudioStore.setState({ mode: 'speaker' });
    expect(faceToFaceFromStores()).toBe(false);
    useAudioStore.setState({ mode: 'both', otherSide: 'meeting' });
    expect(faceToFaceFromStores()).toBe(false);
  });

  it('is off under a provider that does not offer it, whatever is stored (Review Focus 1)', () => {
    pick('openai');
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    expect(faceToFaceFromStores()).toBe(false);
  });

  it('voices the participant on auto in face-to-face, and only by the switch in a meeting (ruling 1)', () => {
    pick('soniox');
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ participantSpeech: null });
    expect(speechFromStores({ speech: 'optional' }).them).toBe(true);
    expect(speechInputsFromStores().participantSpeech).toBe(true);
    useRoutingStore.setState({ participantSpeech: false });
    expect(speechFromStores({ speech: 'optional' }).them).toBe(false);
    useAudioStore.setState({ otherSide: 'meeting' });
    useRoutingStore.setState({ participantSpeech: null });
    expect(speechFromStores({ speech: 'optional' }).them).toBe(false);
    // A provider whose participant never speaks stays silent everywhere.
    useAudioStore.setState({ otherSide: 'beside' });
    expect(speechFromStores({ speech: 'optional', participantSpeech: false }).them).toBe(false);
  });

  it('speechFromStores reads the selected provider by default, and treats none as optional', () => {
    useSettingsStore.setState({ textOnly: true });
    expect(speechFromStores().other).toBe(false);
    useSettingsStore.setState({ textOnly: false });
    expect(speechFromStores().other).toBe(true);
  });
});

describe('appParticipantSpeech — Translation I hear, live for the runner (#595)', () => {
  beforeEach(() => {
    environment.value = 'web';
    runsOn('fake');
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useRoutingStore.setState({ participantSpeech: true });
    useAudioStore.setState({ mode: 'participant' });
  });

  it('reads the switch as the shape does, and tells only of a change', () => {
    const heard: boolean[] = [];
    const off = appParticipantSpeech.subscribe(() => heard.push(appParticipantSpeech.get()));
    expect(appParticipantSpeech.get()).toBe(true);
    useRoutingStore.setState({ participantSpeech: false });
    useRoutingStore.setState({ participantSpeech: false });
    useAudioStore.setState({ isMonitorMuted: false });
    useRoutingStore.setState({ participantSpeech: true });
    off();
    useRoutingStore.setState({ participantSpeech: false });
    expect(heard).toEqual([false, true]);
  });

  it('turns off with a capture that widened to the whole system', () => {
    environment.value = 'electron';
    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'app:42', label: 'App' } });
    const heard: boolean[] = [];
    const off = appParticipantSpeech.subscribe(() => heard.push(appParticipantSpeech.get()));
    useAudioStore.setState({ participantCaptureWidened: true });
    off();
    expect(heard).toEqual([false]);
  });
});

it('appMicMuted reads the microphone mute as it stands', () => {
  useAudioStore.setState({ isMicMuted: true });
  expect(appMicMuted.get()).toBe(true);
  useAudioStore.setState({ isMicMuted: false });
  expect(appMicMuted.get()).toBe(false);
});
