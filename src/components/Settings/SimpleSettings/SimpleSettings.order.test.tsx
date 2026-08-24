/**
 * Interface language is no longer a section of this panel at all.
 *
 * It was a full `config-section` at the top, next to *Translation* languages -
 * two adjacent blocks both called "language" - then moved to the bottom, and
 * now lives inside HelpSection at the weight of a link, alongside the version
 * number and the update check. It is set once, never revisited, and by its own
 * description does not affect what can be translated.
 *
 * So this file's contract changed: it used to pin the interface section's
 * position, and now pins its ABSENCE, plus the order of what remains.
 *
 * Follows `SimpleSettings.account.test.tsx`'s mount idiom (real stores,
 * ServiceFactory and analytics mocked, an interpolating `t()`) and, for the
 * same reason, does NOT stub the `../sections` barrel: marker `<div>`s would
 * carry none of the ids and class names this test reads the order from.
 *
 * `HelpSection` is the one section still stubbed - it calls `useOnboarding`
 * and throws outside an `OnboardingProvider`. The stub reproduces the real
 * element's `config-section` / `id="help-section"` shell so the order it
 * takes part in is the real one. HelpSection's own contents, the language
 * picker included, are covered by `sections/HelpSection.test.tsx`.
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

const sectionIds = () => {
  const { container } = render(<MemoryRouter><SimpleSettings /></MemoryRouter>);
  return Array.from(container.querySelectorAll('.config-section'))
    .map((el) => el.id || el.className);
};

describe('SimpleSettings - section order', () => {
  it('leads with translation languages and ends with help', () => {
    const ids = sectionIds();
    const translation = ids.findIndex((x) => x.includes('languages-section'));
    const help = ids.findIndex((x) => x.includes('help'));
    expect(translation).toBeGreaterThanOrEqual(0);
    expect(translation).toBeLessThan(help);
    expect(help).toBe(ids.length - 1);
  });

  // The move's whole point: interface language no longer occupies a section of
  // this panel. It is a link inside Help now, so nothing here should carry it.
  it('gives interface language no section of its own', () => {
    const ids = sectionIds();
    expect(ids.some((x) => x.includes('interface-language'))).toBe(false);
  });
});
