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
import { render, screen, within } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, def?: string) => def ?? _k,
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
