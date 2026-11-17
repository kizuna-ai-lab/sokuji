import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

import { selectedFromStores } from '../../lib/session/appShape';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import { SONIOX_DEFAULTS } from '../../providers/soniox/settings';
import { useProviderStore } from '../../stores/providerStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { openLocalVoices, openTtsSlot } from './openTtsSlot';

const select = (id: string, settings: object, pair = { source: 'ja', target: 'en' }) =>
  useProviderStore.setState({ selected: id, entries: { [id]: { settings, credentials: {}, pair } } } as never);

beforeEach(() => {
  useSettingsStore.setState({ engineSlotTarget: null, settingsNavigationTarget: null });
  useLineUpStore.setState({ lineUp: null, stored: false });
});

describe('openTtsSlot', () => {
  it("opens the TTS slot of the direction each leg speaks, in the line-up's provider options", () => {
    select('local_inference', LOCAL_INFERENCE_DEFAULTS);
    openTtsSlot('speaker');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'tts' });
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider-options');
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'tts' });
  });

  it("with Edge speaking, opens Edge's voices in the speech card and leaves no slot target behind", () => {
    useSettingsStore.setState({ engineSlotTarget: { dir: 'ja→en', stage: 'asr' } });
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    select('local_inference', LOCAL_INFERENCE_DEFAULTS);
    openTtsSlot('speaker');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('edge-voices');
  });

  it('follows the pair as it is now, not as it was when the warning was filed', () => {
    select('local_inference', LOCAL_INFERENCE_DEFAULTS, { source: 'zh', target: 'ko' });
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ko→zh', stage: 'tts' });
  });

  it("under a provider with no engine, opens the provider's options and leaves no slot target behind", () => {
    select('soniox', SONIOX_DEFAULTS);
    expect(selectedFromStores()?.provider.id).toBe('soniox');
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider-options');
  });

  it('under a provider with no engine, clears a slot target still pending from before, so it cannot open later under another provider', () => {
    useSettingsStore.setState({ engineSlotTarget: { dir: 'ja→en', stage: 'asr' } });
    select('soniox', SONIOX_DEFAULTS);
    openTtsSlot('speaker');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
  });
});

// B-20: the local engine's voices are in the speech card, Edge's or its own.
describe('openLocalVoices', () => {
  it("opens the local engine's voices in the speech card, and leaves no slot target behind", () => {
    useSettingsStore.setState({ engineSlotTarget: { dir: 'ja→en', stage: 'tts' } });
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference', summarisation: null }, stored: true });
    openLocalVoices();
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('local-voices');
  });

  it("opens Edge's voices with Edge speaking", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    openLocalVoices();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('edge-voices');
  });
});
