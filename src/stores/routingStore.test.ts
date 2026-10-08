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
  useRoutingStore.setState({ meeting: true, participantSpeech: false, faceToFaceSwap: false });
});

describe('routingStore', () => {
  it('lets the meeting hear the translation and keeps participant speech off, until something was saved', async () => {
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: true, participantSpeech: false });
    stored.set('settings.routing.meeting', false);
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: false, participantSpeech: false });
  });

  // The owner, 2026-10-01: the switch is hidden and participant speech stays
  // off, so a choice saved while it showed must not turn it on unseen. The
  // saved value is left as it was, not rewritten.
  it('keeps participant speech off while its switch is hidden, whatever was saved', async () => {
    stored.set('settings.routing.participantSpeech', true);
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState().participantSpeech).toBe(false);
    expect(stored.get('settings.routing.participantSpeech')).toBe(true);
    expect(setSetting).not.toHaveBeenCalled();
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

describe('routingStore — face-to-face ears', () => {
  it('keeps my ear on the left by default and persists a swap', async () => {
    expect(useRoutingStore.getState().faceToFaceSwap).toBe(false);
    useRoutingStore.getState().setFaceToFaceSwap(true);
    expect(useRoutingStore.getState().faceToFaceSwap).toBe(true);
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.routing.faceToFaceSwap', true));
  });

  it('loads a saved swap, and a non-boolean as no swap', async () => {
    stored.set('settings.routing.faceToFaceSwap', true);
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState().faceToFaceSwap).toBe(true);
    stored.set('settings.routing.faceToFaceSwap', 'yes');
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState().faceToFaceSwap).toBe(false);
  });
});
