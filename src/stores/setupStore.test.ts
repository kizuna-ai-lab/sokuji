import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SettingsOperationResult } from '../services/interfaces/ISettingsService';

const store = new Map<string, unknown>();
const mockGetSetting = vi.fn(async (key: string, dflt: unknown) => (store.has(key) ? store.get(key) : dflt));
const mockSetSetting = vi.fn(async (key: string, value: unknown): Promise<SettingsOperationResult> => { store.set(key, value); return { success: true }; });
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: mockGetSetting, setSetting: mockSetSetting }) },
}));

const { useSetupStore, SetupPersistError, SETUP_STORAGE_KEY, TOUR_STORAGE_KEY } = await import('./setupStore');
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
    // LEGACY_KEYS_RETIRED is true: nothing reads these keys any more, so the
    // migration that consumed them is also the thing that clears them.
    expect(localStorage.getItem(LEGACY_USER_TYPE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_ONBOARDING_KEY)).toBeNull();
  });

  it('keeps the migrated record in memory but spares the legacy keys when the persist fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.set('settings.common.uiMode', 'basic');
    store.set('settings.common.provider', 'gemini');
    localStorage.setItem(LEGACY_USER_TYPE_KEY, 'regular');
    mockSetSetting.mockRejectedValueOnce(new Error('storage unavailable'));

    await useSetupStore.getState().hydrate();

    // Not re-asked this launch...
    const s = useSetupStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.setup).toMatchObject({ provider: 'gemini', migratedFrom: 'legacy' });
    // ...and the evidence survives, so the next launch can migrate again.
    expect(localStorage.getItem(LEGACY_USER_TYPE_KEY)).toBe('regular');

    errorSpy.mockRestore();
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

  it('rejects and keeps the record out of memory when the service reports failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSetSetting.mockResolvedValueOnce({ success: false, error: 'quota' });

    // Committing in memory first would unmount the wizard over a setup that was
    // never written: the record only becomes real once the write succeeded.
    await expect(useSetupStore.getState().completeSetup({ scenario: 'two-way-text', providerPath: 'own-key', provider: 'openai' }))
      .rejects.toThrow(SetupPersistError);

    expect(useSetupStore.getState().setup).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('settings.setup');

    errorSpy.mockRestore();
  });

  it('rejects and keeps the record out of memory when the service throws', async () => {
    // The extension path: chrome.storage.sync.set can throw synchronously, which
    // the service's own try/catch does not convert into { success: false }.
    mockSetSetting.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(useSetupStore.getState().completeSetup({ scenario: 'two-way-text', providerPath: 'own-key', provider: 'openai' }))
      .rejects.toThrow('storage unavailable');

    expect(useSetupStore.getState().setup).toBeNull();
  });

  it('still marks the tour done in memory when its persist fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSetSetting.mockRejectedValueOnce(new Error('storage unavailable'));

    // A failed write must never trap the user in the tour; re-running it on the
    // next launch is the accepted cost.
    await expect(useSetupStore.getState().completeTour('basics', 'finished')).resolves.toBeUndefined();

    expect(useSetupStore.getState().tour).toMatchObject({ completedChapters: ['basics'], method: 'finished' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('settings.tour');

    errorSpy.mockRestore();
  });
});
