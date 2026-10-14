import { describe, it, expect, vi } from 'vitest';

const setSetting = vi.fn(async () => ({ success: true }));
const getSetting = vi.fn(async (key: string, def: unknown) => (key.endsWith('showReadings') ? true : def));
vi.mock('../services/ServiceFactory', () => ({ ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) } }));

const { useSubtitleStore } = await import('./subtitleStore');

describe('subtitleStore readings switch', () => {
  it('is off by default, persists under settings.common.subtitle, and hydrates', async () => {
    expect(useSubtitleStore.getState().showReadings).toBe(false);
    await useSubtitleStore.getState().setShowReadings(true);
    expect(setSetting).toHaveBeenCalledWith('settings.common.subtitle.showReadings', true);
    useSubtitleStore.setState({ showReadings: false } as never);
    await useSubtitleStore.getState().hydrate();
    expect(useSubtitleStore.getState().showReadings).toBe(true);
  });
});
