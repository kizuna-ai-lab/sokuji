/**
 * Interface language is set once and never revisited, so it belongs at the
 * bottom of the panel rather than at the top next to *Translation* languages -
 * two adjacent sections both named "language". Translation languages lead
 * instead, which is what the panel is for.
 *
 * Follows `SimpleSettings.account.test.tsx`'s mount idiom (real stores,
 * ServiceFactory and analytics mocked, an interpolating `t()`) and, for the
 * same reason, does NOT stub the `../sections` barrel: marker `<div>`s would
 * carry none of the ids and class names this test reads the order from.
 *
 * `HelpSection` is the one section still stubbed - it calls `useOnboarding`
 * and throws outside an `OnboardingProvider`. The stub reproduces the real
 * element's `config-section` / `id="help-section"` shell so the order it
 * takes part in is the real one.
 *
 * The interface instance is identified by `className`, which `LanguageSection`
 * splices into `config-section ${className}`. It deliberately carries no `id`:
 * `#languages-section` belongs to the translation instance, and onboarding
 * targets ids, which is why this move leaves onboarding untouched.
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
  default: () => <div className="config-section" id="help-section" />,
}));

// Heavy Library sections - never reached by this test, stubbed the way
// SimpleSettings.engine.test.tsx stubs them.
vi.mock('../sections/ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('../sections/NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { default: useSessionStore } = await import('../../../stores/sessionStore');
const { Provider } = await import('../../../types/Provider');
const { MemoryRouter } = await import('react-router-dom');
const { default: SimpleSettings } = await import('./SimpleSettings');

beforeEach(() => {
  useSessionStore.setState({ isSessionActive: false });
  useSettingsStore.setState({ engineSlotTarget: null, provider: Provider.OPENAI });
});

describe('SimpleSettings - section order', () => {
  it('puts translation languages first and interface language last, before help', () => {
    const { container } = render(<MemoryRouter><SimpleSettings /></MemoryRouter>);
    const ids = Array.from(container.querySelectorAll('.config-section'))
      .map((el) => el.id || el.className);
    const translation = ids.findIndex((x) => x.includes('languages-section'));
    const help = ids.findIndex((x) => x.includes('help'));
    const iface = ids.findIndex((x) => x.includes('interface-language'));
    expect(translation).toBeLessThan(iface);
    expect(iface).toBeLessThan(help);
  });
});
