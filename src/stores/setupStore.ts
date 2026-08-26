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
import { persistSetting } from '../services/persistSetting';
import { reportError, describeCause } from '../lib/diagnostics/report';

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

/** The setup record could not be written. Typed rather than a bare Error so the
 *  wizard can tell this apart from whatever else Finish may throw and show a
 *  translated line: this message is a diagnostic for the console, never copy. */
export class SetupPersistError extends Error {
  readonly code = 'SETUP_PERSIST_FAILED' as const;
  constructor() {
    super('Setup record could not be persisted');
    this.name = 'SetupPersistError';
  }
}

/* Writes go through `persistSetting` (src/services/persistSetting.ts).
 *
 * This module arrived with its own `persist`/`tryPersist` pair that read
 * `result.success` and caught rejection — the same two channels, derived
 * independently while the seam was in flight. Both are the seam's behaviour
 * exactly, including for the caller that wrapped `persist` in its own
 * try/catch, so they are gone: a failed write returns false, files one panel
 * warning per key, and never rejects. Swallowing it silently would leave the
 * wizard reappearing next launch with no explanation, which is what the
 * original comment here was guarding against.
 */

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
        // The migrated record goes into state either way: a write that failed is
        // no reason to ask an existing user to set the app up again this launch.
        const setupWritten = plan.setup ? await persistSetting(SETUP_STORAGE_KEY, plan.setup) : true;
        if (plan.tour) await persistSetting(TOUR_STORAGE_KEY, plan.tour);
        // The legacy keys are the only evidence a failed write leaves behind, so
        // they may only be dropped once the record they produced is safely stored.
        if (plan.clearLegacyKeys && LEGACY_KEYS_RETIRED && setupWritten) {
          removeLocal(LEGACY_USER_TYPE_KEY);
          removeLocal(LEGACY_ONBOARDING_KEY);
        }
        set({ setup: plan.setup, tour: plan.tour ?? tour, loaded: true });
      } catch (error) {
        // The app carries on with no setup record, which presents as the wizard
        // appearing for a user who already finished it.
        reportError('SetupStore', `Setup state could not be read: ${describeCause(error)}`, { cause: error });
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
      // Persist BEFORE committing in memory: the in-memory record unmounts the
      // wizard, and a wizard that is gone can neither report the failure nor
      // offer a retry. Throwing here reaches SetupWizard's Finish error path.
      // A rejecting service (the extension's storage can throw) is the same
      // failure as a reported one, so it surfaces as the same typed error and
      // the wizard shows its translated message rather than a raw stack line.
      // persistSetting absorbs both failure channels, so a rejecting service
      // (the extension's storage can throw) reaches the wizard as the same
      // typed error as a refused write, not as a raw stack line.
      if (!await persistSetting(SETUP_STORAGE_KEY, record)) {
        throw new SetupPersistError();
      }
      set({ setup: record });
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
      // The opposite trade-off to completeSetup: a failed write must never trap
      // the user in the tour, so the record lands in memory regardless and the
      // cost of the failure is at worst one re-run on the next launch.
      set({ tour: record });
      await persistSetting(TOUR_STORAGE_KEY, record);
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
