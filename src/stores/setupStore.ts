// src/stores/setupStore.ts
//
// Whether first-run setup has happened, and whether the tour has been seen.
// Two records, both persisted through SettingsService so they roam with the
// rest of the profile in the extension (spec §1.5, §2.3). Hydration runs the
// legacy migration (spec §3.1) exactly once: when no setup record exists yet.
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ServiceFactory } from '../services/ServiceFactory';
import { SETUP_VERSION, TOUR_VERSION } from '../lib/setup/types';
import type { ProviderPath, ScenarioId, SetupRecord, TourChapter, TourRecord } from '../lib/setup/types';
import { planSetupMigration, LEGACY_USER_TYPE_KEY, LEGACY_ONBOARDING_KEY, LEGACY_KEYS_RETIRED } from '../lib/setup/setupMigration';

export const SETUP_STORAGE_KEY = 'settings.setup';
export const TOUR_STORAGE_KEY = 'settings.tour';

export interface SetupStore {
  setup: SetupRecord | null;
  tour: TourRecord | null;
  /** False until hydrate() has resolved. MainLayout must not decide whether
   *  to show the wizard before this is true, or a migrated user would see it
   *  flash on every launch. */
  loaded: boolean;
  hydrate: () => Promise<void>;
  completeSetup: (r: { scenario: ScenarioId; providerPath: ProviderPath; provider: string }) => Promise<void>;
  completeTour: (chapter: TourChapter, method: 'finished' | 'skipped') => Promise<void>;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

export const useSetupStore = create<SetupStore>()(
  subscribeWithSelector((set, get) => ({
    setup: null,
    tour: null,
    loaded: false,

    hydrate: async () => {
      const service = ServiceFactory.getSettingsService();
      try {
        const existing = await service.getSetting<SetupRecord | null>(SETUP_STORAGE_KEY, null);
        const tour = await service.getSetting<TourRecord | null>(TOUR_STORAGE_KEY, null);
        if (existing) {
          set({ setup: existing, tour, loaded: true });
          return;
        }
        const plan = planSetupMigration({
          persistedUiMode: await service.getSetting<string | null>('settings.common.uiMode', null),
          legacyUserType: readLocal(LEGACY_USER_TYPE_KEY),
          legacyOnboarding: readLocal(LEGACY_ONBOARDING_KEY),
          persistedProvider: await service.getSetting<string>('settings.common.provider', 'openai'),
          now: new Date().toISOString(),
        });
        if (plan.setup) await service.setSetting(SETUP_STORAGE_KEY, plan.setup);
        if (plan.tour) await service.setSetting(TOUR_STORAGE_KEY, plan.tour);
        if (plan.clearLegacyKeys && LEGACY_KEYS_RETIRED) {
          removeLocal(LEGACY_USER_TYPE_KEY);
          removeLocal(LEGACY_ONBOARDING_KEY);
        }
        set({ setup: plan.setup, tour: plan.tour ?? tour, loaded: true });
      } catch (error) {
        console.error('[SetupStore] Error hydrating setup state:', error);
        set({ loaded: true });
      }
    },

    completeSetup: async ({ scenario, providerPath, provider }) => {
      const record: SetupRecord = {
        version: SETUP_VERSION,
        scenario,
        providerPath,
        provider,
        completedAt: new Date().toISOString(),
      };
      set({ setup: record });
      await ServiceFactory.getSettingsService().setSetting(SETUP_STORAGE_KEY, record);
    },

    completeTour: async (chapter, method) => {
      const prev = get().tour;
      const chapters = prev?.completedChapters ?? [];
      const record: TourRecord = {
        version: TOUR_VERSION,
        completedChapters: chapters.includes(chapter) ? chapters : [...chapters, chapter],
        completedAt: new Date().toISOString(),
        method,
      };
      set({ tour: record });
      await ServiceFactory.getSettingsService().setSetting(TOUR_STORAGE_KEY, record);
    },
  })),
);

export const useSetupRecord = () => useSetupStore((s) => s.setup);
export const useTourRecord = () => useSetupStore((s) => s.tour);
export const useSetupLoaded = () => useSetupStore((s) => s.loaded);
/** True once hydration has run AND a setup record exists — the condition
 *  MainLayout uses to skip the wizard. */
export const useSetupComplete = () => useSetupStore((s) => s.loaded && s.setup !== null);
export const useCompleteSetup = () => useSetupStore((s) => s.completeSetup);
export const useCompleteTour = () => useSetupStore((s) => s.completeTour);
