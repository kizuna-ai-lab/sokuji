// src/lib/setup/types.ts
//
// Shared vocabulary for the first-run setup wizard and the tour. A LEAF module:
// no imports. Both `settings.setup` and `settings.tour` are persisted through
// SettingsService with exactly these shapes, so a change here is a storage
// format change — bump the matching *_VERSION.

/** Bumped when SetupRecord's meaning changes. A different stored version does
 *  NOT re-show the wizard; it only tells a reader what shape to expect. */
export const SETUP_VERSION = 1;

/** Bumped when the tour's catalogue changes enough that a "restart" should be
 *  recorded as a different tour. Never auto-restarts the tour (spec §2.3). */
export const TOUR_VERSION = 1;

export type ScenarioId =
  | 'understand-others'
  | 'be-heard'
  | 'subtitle-myself'
  | 'two-way-voice'
  | 'two-way-text';

export type ProviderPath = 'managed' | 'own-key' | 'offline';

export type TourChapter = 'basics';

export interface SetupRecord {
  version: number;
  /** null for users migrated from the pre-wizard app (spec §3.1). */
  scenario: ScenarioId | null;
  providerPath: ProviderPath | null;
  /** Provider id at the time the wizard finished. Informational only: for a
   *  migrated user this is the raw persisted id and may name a retired or
   *  gated-out provider — read the live settings store for the current one.
   *  Never a behavioural input. */
  provider: string;
  completedAt: string;
  migratedFrom?: 'legacy';
}

export interface TourRecord {
  version: number;
  completedChapters: TourChapter[];
  completedAt: string;
  method: 'finished' | 'skipped' | 'migrated';
}
