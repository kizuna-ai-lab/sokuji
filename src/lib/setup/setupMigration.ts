// src/lib/setup/setupMigration.ts
//
// Decides, from the evidence an existing install leaves behind, whether the
// user has already been through first-run — before the wizard existed — and
// therefore must never see it (spec §3.1). Pure: the store gathers the
// evidence and applies the plan.
import { SETUP_VERSION, TOUR_VERSION } from './types';
import type { SetupRecord, TourRecord } from './types';

/** localStorage keys the pre-wizard OnboardingContext wrote. */
export const LEGACY_USER_TYPE_KEY = 'sokuji_user_type';
export const LEGACY_ONBOARDING_KEY = 'sokuji_onboarding_completed';

/** Spec §3.1 removes the legacy localStorage keys, but OnboardingContext still
 *  reads them until the tour replaces it (spec §3.2). Flip this to true in the
 *  same change that deletes OnboardingContext; until then the keys stay. */
export const LEGACY_KEYS_RETIRED = false;

export interface LegacyEvidence {
  /** Raw `settings.common.uiMode` from SettingsService, null when absent.
   *  Every user of the old choice screen wrote it, and in the extension it
   *  roams with the synced profile — so it is the evidence that survives a
   *  new machine. */
  persistedUiMode: string | null;
  /** Raw localStorage `sokuji_user_type`, null when absent. */
  legacyUserType: string | null;
  /** Raw localStorage `sokuji_onboarding_completed` JSON, null when absent. */
  legacyOnboarding: string | null;
  /** Raw `settings.common.provider` (already defaulted by the caller). */
  persistedProvider: string;
  now: string;
}

export interface MigrationPlan {
  setup: SetupRecord | null;
  tour: TourRecord | null;
  clearLegacyKeys: boolean;
}

function legacyTourCompleted(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { completed?: unknown };
    return parsed?.completed === true;
  } catch {
    return false;
  }
}

export function planSetupMigration(e: LegacyEvidence): MigrationPlan {
  const isLegacyUser = e.persistedUiMode !== null || e.legacyUserType !== null;
  if (!isLegacyUser) return { setup: null, tour: null, clearLegacyKeys: false };

  const setup: SetupRecord = {
    version: SETUP_VERSION,
    scenario: null,
    providerPath: null,
    provider: e.persistedProvider,
    completedAt: e.now,
    migratedFrom: 'legacy',
  };
  const tour: TourRecord | null = legacyTourCompleted(e.legacyOnboarding)
    ? { version: TOUR_VERSION, completedChapters: ['basics'], completedAt: e.now, method: 'migrated' }
    : null;
  return { setup, tour, clearLegacyKeys: true };
}
