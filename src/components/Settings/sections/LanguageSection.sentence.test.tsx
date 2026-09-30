/**
 * S0 — the language pair reads as a sentence whose verbs follow the current
 * audio mode.
 *
 * The two selectors are the SAME two fields in every mode — first is always
 * MY language (sourceLanguage), second is always THEIRS (targetLanguage);
 * only the verbs labeling them change. "Both" mode additionally renders one
 * derived plain-text mirror line for the reverse leg, never a third pair of
 * controls.
 *
 * What DOES vary is whether the speaker leg produces speech, which decides
 * "they hear" vs "they read". That is the provider's textOnlyCapability, not
 * the raw toggle: 'never' providers ignore the (global, cross-provider)
 * toggle and always speak, 'always' providers never do, and only 'optional'
 * providers follow it.
 *
 * The old section serves Local Native alone since the Stage 2 deletion
 * (ruling 1); the two capabilities no provider declares are stubbed onto its
 * config.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, def?: any, opts?: any) => {
        const str = typeof def === 'string' ? def : _k;
        const o = typeof def === 'object' && def !== null ? def : opts;
        return str.replace(/\{\{(\w+)\}\}/g, (_m: string, n: string) => String(o?.[n] ?? ''));
      },
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// Local Native registers in the old registry only on Electron with its gate
// on — the only provider the old section still serves (Stage 2 deletion,
// ruling 1).
vi.mock('../../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isElectron: () => true,
  isLocalNativeEnabled: () => true,
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { default: useAudioStore } = await import('../../../stores/audioStore');
const { useNativeModelStore } = await import('../../../stores/nativeModelStore');
const { Provider } = await import('../../../types/Provider');
const { ProviderConfigFactory } = await import('../../../services/providers/ProviderConfigFactory');
const { default: LanguageSection } = await import('./LanguageSection');

const renderSection = () =>
  render(
    <LanguageSection isSessionActive={false} showTranslationLanguages={true} />
  );

const pinPair = () =>
  useSettingsStore.setState((s: any) => ({
    provider: Provider.LOCAL_NATIVE,
    localNative: { ...s.localNative, sourceLanguage: 'ja', targetLanguage: 'en', selections: {} },
  }));

/** Local Native's own config with its text-only capability swapped, for the
 *  two values no provider declares any more. */
const withCapability = (textOnlyCapability: 'always' | 'never') => {
  const config = ProviderConfigFactory.getConfig(Provider.LOCAL_NATIVE);
  return vi.spyOn(ProviderConfigFactory, 'getConfig').mockReturnValue({
    ...config,
    capabilities: { ...config.capabilities, textOnlyCapability },
  });
};

describe('LanguageSection — mode-verb sentence labels', () => {
  beforeEach(() => {
    pinPair();
    useSettingsStore.setState({ textOnly: false } as any);
  });

  it('speaker mode: I speak → they hear, selectors bound to source/target', () => {
    useAudioStore.setState({ mode: 'speaker' } as any);
    renderSection();
    expect(screen.getByText('I speak')).toBeInTheDocument();
    expect(screen.getByText('they hear')).toBeInTheDocument();
    expect(screen.queryByText('I read')).not.toBeInTheDocument();
    // The first selector is MY language in every mode — the regression guard
    // for the ordering decision (spec Part 3, property 1). Scope to the
    // languages block: the component may render other selects (UI language).
    const pair = within(document.getElementById('languages-section')!);
    const selects = pair.getAllByRole('combobox');
    expect((selects[0] as HTMLSelectElement).value).toBe('ja');
    expect((selects[1] as HTMLSelectElement).value).toBe('en');
  });

  it('participant mode: I read ← they speak, same two fields in the same order', () => {
    useAudioStore.setState({ mode: 'participant' } as any);
    renderSection();
    expect(screen.getByText('I read')).toBeInTheDocument();
    expect(screen.getByText('they speak')).toBeInTheDocument();
    const pair = within(document.getElementById('languages-section')!);
    const selects = pair.getAllByRole('combobox');
    expect((selects[0] as HTMLSelectElement).value).toBe('ja');
    expect((selects[1] as HTMLSelectElement).value).toBe('en');
  });

  it('both mode: speaker line plus a plain-text mirror with resolved names, no third combobox', () => {
    useAudioStore.setState({ mode: 'both' } as any);
    renderSection();
    expect(screen.getByText('I speak')).toBeInTheDocument();
    // The mirror is derived text, not controls: still exactly two comboboxes
    // inside the languages block.
    const pair = within(document.getElementById('languages-section')!);
    expect(pair.getAllByRole('combobox')).toHaveLength(2);
    const mirror = screen.getByTestId('language-mirror-line');
    expect(mirror.textContent).toContain('They speak');
    expect(mirror.textContent).toContain('I read');
    // Display names, never the raw settings tokens.
    expect(mirror.textContent).not.toMatch(/\bja\b/);
  });

  it('speaker/participant modes render no mirror line', () => {
    useAudioStore.setState({ mode: 'speaker' } as any);
    renderSection();
    expect(screen.queryByTestId('language-mirror-line')).not.toBeInTheDocument();
  });

  it('speaker mode with Text Only on: they READ, not hear', () => {
    // The verb has to track what the session actually produces. Local Native
    // is textOnlyCapability 'optional', so the toggle decides.
    useSettingsStore.setState({ textOnly: true } as any);
    useAudioStore.setState({ mode: 'speaker' } as any);
    renderSection();
    expect(screen.getByText('I speak')).toBeInTheDocument();
    expect(screen.getByText('they read')).toBeInTheDocument();
    expect(screen.queryByText('they hear')).not.toBeInTheDocument();
  });

  it('a stored provider the old registry does not register renders nothing', () => {
    // Every provider but Local Native since the Stage 2 deletion (choice 4):
    // the pre-twin managed id stands for them, as no registry has ever held it.
    useSettingsStore.setState({ provider: 'kizunaai' } as any);
    renderSection();
    expect(document.getElementById('languages-section')).toBeNull();
  });
});

