/**
 * Task 10 (S7): the model chips deep-link into the engine surface's slot
 * instead of running the old "flip the language pair" workflow. A chip click
 * now only ever does two things: set the store's one-shot `engineSlotTarget`
 * signal, and — in Advanced mode only — switch the settings panel to the
 * provider tab via the existing `navigateToSettings` mechanism. It never
 * touches `uiMode` any more (that used to force Advanced on every click).
 *
 * Finding 1 (UX fix pass): the chips now follow the audio mode
 * (`lockedMode ?? mode`) instead of always showing the speaker direction's
 * three models —
 *   - 'speaker'     → 3 chips (ASR/MT/TTS) for src→tgt.
 *   - 'participant' → 2 chips (ASR/MT, no TTS) for the REVERSE tgt→src —
 *     clicking one targets that reverse direction, never the speaker's.
 *   - 'both'        → both groups, each under a small-caps label ("Me" /
 *     "Other") so which group is whose is unambiguous.
 *
 * Follows ProviderSection.select.test.tsx's mount idiom: the real
 * settingsStore (asserted on directly via setState/getState, not spied),
 * ServiceFactory/analytics/auth/supportsBaseSelect mocked. modelStore and
 * nativeModelStore are also real — LOCAL_INFERENCE needs no extra setup
 * (mirrors ProviderSpecificSettings.engine.test.tsx), LOCAL_NATIVE needs
 * `sidecarStatus: 'ready'` or the chips are replaced by the loading notice.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: async () => 'token' }),
}));

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

vi.mock('../../../utils/supportsBaseSelect', () => ({
  supportsBaseSelect: () => true,
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { useNativeModelStore } = await import('../../../stores/nativeModelStore');
const useAudioStoreModule = await import('../../../stores/audioStore');
const useAudioStore = useAudioStoreModule.default;
const { Provider } = await import('../../../types/Provider');
const { default: ProviderSection } = await import('./ProviderSection');

// Source order in ProviderSection's model-inline block: ASR, MT, TTS per
// group; 'both' mode renders the speaker group's chips (3) before the
// participant group's (2).
const chips = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.model-chip')) as HTMLButtonElement[];

const groupLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.model-inline-group__label')).map((el) => el.textContent);

describe('ProviderSection — model chips deep-link to their slot (Task 10)', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      provider: Provider.LOCAL_INFERENCE,
      uiMode: 'advanced',
      settingsNavigationTarget: null,
      engineSlotTarget: null,
    } as never);
    useNativeModelStore.setState({ sidecarStatus: 'ready' } as never);
    useAudioStore.setState({ mode: 'speaker' } as never);
  });

  it('advanced mode: clicking a chip sets engineSlotTarget with the speaker dir + right stage, switches tabs, and never touches uiMode', () => {
    const { container } = render(<ProviderSection isSessionActive={false} />);

    fireEvent.click(chips(container)[1]); // MT (translation)

    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'translation' });
    // navigateToSettings('provider') — same mechanism the old model-*
    // targets used, just aimed at the tab itself.
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider');
    // The old handler forced Advanced via setUIMode; the new one never calls
    // it at all — uiMode must be exactly what it started as.
    expect(useSettingsStore.getState().uiMode).toBe('advanced');
  });

  it('simple mode: clicking a chip sets the target and calls neither navigateToSettings nor setUIMode', () => {
    useSettingsStore.setState({ uiMode: 'basic' } as never);
    const { container } = render(<ProviderSection isSessionActive={false} />);

    fireEvent.click(chips(container)[0]); // ASR

    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'asr' });
    // Neither side effect fires in Simple mode: SimpleSettings' own host
    // reacts to engineSlotTarget directly, no tab and no mode switch needed.
    expect(useSettingsStore.getState().settingsNavigationTarget).toBeNull();
    expect(useSettingsStore.getState().uiMode).toBe('basic');
  });

  it('the ASR/MT/TTS chips still display resolved (or "None") model values — the deep-link change only touched onClick, not the label logic', () => {
    const { container } = render(<ProviderSection isSessionActive={false} />);

    const values = chips(container).map((chip) => chip.querySelector('.model-chip-value')?.textContent);
    expect(values).toHaveLength(3);
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v).not.toBe('');
    }
  });

  it("mode='speaker' (default): LOCAL_INFERENCE shows exactly the 3 speaker chips, no group label (single, unambiguous group)", () => {
    const { container } = render(<ProviderSection isSessionActive={false} />);

    expect(chips(container)).toHaveLength(3);
    expect(groupLabels(container)).toHaveLength(0);
  });

  it("mode='participant': LOCAL_INFERENCE shows 2 chips (ASR/MT, no TTS) for the REVERSE direction, and clicking one targets that reverse dir", () => {
    useAudioStore.setState({ mode: 'participant' } as never);
    const { container } = render(<ProviderSection isSessionActive={false} />);

    expect(chips(container)).toHaveLength(2);
    expect(groupLabels(container)).toHaveLength(0); // single group — no label needed

    fireEvent.click(chips(container)[0]); // ASR
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'asr' });
  });

  it("mode='both': LOCAL_INFERENCE shows 5 chips across two labeled groups — 'Me' (speaker, 3) then 'Other' (participant, 2)", () => {
    useAudioStore.setState({ mode: 'both' } as never);
    const { container } = render(<ProviderSection isSessionActive={false} />);

    expect(chips(container)).toHaveLength(5);
    expect(groupLabels(container)).toEqual(['Me', 'Other']);

    // Speaker-group chips (first 3) target the forward dir...
    fireEvent.click(chips(container)[0]); // Me · ASR
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'asr' });

    // ...participant-group chips (last 2) target the reverse dir — each chip
    // owns its own direction, never the speaker's (Finding 1).
    fireEvent.click(chips(container)[3]); // Other · ASR
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'asr' });
    fireEvent.click(chips(container)[4]); // Other · MT
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'translation' });
  });

  it('LOCAL_NATIVE: the shared handler is wired the same way — sets engineSlotTarget, switches tabs, leaves uiMode alone', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, uiMode: 'advanced' } as never);
    const { container } = render(<ProviderSection isSessionActive={false} />);

    fireEvent.click(chips(container)[2]); // TTS

    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'tts' });
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider');
    expect(useSettingsStore.getState().uiMode).toBe('advanced');
  });

  it("LOCAL_NATIVE gets identical mode treatment: mode='participant' shows 2 chips for the reverse direction", () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, uiMode: 'advanced' } as never);
    useAudioStore.setState({ mode: 'participant' } as never);
    const { container } = render(<ProviderSection isSessionActive={false} />);

    expect(chips(container)).toHaveLength(2);
    fireEvent.click(chips(container)[1]); // MT
    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'en→ja', stage: 'translation' });
  });

  it("LOCAL_NATIVE: the tour's engine-chips anchor is there while the sidecar is still starting", () => {
    // The offline tour's `models` step runs seconds after the wizard selected
    // LOCAL_NATIVE, with the sidecar still 'starting' and the chip row replaced
    // by a loading notice. Anchoring on the chip row means the step is skipped
    // for exactly the users the offline path just sent here.
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, uiMode: 'advanced' } as never);
    useNativeModelStore.setState({ sidecarStatus: 'starting' } as never);
    const { container } = render(<ProviderSection isSessionActive={false} />);

    expect(chips(container)).toHaveLength(0);            // the loading notice, not the chips
    expect(container.querySelector('[data-tour="engine-chips"]')).not.toBeNull();
  });

  it("LOCAL_NATIVE gets identical mode treatment: mode='both' shows 5 chips across the same two labeled groups", () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, uiMode: 'advanced' } as never);
    useAudioStore.setState({ mode: 'both' } as never);
    const { container } = render(<ProviderSection isSessionActive={false} />);

    expect(chips(container)).toHaveLength(5);
    expect(groupLabels(container)).toEqual(['Me', 'Other']);
  });
});
