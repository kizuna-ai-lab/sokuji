/**
 * S0 — the language pair reads as a sentence whose verbs follow the current
 * audio mode, for the two local providers only (LOCAL_INFERENCE, LOCAL_NATIVE).
 *
 * The two selectors are the SAME two fields in every mode — first is always
 * MY language (sourceLanguage), second is always THEIRS (targetLanguage);
 * only the verbs labeling them change with mode. "Both" mode additionally
 * renders one derived plain-text mirror line for the reverse leg, never a
 * third pair of controls. Every other provider keeps today's plain
 * "My Language"/"Other's Language" labels regardless of mode — see
 * LanguageSection.soniox.test.tsx / LanguageSection.textOnly.test.tsx, which
 * exercise non-local providers and must stay green unmodified.
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

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { default: useAudioStore } = await import('../../../stores/audioStore');
const { useModelStore } = await import('../../../stores/modelStore');
const { Provider } = await import('../../../types/Provider');
const { default: LanguageSection } = await import('./LanguageSection');

const renderSection = () =>
  render(
    <LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />
  );

describe('LanguageSection — mode-verb sentence labels (local providers)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.LOCAL_INFERENCE,
      localInference: { ...s.localInference, sourceLanguage: 'ja', targetLanguage: 'en' },
    }));
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

  it('both mode: speaker line plus a plain-text mirror, no third combobox', () => {
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
  });

  it('speaker/participant modes render no mirror line', () => {
    useAudioStore.setState({ mode: 'speaker' } as any);
    renderSection();
    expect(screen.queryByTestId('language-mirror-line')).not.toBeInTheDocument();
  });

  it('non-local providers keep the plain labels regardless of mode', () => {
    useSettingsStore.setState({ provider: Provider.GEMINI, textOnly: false } as any);
    useAudioStore.setState({ mode: 'participant' } as any);
    renderSection();
    expect(screen.queryByText('I read')).not.toBeInTheDocument();
    expect(screen.queryByText('they speak')).not.toBeInTheDocument();
    expect(screen.getByText('simpleConfig.yourLanguage')).toBeInTheDocument();
    expect(screen.getByText('simpleConfig.targetLanguage')).toBeInTheDocument();
    expect(screen.queryByTestId('language-mirror-line')).not.toBeInTheDocument();
  });
});

describe('LanguageSection — resolution notes summary (2026-08-23 dedup)', () => {
  it('collapses fallback notes into ONE summary line with a Review link, not one line per note', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'translation', from: 'opus-mt-en-ja', to: 'qwen-x', reason: 'lang-incompatible' },
        { direction: 'ja→en', stage: 'tts', from: 'supertonic-3', to: 'edge-tts', reason: 'not-downloaded' },
      ],
    });
    render(<LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />);
    const notes = screen.getByTestId('language-resolution-notes');
    expect(notes.querySelectorAll('.language-warning')).toHaveLength(1);
    // Names the failed picks (display name when the manifest knows the id,
    // the raw id otherwise), deduped — never the anonymous count phrase.
    expect(notes.textContent).toContain('opus-mt-en-ja');
    expect(notes.textContent).toContain('unavailable');
    expect(notes.textContent).not.toContain('2 of your selected models');
    expect(screen.getByTestId('resolution-notes-review')).toBeInTheDocument();
    expect(screen.getByTestId('resolution-notes-use-auto')).toBeInTheDocument();
  });

  it('no-candidate notes are excluded from the summary — they belong to the missing-models warning', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'asr', from: null, to: null, reason: 'no-candidate' },
      ],
    });
    render(<LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />);
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
  });

  it('Review arms the engine slot target with the first note\'s slot', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE, engineSlotTarget: null } as any);
    useModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'translation', from: 'a', to: 'b', reason: 'not-downloaded' },
      ],
    });
    render(<LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />);
    fireEvent.click(screen.getByTestId('resolution-notes-review'));
    expect(useSettingsStore.getState().engineSlotTarget).toMatchObject({ dir: 'ja→en', stage: 'translation' });
  });

  it('renders nothing when there are no notes', () => {
    useModelStore.setState({ lastResolutionNotes: [] });
    render(<LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />);
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
  });

  it('Switch to Auto writes explicit auto into every noted slot and the summary clears', async () => {
    useSettingsStore.setState((st: any) => ({
      provider: Provider.LOCAL_INFERENCE,
      localInference: {
        ...st.localInference,
        sourceLanguage: 'ja', targetLanguage: 'en',
        selections: {
          'ja→en': { asr: { modelId: 'deleted-x' }, translation: { modelId: '' }, tts: { modelId: '' } },
          'en→ja': { asr: { modelId: 'deleted-x' }, translation: { modelId: '' }, tts: { modelId: '' } },
        },
      },
    }));
    useModelStore.setState({
      initialized: true,
      statuses: {},
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'asr', from: 'deleted-x', to: 'auto-y', reason: 'not-downloaded' },
        { direction: 'en→ja', stage: 'asr', from: 'deleted-x', to: 'auto-y', reason: 'not-downloaded' },
      ],
    } as any);
    render(<LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />);

    fireEvent.click(screen.getByTestId('resolution-notes-use-auto'));

    // The write is user-initiated explicit auto ('') — both noted slots.
    await waitFor(() => {
      const sel = (useSettingsStore.getState() as any).localInference.selections;
      expect(sel['ja→en'].asr.modelId).toBe('');
      expect(sel['en→ja'].asr.modelId).toBe('');
    });
    // ensureSelectionReady re-resolved: the stale-pick notes are gone, so the
    // summary disappears instead of nagging forever.
    await waitFor(() =>
      expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument());
  });

  it('non-local providers never render the block', () => {
    useSettingsStore.setState({ provider: Provider.OPENAI });
    useModelStore.setState({
      lastResolutionNotes: [
        { direction: 'ja→en', stage: 'asr', from: null, to: null, reason: 'not-downloaded' },
      ],
    });
    render(<LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />);
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
  });
});

describe('LanguageSection — the ONE blocking missing-models warning (resolver-backed)', () => {
  it('names only the stages the RESOLVER cannot fill, with per-stage engine deep links', () => {
    // Empty statuses: nothing downloaded. The resolver still fills
    // translation (Bing Translator, cloud, always ready) and TTS (Edge TTS,
    // cloud — and outside the session gate anyway), so only ASR is truly
    // missing. The old hand-rolled scan counted downloaded models only and
    // would have FALSELY listed Translation here — this pin is the point of
    // the resolver-backed rewrite.
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE, engineSlotTarget: null } as any);
    useModelStore.setState({ initialized: true, statuses: {}, lastResolutionNotes: [] } as any);
    render(<LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />);

    const warning = document.querySelector('.language-model-warning');
    expect(warning).toBeInTheDocument();
    expect(warning!.textContent).toContain('Missing ASR model(s)');
    expect(warning!.textContent).not.toContain('Translation');
    expect(warning!.textContent).not.toContain('TTS');

    fireEvent.click(screen.getByText('Download ASR'));
    expect(useSettingsStore.getState().engineSlotTarget).toMatchObject({ dir: 'ja→en', stage: 'asr' });
  });

  it('renders no warning while the model store is uninitialized', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useModelStore.setState({ initialized: false, statuses: {} } as any);
    render(<LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />);
    expect(document.querySelector('.language-model-warning')).not.toBeInTheDocument();
  });
});
