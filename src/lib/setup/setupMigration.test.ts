import { describe, it, expect } from 'vitest';
import { planSetupMigration } from './setupMigration';
import { SETUP_VERSION, TOUR_VERSION } from './types';

const NOW = '2026-08-25T00:00:00.000Z';
const base = { persistedUiMode: null, legacyUserType: null, legacyOnboarding: null, persistedProvider: 'openai', now: NOW };

describe('planSetupMigration', () => {
  it('does nothing for a fresh install — the wizard must show', () => {
    expect(planSetupMigration(base)).toEqual({ setup: null, tour: null, clearLegacyKeys: false });
  });

  it('marks setup complete for a user who has a persisted uiMode (synced profile, no localStorage)', () => {
    const plan = planSetupMigration({ ...base, persistedUiMode: 'advanced', persistedProvider: 'soniox' });
    expect(plan.setup).toEqual({
      version: SETUP_VERSION, scenario: null, providerPath: null,
      provider: 'soniox', completedAt: NOW, migratedFrom: 'legacy',
    });
    expect(plan.tour).toBeNull();
    expect(plan.clearLegacyKeys).toBe(true);
  });

  it('marks setup complete for a user who only has the localStorage user type', () => {
    const plan = planSetupMigration({ ...base, legacyUserType: 'regular' });
    expect(plan.setup?.migratedFrom).toBe('legacy');
    expect(plan.clearLegacyKeys).toBe(true);
  });

  it('carries a completed legacy tour over as a completed basics chapter', () => {
    const plan = planSetupMigration({
      ...base, legacyUserType: 'experienced',
      legacyOnboarding: JSON.stringify({ completed: true, version: '1.2.0', completedAt: '2026-01-01T00:00:00.000Z' }),
    });
    expect(plan.tour).toEqual({
      version: TOUR_VERSION, completedChapters: ['basics'], completedAt: NOW, method: 'migrated',
    });
  });

  it('ignores a legacy tour record that is not marked completed, or is unparseable', () => {
    expect(planSetupMigration({ ...base, legacyUserType: 'regular', legacyOnboarding: '{"completed":false}' }).tour).toBeNull();
    expect(planSetupMigration({ ...base, legacyUserType: 'regular', legacyOnboarding: 'not json' }).tour).toBeNull();
  });

  it('never invents a tour record for a user with no setup evidence', () => {
    const plan = planSetupMigration({ ...base, legacyOnboarding: '{"completed":true}' });
    expect(plan).toEqual({ setup: null, tour: null, clearLegacyKeys: false });
  });
});
