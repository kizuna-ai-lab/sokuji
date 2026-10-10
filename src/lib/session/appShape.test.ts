import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS, FAKE_LEASED_DEFAULTS } from '../../providers/fake/settings';
import { PALABRA_DEFAULTS } from '../../providers/palabraai/settings';
import { SONIOX_DEFAULTS } from '../../providers/soniox/settings';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { useRoutingStore } from '../../stores/routingStore';
import { ensureReadyFromStores, faceToFaceFromStores, legsFor, liveGate, persistIfUnchanged, readShapeFromStores, speechFromStores, speechInputsFromStores, watchLegsFromStores, watchSpeechFromStores } from './appShape';
import type { RunShape } from './types';

const auth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, selected: null, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
  useTurnModeStore.setState({ turnMode: 'auto' });
  useRoutingStore.setState({ participantSpeech: null });
  useAudioStore.setState({ selectedParticipantSource: useAudioStore.getInitialState().selectedParticipantSource });
  useAudioStore.setState({ isMonitorMuted: true, mode: 'speaker', otherSide: 'meeting', participantCaptureWidened: false });
  useAccountStore.setState({ account: null });
  useSettingsStore.setState({ textOnly: false });
  environment.value = 'web';
});

describe('legsFor', () => {
  it('maps the audio mode to the legs, speaker first', () => {
    expect(legsFor('speaker')).toEqual(['speaker']);
    expect(legsFor('participant')).toEqual(['participant']);
    expect(legsFor('both')).toEqual(['speaker', 'participant']);
  });
});

describe('readShapeFromStores', () => {
  it('is null until the chosen provider has loaded', () => {
    expect(readShapeFromStores(auth)).toBeNull();
  });

  it("freezes the chosen provider's settings, credentials and pair with the global settings", () => {
    useProviderStore.setState({
      selected: 'fake',
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } } },
    });
    useAudioStore.setState({ mode: 'both' });
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    useSettingsStore.setState({ textOnly: true, keepReplayAudio: false });
    const shape = readShapeFromStores(auth)!;
    expect(shape).toMatchObject({
      provider: fakeProvider,
      settings: FAKE_DEFAULTS,
      credentials: { apiKey: 'k' },
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

  // The one production line that turns
  // a provider's own `languages.reverse` into `SharedSettings.reversed` is
  // this call to `reversedPair`. Palabra's documented reverse of `ja →
  // en-US` is `en → ja` (Stage 2 Palabra, ruling 9), not the plain swap
  // `en-US → ja` a naive `{ source: pair.target, target: pair.source }`
  // would give.
  it("finds the participant in a provider's own reverse, not a plain swap (Stage 2 Palabra, ruling 9)", () => {
    useProviderStore.setState({
      selected: 'palabraai',
      entries: { palabraai: { settings: PALABRA_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en-US' } } },
    });
    const shape = readShapeFromStores(auth)!;
    expect(shape.shared.reversed({ source: 'en', target: 'ja' })).toBe(true);
    expect(shape.shared.reversed({ source: 'en-US', target: 'ja' })).toBe(false);
  });
});

describe("readShapeFromStores — the account's wallet (Stage 2 Kizuna Soniox, rulings 5, 6)", () => {
  it("freezes the account's wallet", () => {
    useProviderStore.setState({
      selected: 'fake',
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
    useProviderStore.setState({
      selected: 'fake',
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
    useProviderStore.setState({
      selected: 'fake',
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useRoutingStore.setState({ participantSpeech: true });
  });

  it('is off, live, while the application capture has widened to the whole system (slice 1 final review, Important 2)', () => {
    environment.value = 'electron';
    useAudioStore.setState({ mode: 'both', selectedParticipantSource: { deviceId: 'app:42', label: 'App' }, participantCaptureWidened: true });
    expect(speechFromStores(fakeProvider).them).toBe(false);
    expect(speechInputsFromStores().participantSpeech).toBe(false);
    useAudioStore.setState({ participantCaptureWidened: false });
    expect(speechFromStores(fakeProvider).them).toBe(true);
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
      Object.assign(fakeProvider, { participantSpeech: false });
      expect(readShapeFromStores(auth)?.participantSpeech).toBe(false);
      Object.assign(fakeProvider, { participantSpeech: true });
      expect(readShapeFromStores(auth)?.participantSpeech).toBe(true);
    } finally {
      delete (fakeProvider as { participantSpeech?: boolean }).participantSpeech;
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
      provider, settings, credentials: {}, pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'], auth,
    } as unknown as RunShape;
    const signal = new AbortController().signal;
    await expect(ensureReadyFromStores(shape, signal)).resolves.toEqual({ state: 'ready', models: [] });
    expect(check).toHaveBeenCalledWith(expect.anything(), settings, { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'], signal });
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

  it("follows face-to-face when the picked provider's entry loads after the pick", () => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useProviderStore.setState({ selected: 'soniox', entries: {} });
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
  const loadFake = (pair: { source: string; target: string }) => useProviderStore.setState({
    selected: 'fake',
    entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair } },
  });

  it('is null until the chosen provider has loaded', () => {
    // A shape the gate refuses once loaded (the participant leg on the web):
    // only the missing entry can explain the null.
    useAudioStore.setState({ mode: 'participant' });
    environment.value = 'web';
    useProviderStore.setState({ selected: 'fake', entries: {} });
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
    useProviderStore.setState({
      selected: 'fake_leased',
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

describe('face-to-face from the stores', () => {
  const pick = (selected: string) => useProviderStore.setState({
    selected,
    entries: { [selected]: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } },
  });
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
