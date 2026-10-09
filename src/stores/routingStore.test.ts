// src/stores/routingStore.test.ts
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
  useRoutingStore.setState({ meeting: true, participantSpeech: null });
});

describe('routingStore', () => {
  it('lets the meeting hear the translation, and leaves 我听到的翻译 on auto, until something was saved', async () => {
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: true, participantSpeech: null });
    stored.set('settings.routing.meeting', false);
    stored.set('settings.routing.participantSpeech', true);
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: false, participantSpeech: true });
  });

  it('ignores a saved value that is not a boolean', async () => {
    stored.set('settings.routing.meeting', 'yes');
    stored.set('settings.routing.participantSpeech', 'yes');
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: true, participantSpeech: null });
  });

  it('saves each switch, auto included', async () => {
    useRoutingStore.getState().setMeeting(false);
    useRoutingStore.getState().setParticipantSpeech(false);
    expect(useRoutingStore.getState()).toMatchObject({ meeting: false, participantSpeech: false });
    useRoutingStore.getState().setParticipantSpeech(null);
    expect(useRoutingStore.getState().participantSpeech).toBeNull();
    await vi.waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith('settings.routing.meeting', false);
      expect(setSetting).toHaveBeenCalledWith('settings.routing.participantSpeech', false);
      expect(setSetting).toHaveBeenCalledWith('settings.routing.participantSpeech', null);
    });
  });

  it('knows nothing of a face-to-face swap any more', async () => {
    stored.set('settings.routing.faceToFaceSwap', true);
    await useRoutingStore.getState().load();
    expect('faceToFaceSwap' in useRoutingStore.getState()).toBe(false);
  });
});
