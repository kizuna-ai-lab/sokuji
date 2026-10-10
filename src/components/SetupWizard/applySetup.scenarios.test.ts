/**
 * Every setup-guide scenario against the real stores: what Finish writes (mode,
 * the other side, Text Only, Translation I hear, the provider and its pair) and
 * what a run would then speak (`speechFromStores`). The stores start out on the
 * opposite of each preset, so a value that is asserted was written, not inherited.
 * A scenario that leaves Translation I hear alone must leave the prior value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
}));

import { Provider } from '../../types/Provider';
import { SCENARIOS, type ScenarioPreset } from '../../lib/setup/scenarios';
import { speechFromStores } from '../../lib/session/appShape';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { SETUP_STORAGE_KEY } from '../../stores/setupStore';
import { useApplySetup } from './useApplySetup';
import { initialDraft, type SetupDraft } from './setupDraft';

const draft = (over: Partial<SetupDraft>): SetupDraft => ({
  ...initialDraft(), step: 5, scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX,
  credentials: { apiKey: 'k' }, credentialsValidated: true, sourceLanguage: 'ja', targetLanguage: 'en', ...over,
});

/** What each scenario must leave in the stores, and what a run would speak (web platform: nothing is recaptured). */
const EXPECTED: Record<ScenarioPreset['id'], {
  mode: 'speaker' | 'participant' | 'both'; otherSide: 'meeting' | 'beside'; popoverSeen: boolean;
  textOnly: boolean; participantSpeech: boolean | 'kept'; speaks: { other: boolean; me: boolean; them: boolean };
}> = {
  'understand-others': { mode: 'participant', otherSide: 'meeting', popoverSeen: false, textOnly: true, participantSpeech: 'kept', speaks: { other: false, me: false, them: true } },
  'be-heard': { mode: 'speaker', otherSide: 'meeting', popoverSeen: false, textOnly: false, participantSpeech: 'kept', speaks: { other: true, me: false, them: true } },
  'subtitle-myself': { mode: 'speaker', otherSide: 'meeting', popoverSeen: false, textOnly: true, participantSpeech: 'kept', speaks: { other: false, me: false, them: true } },
  'two-way-voice': { mode: 'both', otherSide: 'meeting', popoverSeen: false, textOnly: false, participantSpeech: true, speaks: { other: true, me: false, them: true } },
  'two-way-text': { mode: 'both', otherSide: 'meeting', popoverSeen: false, textOnly: true, participantSpeech: false, speaks: { other: false, me: false, them: false } },
  'face-to-face-voice': { mode: 'both', otherSide: 'beside', popoverSeen: true, textOnly: false, participantSpeech: true, speaks: { other: true, me: false, them: true } },
  'face-to-face-text': { mode: 'both', otherSide: 'beside', popoverSeen: true, textOnly: true, participantSpeech: false, speaks: { other: false, me: false, them: false } },
};

const PRIOR_PARTICIPANT_SPEECH = true; // what a "kept" scenario must leave untouched

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });
});

afterEach(async () => {
  setSetting.mockImplementation(async (key: string, value: unknown) => { stored.set(key, value); return { success: true }; });
  await useProviderStore.getState().flush();
});

/** The stores on the opposite of the preset, so every asserted value is the wizard's write. */
function dirty(p: ScenarioPreset) {
  useAudioStore.setState({
    mode: p.mode === 'both' ? 'participant' : 'both',
    otherSide: p.otherSide === 'beside' ? 'meeting' : 'beside',
    bothPopoverSeen: false,
    isMonitorMuted: true,
    selectedParticipantSource: null,
  });
  useSettingsStore.setState({ textOnly: !p.textOnly });
  useRoutingStore.setState({ participantSpeech: p.participantSpeech === undefined ? PRIOR_PARTICIPANT_SPEECH : !p.participantSpeech });
}

describe('the setup guide: what each scenario writes, and what a run would speak', () => {
  const rows: string[] = [];

  afterEach(() => {
    if (rows.length === SCENARIOS.length) {
      // eslint-disable-next-line no-console
      console.log(['| scenario | mode | other side | popover seen | Text Only | Translation I hear | provider · pair | speaks other/me/them |', '|---|---|---|---|---|---|---|---|', ...rows].join('\n'));
    }
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s', async (id, preset) => {
    const want = EXPECTED[id];
    dirty(preset);
    const { result } = renderHook(() => useApplySetup());

    await result.current(draft({ scenario: id }));

    const audio = useAudioStore.getState();
    const participantSpeech = useRoutingStore.getState().participantSpeech;
    const provider = useProviderStore.getState();
    const pair = provider.entries[provider.selected!]?.pair;
    const speaks = speechFromStores();
    rows.push(`| ${id} | ${audio.mode} | ${audio.otherSide} | ${audio.bothPopoverSeen} | ${useSettingsStore.getState().textOnly} | ${participantSpeech} | ${provider.selected} · ${pair?.source}→${pair?.target} | ${speaks.other}/${speaks.me}/${speaks.them} |`);

    expect(audio.mode).toBe(want.mode);
    expect(audio.otherSide).toBe(want.otherSide);
    expect(audio.bothPopoverSeen).toBe(want.popoverSeen);
    expect(useSettingsStore.getState().textOnly).toBe(want.textOnly);
    expect(participantSpeech).toBe(want.participantSpeech === 'kept' ? PRIOR_PARTICIPANT_SPEECH : want.participantSpeech);
    expect(provider.selected).toBe('soniox');
    expect(pair).toEqual({ source: 'ja', target: 'en' });
    expect(speaks).toEqual(want.speaks);
    expect(setSetting).toHaveBeenCalledWith('settings.common.provider', 'soniox');
    expect(setSetting).toHaveBeenCalledWith(SETUP_STORAGE_KEY, expect.objectContaining({ scenario: id, providerPath: 'own-key', provider: 'soniox' }));
  });
});
