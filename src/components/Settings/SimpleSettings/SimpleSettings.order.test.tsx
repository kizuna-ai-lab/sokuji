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
 * same reason, does NOT stub the `../sections` barrel or the provider blocks:
 * marker `<div>`s would carry none of the ids and class names this test reads
 * the order from. It is the one test of the list's order, so the blocks the
 * app session's Settings compose (plan 1e-3b-2) render for real, over
 * LocalInference loaded and selected in the provider store.
 *
 * `HelpSection` is the one section still stubbed - it calls `useStartBasicsTour`
 * and throws outside a `TourProvider`. The stub reproduces the real
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

// The run's lock: no run here.
vi.mock('../../../app/useRun', () => ({ useSessionLocked: () => false }));

// The chips' memory estimate - irrelevant to the order.
vi.mock('../../../lib/local-inference/modelManifest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/local-inference/modelManifest')>()),
  estimateModelMemoryByDevice: () => ({ vramMb: 0, ramMb: 0 }),
}));

vi.mock('../sections/HelpSection', () => ({
  default: () => <div className="config-section" id="help-section" />,
}));

// Heavy Library sections - never reached by this test, stubbed the way
// SimpleSettings.engine.test.tsx used to stub them.
vi.mock('../sections/ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('../sections/NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { useProviderStore } = await import('../../../stores/providerStore');
const { localInferenceProvider } = await import('../../../providers/localInference/provider');
const { MemoryRouter } = await import('react-router-dom');
const { default: SimpleSettings } = await import('./SimpleSettings');

beforeEach(async () => {
  useSettingsStore.setState({ engineSlotTarget: null });
  await useProviderStore.getState().load(localInferenceProvider);
  useProviderStore.getState().select('localInference');
});

const sectionIds = () => {
  const { container } = render(<MemoryRouter><SimpleSettings /></MemoryRouter>);
  return Array.from(container.querySelectorAll('.config-section'))
    .map((el) => el.id || el.className);
};

describe('SimpleSettings - section order', () => {
  it('leads with the pair, the speech and output blocks, segmentation and the provider, then the audio sections, and ends with help', () => {
    expect(sectionIds()).toEqual([
      'languages-section',
      'turn-detection-section',
      'output-section',
      'sentence-segmentation-section',
      'provider-section',
      'microphone-section',
      'speaker-section',
      'participant-section',
      'help-section',
    ]);
  });

  // The move's whole point: interface language no longer occupies a section of
  // this panel. It is a link inside Help now, so nothing here should carry it.
  it('gives interface language no section of its own', () => {
    const ids = sectionIds();
    expect(ids.some((x) => x.includes('interface-language'))).toBe(false);
  });
});