describe('LanguageSection — the capability decides, not the raw toggle', () => {
  beforeEach(() => {
    pinPair();
  });

  it("an 'always' text-only provider reads, with the toggle off", () => {
    // No registered provider declares textOnlyCapability 'always' any more
    // (Zoom AI, then Volcengine ST, were removed on 2026-09-20), so the
    // capability is stubbed onto Local Native's own config rather than the
    // case being dropped: the 'always' arm of `pairSentence` and the
    // permanently-on Text Only switch are both still the handling for a
    // three-valued descriptor contract, and nothing else executes them.
    const spy = withCapability('always');
    try {
      useSettingsStore.setState({ textOnly: false } as any);
      useAudioStore.setState({ mode: 'speaker' } as any);
      renderSection();
      // The sentence ignores the global toggle: the provider cannot speak.
      expect(screen.getByText('I speak')).toBeInTheDocument();
      expect(screen.getByText('they read')).toBeInTheDocument();
      expect(screen.queryByText('they hear')).not.toBeInTheDocument();
      // ...and the switch says so: permanently on, non-interactive, and it is
      // the ONLY Text Only switch rendered — the 'optional' arm is not taken.
      const switches = screen.getAllByRole('switch').filter((el) => el.textContent?.includes('Text Only'));
      expect(switches).toHaveLength(1);
      expect(switches[0].getAttribute('aria-checked')).toBe('true');
      expect(switches[0].getAttribute('aria-disabled')).toBe('true');
    } finally {
      spy.mockRestore();
    }
  });

  it("a 'never' text-only provider hears, even with the toggle left on", () => {
    // textOnly is ONE global preference shared across providers: a provider
    // that ignores it still speaks. Reading the raw toggle here would print
    // the opposite of what the session does.
    const spy = withCapability('never');
    try {
      useSettingsStore.setState({ textOnly: true } as any);
      useAudioStore.setState({ mode: 'speaker' } as any);
      renderSection();
      expect(screen.getByText('I speak')).toBeInTheDocument();
      expect(screen.getByText('they hear')).toBeInTheDocument();
      expect(screen.queryByText('they read')).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('participant mode reads regardless of capability — the reverse leg never speaks', () => {
    const spy = withCapability('never');
    try {
      useSettingsStore.setState({ textOnly: false } as any);
      useAudioStore.setState({ mode: 'participant' } as any);
      renderSection();
      expect(screen.getByText('I read')).toBeInTheDocument();
      expect(screen.getByText('they speak')).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('LanguageSection — resolution notes summary (2026-08-23 dedup)', () => {
  beforeEach(() => {
    // Pin the pair AND the audio mode: the summary is scoped to the current
    // mode's visible directions (ja→en forward under 'speaker'), and earlier
    // describes leave mode at whatever they last set.
    pinPair();
    useAudioStore.setState({ mode: 'speaker' } as any);
    useNativeModelStore.setState({ catalog: {} } as any);
  });

  it('collapses fallback notes into ONE summary line with a Review link, not one line per note', () => {
    useNativeModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'translation', from: 'opus-mt-en-ja', to: 'qwen-x', reason: 'lang-incompatible' },
        { direction: 'ja→en', stage: 'tts', from: 'supertonic-3', to: 'kokoro', reason: 'not-downloaded' },
      ],
    } as any);
    renderSection();
    const notes = screen.getByTestId('language-resolution-notes');
    expect(notes.querySelectorAll('.language-warning')).toHaveLength(1);
    // Names the failed picks (display name when the catalog knows the id,
    // the raw id otherwise), deduped — never the anonymous count phrase.
    expect(notes.textContent).toContain('opus-mt-en-ja');
    expect(notes.textContent).toContain('unavailable');
    expect(notes.textContent).not.toContain('2 of your selected models');
    expect(screen.getByTestId('resolution-notes-review')).toBeInTheDocument();
    expect(screen.getByTestId('resolution-notes-use-auto')).toBeInTheDocument();
  });

  it('no-candidate notes are excluded from the summary — they belong to the missing-models warning', () => {
    useNativeModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'asr', from: null, to: null, reason: 'no-candidate' },
      ],
    } as any);
    renderSection();
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
  });

  it('Review arms the engine slot target with the first note\'s slot', () => {
    useSettingsStore.setState({ engineSlotTarget: null } as any);
    useNativeModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'translation', from: 'a', to: 'b', reason: 'not-downloaded' },
      ],
    } as any);
    renderSection();
    fireEvent.click(screen.getByTestId('resolution-notes-review'));
    expect(useSettingsStore.getState().engineSlotTarget).toMatchObject({ dir: 'ja→en', stage: 'translation' });
  });

  it('renders nothing when there are no notes', () => {
    useNativeModelStore.setState({ lastResolutionNotes: [] } as any);
    renderSection();
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
  });

  it('Switch to Auto clears every noted (visible) slot', async () => {
    // 'both' mode: both directions are visible, so both notes count and both
    // slots get switched.
    useAudioStore.setState({ mode: 'both' } as any);
    useSettingsStore.setState((st: any) => ({
      localNative: {
        ...st.localNative,
        sourceLanguage: 'ja', targetLanguage: 'en',
        selections: {
          'ja→en': { asr: { modelId: 'deleted-x' }, translation: { modelId: '' }, tts: { modelId: '' } },
          'en→ja': { asr: { modelId: 'deleted-x' }, translation: { modelId: '' }, tts: { modelId: '' } },
        },
      },
    }));
    useNativeModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'asr', from: 'deleted-x', to: 'auto-y', reason: 'not-downloaded' },
        { direction: 'en→ja', stage: 'asr', from: 'deleted-x', to: 'auto-y', reason: 'not-downloaded' },
      ],
    } as any);
    renderSection();

    fireEvent.click(screen.getByTestId('resolution-notes-use-auto'));

    // The stale pick is GONE from both directions. Assert semantics, not
    // shape: explicit auto ('') and an absent direction mean the same thing.
    await waitFor(() => {
      const sel = (useSettingsStore.getState() as any).localNative.selections;
      expect(sel['ja→en']?.asr?.modelId ?? '').toBe('');
      expect(sel['en→ja']?.asr?.modelId ?? '').toBe('');
    });
  });

  it('a note about a direction the current mode hides is not counted (mode-scoped, 2026-08-23)', () => {
    // speaker mode: only ja→en is visible; the en→ja note must not surface.
    useNativeModelStore.setState({
      lastResolutionNotes: [
        { direction: 'en→ja', stage: 'asr', from: 'a', to: 'b', reason: 'not-downloaded' },
      ],
    } as any);
    renderSection();
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
  });
});

