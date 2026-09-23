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
  useTurnModeStore.setState({ turnMode: 'auto' });
});

describe('turnModeStore', () => {
  it('starts automatic, and loads what was saved', async () => {
    expect(useTurnModeStore.getState().turnMode).toBe('auto');
    stored.set('settings.common.turnMode', 'push-to-talk');
    await useTurnModeStore.getState().load();
    expect(useTurnModeStore.getState().turnMode).toBe('push-to-talk');
  });

  it('ignores a saved value it does not know', async () => {
    stored.set('settings.common.turnMode', 'Semantic');
    await useTurnModeStore.getState().load();
    expect(useTurnModeStore.getState().turnMode).toBe('auto');
  });

  it('saves a new mode', async () => {
    useTurnModeStore.getState().setTurnMode('push-to-translate');
    expect(useTurnModeStore.getState().turnMode).toBe('push-to-translate');
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.common.turnMode', 'push-to-translate'));
  });
});
