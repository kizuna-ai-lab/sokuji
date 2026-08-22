/**
 * Composition smoke tests mounting the REAL ProviderSpecificSettings ->
 * EngineSurface tree, for both local providers — the Task 7 review's carried
 * finding: every engine piece (adapter, EnginePage, EngineSurface, the
 * per-provider Library section) was unit-tested standalone, but nothing
 * proved ProviderSpecificSettings actually wires them together for either
 * provider. Deliberately smoke-level: render + a couple of structural
 * assertions, not a re-test of EnginePage/EngineSection/adapter behavior —
 * each already has its own dedicated test file.
 *
 * Follows ProviderSpecificSettings.soniox.test.tsx's mount idiom (real
 * settingsStore/modelStore/nativeModelStore, ServiceFactory mocked, heavy
 * local-provider sections stubbed) combined with StoragePage.test.tsx's
 * interpolating `t()` mock, needed here to tell the two rendered direction
 * headings apart ("ja → en" vs "en → ja").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: () => ({
    isLoaded: true, isSignedIn: false, sessionId: undefined, error: null,
    getToken: async () => null, userId: undefined,
  }),
}));

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// LOCAL_NATIVE is only registered in ProviderConfigFactory's static block
// when isElectron() && isLocalNativeEnabled() (see localNativeGating.test.ts's
// idiom, mirrored here) — force both on so getCurrentProviderSettings() can
// resolve a descriptor for it under jsdom.
vi.mock('../../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isElectron: () => true,
  isLocalNativeEnabled: () => true,
}));

// Heavy Library sections — never rendered by these tests (EngineSurface opens
// on its overview page, not a pushed Library view), stubbed the way
// ProviderSpecificSettings.soniox.test.tsx stubs local-provider sections.
vi.mock('./ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('./NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));
// EngineSection has its own dedicated test file (EngineSection.test.tsx);
// stubbed to a marker here so this file only asserts WHERE it renders (moved
// into the adapter's `gate`, rendered exactly once), never re-testing its
// internal bundle-status behavior.
vi.mock('./EngineSection', () => ({
  EngineSection: () => <div data-testid="engine-section-gate" />,
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { LocalInferenceProviderConfig } = await import('../../../services/providers/LocalInferenceProviderConfig');
const { LocalNativeProviderConfig } = await import('../../../services/providers/LocalNativeProviderConfig');
const { default: ProviderSpecificSettings } = await import('./ProviderSpecificSettings');

const baseProps = {
  isSessionActive: false,
  isPreviewExpanded: false,
  setIsPreviewExpanded: () => {},
  getProcessedSystemInstructions: () => '',
  availableModels: [] as any[],
  loadingModels: false,
  fetchAvailableModels: async () => {},
};

function directionHeadings(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.engine-direction__title')).map((el) => el.textContent ?? '');
}

beforeEach(() => {
  useSettingsStore.setState({ engineSlotTarget: null });
});

describe('ProviderSpecificSettings — Engine surface composition (Task 7 review carry-over)', () => {
  it('LOCAL_INFERENCE: EngineSurface renders with both direction headings, no engine gate', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    const { container } = render(
      <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
    );
    expect(directionHeadings(container)).toEqual(['ja → en', 'en → ja']);
    // The WASM adapter carries no `gate` — EngineSection is a native-only concern.
    expect(container.querySelector('[data-testid="engine-section-gate"]')).toBeNull();
  });

  it('LOCAL_NATIVE: EngineSurface renders with both direction headings and the EngineSection gate, exactly once', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE });
    const { container } = render(
      <ProviderSpecificSettings {...baseProps} config={new LocalNativeProviderConfig().getConfig()} />,
    );
    expect(directionHeadings(container)).toEqual(['ja → en', 'en → ja']);
    // Moved into the adapter's `gate` (Task 8) — must render, and only once
    // (the branch's old standalone <EngineSection/> is gone).
    expect(container.querySelectorAll('[data-testid="engine-section-gate"]')).toHaveLength(1);
  });

  it('a set engineSlotTarget in advanced mode renders the surface with that slot expanded, and clears the signal (Task 10)', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    const { container } = render(
      <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
    );

    const slot = container.querySelector('.engine-slot[data-slot="ja→en:asr"]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('.engine-slot__body')).not.toBeNull();
    // Every other slot stays collapsed — only the targeted one opens.
    expect(container.querySelectorAll('.engine-slot__body')).toHaveLength(1);

    // One-shot: consumed immediately, not left around for a later mount.
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
  });
});
