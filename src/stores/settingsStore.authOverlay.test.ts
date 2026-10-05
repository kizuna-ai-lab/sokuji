import { describe, expect, it, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('authOverlay reason (spec 2026-10-05 §5)', () => {
  beforeEach(() => { useSettingsStore.setState({ authOverlay: null, authOverlayReason: null }); });

  it('opening the sign-in form with a reason keeps it; closing clears it', () => {
    useSettingsStore.getState().setAuthOverlay('sign-in', 'session_expired');
    expect(useSettingsStore.getState()).toMatchObject({ authOverlay: 'sign-in', authOverlayReason: 'session_expired' });
    useSettingsStore.getState().setAuthOverlay(null);
    expect(useSettingsStore.getState().authOverlayReason).toBeNull();
  });

  it('a reason belongs to the sign-in form only', () => {
    useSettingsStore.getState().setAuthOverlay('sign-in', 'session_expired');
    useSettingsStore.getState().setAuthOverlay('sign-up');
    expect(useSettingsStore.getState().authOverlayReason).toBeNull();
    useSettingsStore.getState().setAuthOverlay('sign-in');
    expect(useSettingsStore.getState().authOverlayReason).toBeNull();
  });
});
