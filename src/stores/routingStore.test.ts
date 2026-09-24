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

import { useRoutingStore } from './routingStore';

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useRoutingStore.setState({ meeting: true, participantSpeech: false });
});

describe('routingStore', () => {
  it('lets the meeting hear the translation and keeps participant speech off, until something was saved', async () => {
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: true, participantSpeech: false });
    stored.set('settings.routing.meeting', false);
    stored.set('settings.routing.participantSpeech', true);
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: false, participantSpeech: true });
  });

  it('ignores a saved value that is not a boolean', async () => {
    stored.set('settings.routing.meeting', 'yes');
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState().meeting).toBe(true);
  });

  it('saves each switch', async () => {
    useRoutingStore.getState().setMeeting(false);
    useRoutingStore.getState().setParticipantSpeech(true);
    expect(useRoutingStore.getState()).toMatchObject({ meeting: false, participantSpeech: true });
    await vi.waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith('settings.routing.meeting', false);
      expect(setSetting).toHaveBeenCalledWith('settings.routing.participantSpeech', true);
    });
  });
});
