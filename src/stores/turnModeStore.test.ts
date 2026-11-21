import { describe, it, expect, beforeEach, vi } from 'vitest';

const { stored, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return { stored, setSetting: vi.fn(async (key: string, value: unknown) => { stored.set(key, value); return { success: true }; }) };
});
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def),
      setSetting,
    }),
  },
}));

import { useTurnModeStore } from './turnModeStore';

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useTurnModeStore.setState({ turnMode: 'auto', pushKey: 'Space' });
});

describe('turnModeStore', () => {
  it('saves a new mode', async () => {
    useTurnModeStore.getState().setTurnMode('push-to-translate');
    expect(useTurnModeStore.getState().turnMode).toBe('push-to-translate');
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.common.turnMode', 'push-to-translate'));
  });

  it('starts with Space as the key that holds a turn', () => {
    expect(useTurnModeStore.getInitialState().pushKey).toBe('Space');
  });

  it('saves another key the user picks', async () => {
    useTurnModeStore.getState().setPushKey('F8');
    expect(useTurnModeStore.getState().pushKey).toBe('F8');
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.common.pushKey', 'F8'));
  });

  it('keeps the key it has when asked for one a hold cannot take', () => {
    useTurnModeStore.getState().setPushKey('Escape');
    expect(useTurnModeStore.getState().pushKey).toBe('Space');
    expect(setSetting).not.toHaveBeenCalled();
  });
});
