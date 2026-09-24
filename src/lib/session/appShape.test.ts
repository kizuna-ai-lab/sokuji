import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import type { AnyProvider, CheckContext } from '../provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { useRoutingStore } from '../../stores/routingStore';
import { ensureReadyFromStores, legsFor, persistIfUnchanged, readShapeFromStores, watchLegsFromStores } from './appShape';
import type { RunShape } from './types';

const auth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, legs: ['speaker'] });
  useTurnModeStore.setState({ turnMode: 'auto' });
  useRoutingStore.setState({ participantSpeech: false });
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
    useSettingsStore.setState({ textOnly: true, keepReplayAudio: false, useTemplateMode: false, systemInstructions: 'mine', participantSystemInstructions: '' });
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
    expect(shape.shared.instructions({ source: 'ja', target: 'en' })).toBe('mine');
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
