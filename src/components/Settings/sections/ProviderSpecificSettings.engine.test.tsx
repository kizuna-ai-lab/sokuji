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
 * headings apart ("日本語 → English" vs "English → 日本語" — resolved
 * language NAMES, not the raw 'ja'/'en' codes, per the languageName spec).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

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
const { default: useAudioStore } = await import('../../../stores/audioStore');
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
  // Direction visibility is mode-scoped (2026-08-23): these composition
  // tests assert BOTH legs, so pin 'both' — the store default is 'speaker'.
  useAudioStore.setState({ mode: 'both' } as never);
});

describe('ProviderSpecificSettings — Engine surface composition (Task 7 review carry-over)', () => {
  it('LOCAL_INFERENCE: EngineSurface renders with both direction headings, no engine gate', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    const { container } = render(
      <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
    );
    expect(directionHeadings(container)).toEqual(['日本語 → English', 'English → 日本語']);
    // The WASM adapter carries no `gate` — EngineSection is a native-only concern.
    expect(container.querySelector('[data-testid="engine-section-gate"]')).toBeNull();
  });

  it('LOCAL_NATIVE: EngineSurface renders with both direction headings and the EngineSection gate, exactly once', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE });
    const { container } = render(
      <ProviderSpecificSettings {...baseProps} config={new LocalNativeProviderConfig().getConfig()} />,
    );
    expect(directionHeadings(container)).toEqual(['日本語 → English', 'English → 日本語']);
    // Moved into the adapter's `gate` (Task 8) — must render, and only once
    // (the branch's old standalone <EngineSection/> is gone).
    expect(container.querySelectorAll('[data-testid="engine-section-gate"]')).toHaveLength(1);
  });

  it('a set engineSlotTarget in advanced mode flashes that slot row, and clears the signal (Task 10, dropdown form)', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    const { container } = render(
      <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
    );

    // Dropdown form: nothing expands anymore — the deep link's landing is
    // the flash on the targeted row, and only on it.
    const slot = container.querySelector('.engine-slot[data-slot="ja→en:asr"]');
    expect(slot).not.toBeNull();
    expect(slot!.classList.contains('highlight')).toBe(true);
    expect(container.querySelectorAll('.engine-slot.highlight')).toHaveLength(1);

    // One-shot: consumed immediately, not left around for a later mount.
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
  });

  // I1 (final-review carry-over): EngineSurface used to key its host's
  // useState initializer off `initialSlot`, so re-firing the SAME (dir,
  // stage) target after the user collapsed that slot's header was a no-op —
  // the slot string was unchanged, so nothing observed the new object. The
  // fix makes EngineSurface respond to the PROP's identity via an effect, and
  // every deep-link (openSlot in ProviderSection) allocates a fresh object,
  // so two chip taps on the same model chip are never equal by reference.
  it('re-firing the same slot target re-flashes the row (same chip tapped twice)', () => {
    vi.useFakeTimers();
    try {
      useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
      useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

      const { container } = render(
        <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
      );

      const slot = container.querySelector('.engine-slot[data-slot="ja→en:asr"]')!;
      expect(slot.classList.contains('highlight')).toBe(true);

      // Let the first flash (and the surface's own 3.5s signal expiry) lapse.
      act(() => { vi.advanceTimersByTime(3600); });
      expect(slot.classList.contains('highlight')).toBe(false);

      // The same chip fires again: a FRESH object with the identical
      // dir/stage (mirrors openSlot allocating {dir, stage} per click).
      act(() => {
        useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });
      });
      expect(slot.classList.contains('highlight')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pushed Library page pops back to the Engine page when a NEW slot target fires', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_INFERENCE });
    useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'asr' });

    const { container } = render(
      <ProviderSpecificSettings {...baseProps} config={new LocalInferenceProviderConfig().getConfig()} />,
    );

    const asrSlot = container.querySelector('.engine-slot[data-slot="ja→en:asr"]')!;
    fireEvent.change(asrSlot.querySelector('select')!, { target: { value: '__browse__' } });
    expect(container.querySelector('.engine-back-chip')).not.toBeNull();
    expect(container.querySelector('.engine-page')).toBeNull();

    // A different slot's chip fires while the Library is showing — the surface
    // must land back on the Engine page with the NEW slot flashed, not stay
    // pushed on the old Library view.
    act(() => {
      useSettingsStore.getState().setEngineSlotTarget({ dir: 'ja→en', stage: 'translation' });
    });

    expect(container.querySelector('.engine-back-chip')).toBeNull();
    const translationSlot = container.querySelector('.engine-slot[data-slot="ja→en:translation"]')!;
    expect(translationSlot.classList.contains('highlight')).toBe(true);
  });
});
