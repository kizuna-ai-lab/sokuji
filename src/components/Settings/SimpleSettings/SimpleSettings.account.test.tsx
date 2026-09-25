/**
 * The account entry no longer lives in the settings panel: it is the title
 * bar's `AccountButton`, which is reachable whatever the selected provider.
 * The old `AccountSection` was provider-scoped, so signing up required having
 * already picked a Kizuna-managed provider - the exact ordering problem the
 * title-bar slot removes. Nothing in the panel may bring it back.
 *
 * Follows `SimpleSettings.engine.test.tsx`'s mount idiom (real stores,
 * ServiceFactory and analytics mocked, an interpolating `t()`) with one
 * deliberate difference: it does NOT stub the `../sections` barrel. Stubbing
 * it would replace every section with a marker `<div>` that carries no
 * `#user-account-section` id, so this assertion would hold even while the
 * section still rendered - a test that can never fail. The real sections
 * render instead, which is what makes the assertion mean anything.
 *
 * `HelpSection` is stubbed: it calls `useStartBasicsTour` and throws outside a
 * `TourProvider`. So are the provider blocks (`../ProviderArea`, covered by
 * `ProviderArea.test.tsx`): the provider no longer shapes this list, and no
 * block of theirs carries an account entry. Their marker is a `config-section`
 * so the "rendered sections" guard below still counts one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';

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

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('../sections/HelpSection', () => ({
  default: () => <div className="config-section" data-testid="help-section" />,
}));

vi.mock('../ProviderArea', () => ({
  SessionSettingsGeneral: () => <div className="config-section" data-testid="session-settings-general" />,
  SessionEnginePage: () => null,
}));

vi.mock('../../../app/useRun', () => ({ useSessionLocked: () => false }));

// Heavy Library sections - never reached by this test.
vi.mock('../sections/ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('../sections/NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { MemoryRouter } = await import('react-router-dom');
const { default: SimpleSettings } = await import('./SimpleSettings');

beforeEach(() => {
  useSettingsStore.setState({ engineSlotTarget: null });
});

describe('SimpleSettings - no account section', () => {
  it('renders no account section', () => {
    // A router is still wrapped around it: the removed section navigated to
    // /sign-in, so a resurrected one fails on this assertion rather than on a
    // missing router.
    const { container } = render(<MemoryRouter><SimpleSettings /></MemoryRouter>);

    expect(container.querySelector('#user-account-section')).toBeNull();
    // Guards against a vacuous pass: the panel has to have rendered sections
    // for "no account section among them" to say anything.
    expect(container.querySelectorAll('.config-section').length).toBeGreaterThan(0);
  });
});
