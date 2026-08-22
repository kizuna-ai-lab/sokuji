/**
 * SimpleSettings' engine host: the store's one-shot `engineSlotTarget`
 * signal (fired by Task 10's chips) deep-links into the same EngineSurface
 * ProviderSpecificSettings hosts in advanced mode. Follows
 * ProviderSpecificSettings.engine.test.tsx's mount idiom — real
 * settingsStore/sessionStore/modelStore, ServiceFactory mocked, an
 * interpolating `t()` mock for EnginePage's direction headings — with
 * SimpleSettings' own section list stubbed to recognizable markers, since
 * these tests are about the host switch (section list <-> engine surface),
 * not about any individual section's content.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, d?: any, opts?: any) =>
        typeof d === 'string'
          ? d.replace(/\{\{(\w+)\}\}/g, (_m: string, n: string) => String(opts?.[n] ?? ''))
          : _k,
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// SimpleSettings' section list isn't what's under test here — each section
// is stubbed to a recognizable marker so "back returns to the normal list"
// has something concrete to assert on.
vi.mock('../sections', () => ({
  AccountSection: () => <div data-testid="account-section" />,
  ProviderSection: () => <div data-testid="provider-section" />,
  LanguageSection: () => <div data-testid="language-section" />,
  AudioDeviceSection: () => <div data-testid="audio-device-section" />,
  SystemAudioSection: () => <div data-testid="system-audio-section" />,
  HelpSection: () => <div data-testid="help-section" />,
}));

// Heavy Library sections — never rendered by these tests (EngineSurface
// opens on its overview page, not a pushed Library view), stubbed the way
// ProviderSpecificSettings.engine.test.tsx stubs them.
vi.mock('../sections/ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('../sections/NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { default: useSessionStore } = await import('../../../stores/sessionStore');
const { Provider } = await import('../../../types/Provider');
const { default: SimpleSettings } = await import('./SimpleSettings');

beforeEach(() => {
  useSessionStore.setState({ isSessionActive: false });
  useSettingsStore.setState({ engineSlotTarget: null });
});

describe('SimpleSettings — engine host (Task 9)', () => {
  it('a local provider with a set engineSlotTarget renders the surface with that slot expanded, and clears the signal', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    const { container } = render(<SimpleSettings />);

    expect(container.querySelectorAll('.engine-slot__body')).toHaveLength(1);
    const slot = container.querySelector('.engine-slot[data-slot="ja→en:asr"]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('.engine-slot__body')).not.toBeNull();

    // One-shot: consumed immediately, not left around for a later mount.
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
  });

  it('renders the session-active banner above the surface when a session is active', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });
    useSessionStore.setState({ isSessionActive: true });

    const { container } = render(<SimpleSettings />);

    const content = container.querySelector('.settings-content');
    expect(content).not.toBeNull();
    const children = Array.from(content!.children);
    const bannerIndex = children.findIndex((el) => el.classList.contains('session-warning'));
    const backRowIndex = children.findIndex((el) => el.classList.contains('engine-back-row'));
    expect(bannerIndex).toBeGreaterThanOrEqual(0);
    expect(backRowIndex).toBeGreaterThan(bannerIndex);
  });

  it('the back row returns to the normal section list', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    render(<SimpleSettings />);
    expect(screen.queryByTestId('account-section')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Models' }));

    expect(screen.getByTestId('account-section')).not.toBeNull();
  });

  it('a non-local provider ignores a set engineSlotTarget: the normal list renders, and the signal is still cleared', () => {
    useSettingsStore.setState({ provider: Provider.OPENAI });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    render(<SimpleSettings />);

    expect(screen.getByTestId('account-section')).not.toBeNull();
    // Cleared rather than left stale — a later switch to a local provider
    // must not suddenly pop the engine surface from this old target.
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
  });
});
