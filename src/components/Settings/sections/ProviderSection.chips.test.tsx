/**
 * Task 10 (S7): the model chips deep-link into the engine surface's slot
 * instead of running the old "flip the language pair" workflow. A chip click
 * now only ever does two things: set the store's one-shot `engineSlotTarget`
 * signal, and — in Advanced mode only — switch the settings panel to the
 * provider tab via the existing `navigateToSettings` mechanism. It never
 * touches `uiMode` any more (that used to force Advanced on every click).
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

// Source order in ProviderSection's model-inline block: ASR, MT, TTS.
const chips = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.model-chip')) as HTMLButtonElement[];

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
    // navigateToSettings('provider-section') — same mechanism the old
    // model-* targets used, just aimed at the tab itself.
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider-section');
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

  it('the OTHER/participant row no longer renders for LOCAL_INFERENCE, even when the participant channel is in scope', () => {
    // 'both' puts the participant channel in scope — the exact condition the
    // old participant-inline block gated on.
    useAudioStore.setState({ mode: 'both' } as never);
    const { container } = render(<ProviderSection isSessionActive={false} />);

    expect(container.querySelector('.participant-inline')).toBeNull();
    // Only the three speaker chips remain — no OTHER row's extra ASR/MT pair.
    expect(chips(container)).toHaveLength(3);
  });

  it('LOCAL_NATIVE: the shared handler is wired the same way — sets engineSlotTarget, switches tabs, leaves uiMode alone', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, uiMode: 'advanced' } as never);
    const { container } = render(<ProviderSection isSessionActive={false} />);

    fireEvent.click(chips(container)[2]); // TTS

    expect(useSettingsStore.getState().engineSlotTarget).toEqual({ dir: 'ja→en', stage: 'tts' });
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider-section');
    expect(useSettingsStore.getState().uiMode).toBe('advanced');
  });
});
