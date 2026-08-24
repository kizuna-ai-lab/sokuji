import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, unknown>();
const mockGetSetting = vi.fn(async (key: string, dflt: unknown) => (store.has(key) ? store.get(key) : dflt));
const mockSetSetting = vi.fn(async (key: string, value: unknown) => { store.set(key, value); return { success: true }; });
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: mockGetSetting, setSetting: mockSetSetting }) },
}));

const { useSetupStore, SETUP_STORAGE_KEY, TOUR_STORAGE_KEY } = await import('./setupStore');
const { SETUP_VERSION, TOUR_VERSION } = await import('../lib/setup/types');
const { LEGACY_USER_TYPE_KEY, LEGACY_ONBOARDING_KEY } = await import('../lib/setup/setupMigration');

beforeEach(() => {
  store.clear();
  localStorage.clear();
  vi.clearAllMocks();
  useSetupStore.setState({ setup: null, tour: null, loaded: false });
});

describe('setupStore.hydrate', () => {
  it('leaves setup null on a fresh install and marks loaded', async () => {
    await useSetupStore.getState().hydrate();
    expect(useSetupStore.getState()).toMatchObject({ setup: null, tour: null, loaded: true });
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it('reads an existing record without rewriting it', async () => {
    const record = { version: SETUP_VERSION, scenario: 'be-heard', providerPath: 'managed', provider: 'kizunaai_soniox', completedAt: 'x' };
    store.set(SETUP_STORAGE_KEY, record);
    await useSetupStore.getState().hydrate();
    expect(useSetupStore.getState().setup).toEqual(record);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it('migrates a legacy user: writes setup, carries the tour, clears localStorage', async () => {
    store.set('settings.common.uiMode', 'basic');
    store.set('settings.common.provider', 'gemini');
    localStorage.setItem(LEGACY_USER_TYPE_KEY, 'regular');
    localStorage.setItem(LEGACY_ONBOARDING_KEY, JSON.stringify({ completed: true }));

    await useSetupStore.getState().hydrate();

    const s = useSetupStore.getState();
    expect(s.setup).toMatchObject({ version: SETUP_VERSION, scenario: null, providerPath: null, provider: 'gemini', migratedFrom: 'legacy' });
    expect(s.tour).toMatchObject({ version: TOUR_VERSION, completedChapters: ['basics'], method: 'migrated' });
    expect(store.get(SETUP_STORAGE_KEY)).toEqual(s.setup);
    expect(store.get(TOUR_STORAGE_KEY)).toEqual(s.tour);
    // LEGACY_KEYS_RETIRED is false: OnboardingContext still reads these keys
    // until the tour replaces it, so hydrate must not clear them yet.
    expect(localStorage.getItem(LEGACY_USER_TYPE_KEY)).toBe('regular');
    expect(localStorage.getItem(LEGACY_ONBOARDING_KEY)).toBe(JSON.stringify({ completed: true }));
  });
});

describe('setupStore.completeSetup / completeTour', () => {
  it('writes a versioned setup record and exposes it', async () => {
    await useSetupStore.getState().completeSetup({ scenario: 'two-way-text', providerPath: 'own-key', provider: 'openai' });
    const rec = useSetupStore.getState().setup!;
    expect(rec).toMatchObject({ version: SETUP_VERSION, scenario: 'two-way-text', providerPath: 'own-key', provider: 'openai' });
    expect(typeof rec.completedAt).toBe('string');
    expect(store.get(SETUP_STORAGE_KEY)).toEqual(rec);
  });

  it('records a finished chapter once, preserving earlier chapters', async () => {
    await useSetupStore.getState().completeTour('basics', 'skipped');
    await useSetupStore.getState().completeTour('basics', 'finished');
    const rec = useSetupStore.getState().tour!;
    expect(rec.completedChapters).toEqual(['basics']);
    expect(rec.method).toBe('finished');
    expect(rec.version).toBe(TOUR_VERSION);
    expect(store.get(TOUR_STORAGE_KEY)).toEqual(rec);
  });
});
