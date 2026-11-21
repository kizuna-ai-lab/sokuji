import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

// The plan follows the selection today. A test may put another in its place: `plan.found`, answered while it is set.
const plan = vi.hoisted(() => ({ found: null as unknown }));
vi.mock('../../lib/plan/fromStores', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/plan/fromStores')>();
  return { ...actual, planFromStores: () => (plan.found ?? actual.planFromStores()) as ReturnType<typeof actual.planFromStores> };
});

import { stubSpeechUnit, stubTextUnit, textAndSpeechPlan } from '../../lib/plan/testing';
import type { PlannedUnit } from '../../lib/plan/types';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { localSpeechUnit } from '../../providers/localInference/speechUnit';
import { planFromStores } from '../../lib/plan/fromStores';
import { transcriptionProvider } from '../../lib/plan/read';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import { SONIOX_DEFAULTS } from '../../providers/soniox/settings';
import { useProviderStore } from '../../stores/providerStore';
import { runsOn } from '../../stores/lineUpStore.testing';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { openLocalVoices, openTtsSlot } from './openTtsSlot';

const select = (id: string, settings: object, pair = { source: 'ja', target: 'en' }) => {
  runsOn(id);
  useProviderStore.setState({ entries: { [id]: { settings, credentials: {}, pair } } } as never);
};

beforeEach(() => {
  useSettingsStore.setState({ engineSlotTarget: null, settingsNavigationTarget: null });
  useLineUpStore.setState({ lineUp: null, stored: false });
  plan.found = null;
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
    const found = planFromStores();
    expect(found.state === 'ready' && transcriptionProvider(found.plan).id).toBe('soniox');
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

// A voice beside another provider's text: the options shown are the transcription provider's, so no engine there opens a slot.
describe("openTtsSlot, with another provider's voice reading the text", () => {
  const accounts = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } }]));
  const localVoice: PlannedUnit = { provider: localInferenceProvider, unit: localSpeechUnit, stages: ['speech'] };

  it('a local voice model: opens the local voices in the speech card, and leaves no slot target behind', () => {
    useSettingsStore.setState({ engineSlotTarget: { dir: 'ja→en', stage: 'asr' } });
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'local_inference', summarisation: null }, stored: true });
    plan.found = { state: 'ready', plan: textAndSpeechPlan(stubTextUnit().planned, localVoice), accounts: accounts('stub_text', 'local_inference') };
    openTtsSlot('speaker');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('local-voices');
    useSettingsStore.setState({ settingsNavigationTarget: null });
    openTtsSlot('participant');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('local-voices');
  });

  it("Edge: its voices in the speech card, as when the local provider runs every stage", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null }, stored: true });
    plan.found = { state: 'ready', plan: textAndSpeechPlan(stubTextUnit().planned, localVoice), accounts: accounts('stub_text', 'local_inference') };
    openTtsSlot('speaker');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('edge-voices');
  });

  it("a voice of a provider with no voices of this device: the provider's options, and no slot target", () => {
    useSettingsStore.setState({ engineSlotTarget: { dir: 'ja→en', stage: 'tts' } });
    // The text provider has an engine; the voice is another provider's, so its slot is not the one to open.
    const text = stubTextUnit([], { provider: { Engine: () => null } }).planned;
    plan.found = { state: 'ready', plan: textAndSpeechPlan(text, stubSpeechUnit().planned), accounts: accounts('stub_text', 'stub_voice') };
    openTtsSlot('speaker');
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider-options');
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