describe('LanguageSection — the ONE blocking missing-models warning (resolver-backed)', () => {
  beforeEach(() => {
    pinPair();
    useAudioStore.setState({ mode: 'speaker' } as any);
  });

  it('names only the stages the RESOLVER cannot fill, with per-stage engine deep links', () => {
    // A catalog with a voice and nothing else: no ASR and no translation
    // candidate for ja→en, so both are named; TTS never is.
    useSettingsStore.setState({ engineSlotTarget: null } as any);
    useNativeModelStore.setState({
      statuses: {},
      catalog: {
        'voice-en': { id: 'voice-en', name: 'Voice EN', kind: 'tts', languages: ['en'], recommended: false,
          tiers: [{ tier: 'cpu', backend: 'tts', available: true }], order: 1, repo: 'voice-en' },
      },
    } as any);
    renderSection();

    const warning = document.querySelector('.language-model-warning');
    expect(warning).toBeInTheDocument();
    expect(warning!.textContent).toContain('Missing ASR, Translation model(s)');
    expect(warning!.textContent).not.toContain('TTS');

    fireEvent.click(screen.getByText('Download ASR'));
    expect(useSettingsStore.getState().engineSlotTarget).toMatchObject({ dir: 'ja→en', stage: 'asr' });
  });

  it('renders no warning while the catalog is empty — the sidecar is not up', () => {
    useNativeModelStore.setState({ catalog: {}, statuses: {} } as any);
    renderSection();
    expect(document.querySelector('.language-model-warning')).not.toBeInTheDocument();
  });
});
