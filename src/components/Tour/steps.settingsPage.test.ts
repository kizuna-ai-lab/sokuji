// The tour's settings steps on the one settings page (settings page plan,
// Task 10): each opens the category that holds the element it points at.
import { describe, it, expect, vi } from 'vitest';
import { BASICS_STEPS, type TourActions } from './steps';
import { categoryHolding, targetToCategory } from '../SettingsPage/categories';
import type { TourCtx } from './tourContext';

const settingsSteps = BASICS_STEPS.filter((s) => s.settingsTarget);

describe('the tour on the settings page', () => {
  it('names a settings target for each step that opens the settings', () => {
    expect(settingsSteps.map((s) => s.id)).toEqual(['microphone', 'monitor', 'participant-source', 'provider-settings', 'models']);
  });

  it('every settings step of the tour opens the category that holds its anchor', () => {
    for (const step of settingsSteps) {
      expect(categoryHolding(step.anchor!), step.id).toBe(targetToCategory(step.settingsTarget!).category);
    }
  });

  it('opens the settings at that target', () => {
    for (const step of settingsSteps) {
      const actions: TourActions = { openSettings: vi.fn(), closeSettings: vi.fn() };
      step.prepare!({} as TourCtx, actions);
      expect(actions.openSettings).toHaveBeenCalledWith(step.settingsTarget);
    }
  });

  it('opens the line-up for the models step, and Accounts and keys for the key step', () => {
    const target = (id: string) => BASICS_STEPS.find((s) => s.id === id)!.settingsTarget;
    expect(target('models')).toBe('model-management');
    expect(target('provider-settings')).toBe('provider');
  });
});
