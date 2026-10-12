import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import { SONIOX_DEFAULTS } from '../../providers/soniox/settings';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { openTtsSlot } from './openTtsSlot';

const select = (id: string, settings: object, pair = { source: 'ja', target: 'en' }) =>
  useProviderStore.setState({ selected: id, entries: { [id]: { settings, credentials: {}, pair } } } as never);

beforeEach(() => {
  useSettingsStore.setState({ engineSlotTarget: null, settingsNavigationTarget: null });
});

describe('openTtsSlot', () => {
  it("opens the TTS slot of the direction each leg speaks, on the Provider tab", () => {
    select('local_inference', LOCAL_INFERENCE_DEFAULTS);
    openTtsSlot('speaker');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'tts' });
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider');
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'tts' });
  });

  it('follows the pair as it is now, not as it was when the warning was filed', () => {
    select('local_inference', LOCAL_INFERENCE_DEFAULTS, { source: 'zh', target: 'ko' });
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ko→zh', stage: 'tts' });
  });

  it('under a provider with no engine, opens the Provider tab and leaves no slot target behind', () => {
    select('soniox', SONIOX_DEFAULTS);
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider');
  });
});
