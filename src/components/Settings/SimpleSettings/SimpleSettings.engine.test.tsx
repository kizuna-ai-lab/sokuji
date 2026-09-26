/**
 * SimpleSettings' engine host: the store's one-shot `engineSlotTarget`
 * signal (fired by a chip) pushes the selected provider's `Engine` in place
 * of the section list (1e-3 ruling 10), for a provider that has one. Real
 * settingsStore and providerStore, ServiceFactory mocked, the run's lock
 * mocked; the provider blocks (`../ProviderArea`) and the section list are
 * stubbed to markers recording their props, since these tests are about the
 * host switch (section list <-> engine page), not about any block's content.
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

const run = vi.hoisted(() => ({ locked: false }));
vi.mock('../../../app/useRun', () => ({ useSessionLocked: () => run.locked }));

// What each block was handed, by render.
const blocks = vi.hoisted(() => ({
  general: [] as Array<{ locked: boolean; layout: string; onOpenSlot(slot: unknown): void }>,
  page: [] as Array<{ locked: boolean; slot: { dir: string; stage: string } }>,
}));
vi.mock('../ProviderArea', () => ({
  SessionSettingsGeneral: (props: { locked: boolean; layout: string; onOpenSlot(slot: unknown): void }) => {
    blocks.general.push(props);
    return <div data-testid="session-settings-general" />;
  },
  SessionEnginePage: (props: { locked: boolean; slot: { dir: string; stage: string } }) => {
    blocks.page.push(props);
    return <div data-testid="session-engine-page" />;
  },
}));

// SimpleSettings' remaining sections aren't what's under test here.
vi.mock('../sections', () => ({
  AudioDeviceSection: () => <div data-testid="audio-device-section" />,
  SystemAudioSection: () => <div data-testid="system-audio-section" />,
  HelpSection: () => <div data-testid="help-section" />,
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { useProviderStore } = await import('../../../stores/providerStore');
const { default: SimpleSettings } = await import('./SimpleSettings');

const lastPage = () => blocks.page[blocks.page.length - 1];

beforeEach(() => {
  run.locked = false;
  blocks.general.length = 0;
  blocks.page.length = 0;
  useSettingsStore.setState({ engineSlotTarget: null });
  useProviderStore.setState({ selected: null });
});

describe('SimpleSettings — engine host', () => {
  it("a provider with an Engine and a set engineSlotTarget renders the engine page on that slot, and clears the signal", () => {
    useProviderStore.setState({ selected: 'localInference' });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    render(<SimpleSettings />);

    expect(screen.getByTestId('session-engine-page')).not.toBeNull();
    expect(lastPage()).toMatchObject({ locked: false, slot: { dir: 'ja→en', stage: 'asr' } });
    expect(screen.queryByTestId('session-settings-general')).toBeNull();
    // One-shot: consumed immediately, not left around for a later mount.
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
  });

  it('renders the session banner above the engine page while the run is locked, and hands the page the lock', () => {
    run.locked = true;
    useProviderStore.setState({ selected: 'localInference' });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    const { container } = render(<SimpleSettings />);

    const children = Array.from(container.querySelector('.settings-content')!.children);
    const bannerIndex = children.findIndex((el) => el.classList.contains('session-warning'));
    const backRowIndex = children.findIndex((el) => el.classList.contains('engine-back-row'));
    expect(bannerIndex).toBeGreaterThanOrEqual(0);
    expect(backRowIndex).toBeGreaterThan(bannerIndex);
    expect(lastPage().locked).toBe(true);
  });

  it('the back row returns to the section list', () => {
    useProviderStore.setState({ selected: 'localInference' });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    render(<SimpleSettings />);
    expect(screen.queryByTestId('session-settings-general')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByTestId('session-settings-general')).not.toBeNull();
    expect(screen.queryByTestId('session-engine-page')).toBeNull();
  });

  it('a provider without an Engine ignores a set engineSlotTarget: the list renders, and the signal is still cleared', () => {
    useProviderStore.setState({ selected: 'fake' });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    render(<SimpleSettings />);

    expect(screen.getByTestId('session-settings-general')).not.toBeNull();
    expect(screen.queryByTestId('session-engine-page')).toBeNull();
    // Cleared rather than left stale — a later switch to a provider with an
    // Engine must not suddenly pop the engine page from this old target.
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
  });

  // Simple mode shows no provider-specific controls: the Speech section's
  // provider tuning stays a summary line here.
  it('hands SessionSettingsGeneral the Simple layout', () => {
    render(<SimpleSettings />);
    expect(blocks.general[blocks.general.length - 1].layout).toBe('simple');
  });
});
