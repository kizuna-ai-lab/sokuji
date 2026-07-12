import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSubtitleStore, useSubtitleFontSize, useSubtitlePositionLocked } from './subtitleStore';

// Mock SettingsService factory to capture setSetting calls
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: vi.fn(async (key: string, def: unknown) => def),
      setSetting: vi.fn(async () => ({ success: true })),
    }),
  },
}));

const setAlwaysOnTopSpy = vi.fn(async () => {});
vi.mock('../components/Subtitle/surfaces/getSubtitleSurface', () => ({
  getSubtitleSurface: () => ({
    enter: vi.fn(), exit: vi.fn(), setFullscreen: vi.fn(),
    setAlwaysOnTop: (flag: boolean) => setAlwaysOnTopSpy(flag),
  }),
}));

describe('subtitleStore', () => {
  beforeEach(() => {
    useSubtitleStore.setState({
      fontSize: 24,
      compactMode: false,
      bgOpacity: 80,
      bgColor: '#000000',
      sourceTextColor: '#ffffff',
      translationTextColor: '#9ad0ff',
      newItemHighlightEnabled: true,
      alwaysOnTop: false,
      positionLocked: false,
      windowBounds: null,
      speakerDisplayMode: 'both',
      participantDisplayMode: 'both',
    });
  });

  it('setNewItemHighlightEnabled flips the boolean and defaults to true', async () => {
    expect(useSubtitleStore.getState().newItemHighlightEnabled).toBe(true);
    await useSubtitleStore.getState().setNewItemHighlightEnabled(false);
    expect(useSubtitleStore.getState().newItemHighlightEnabled).toBe(false);
    await useSubtitleStore.getState().setNewItemHighlightEnabled(true);
    expect(useSubtitleStore.getState().newItemHighlightEnabled).toBe(true);
  });

  it('clamps fontSize to [12, 64]', async () => {
    await useSubtitleStore.getState().setFontSize(8);
    expect(useSubtitleStore.getState().fontSize).toBe(12);
    await useSubtitleStore.getState().setFontSize(99);
    expect(useSubtitleStore.getState().fontSize).toBe(64);
    await useSubtitleStore.getState().setFontSize(28);
    expect(useSubtitleStore.getState().fontSize).toBe(28);
  });

  it('clamps bgOpacity to [0, 100]', async () => {
    await useSubtitleStore.getState().setBgOpacity(-5);
    expect(useSubtitleStore.getState().bgOpacity).toBe(0);
    await useSubtitleStore.getState().setBgOpacity(120);
    expect(useSubtitleStore.getState().bgOpacity).toBe(100);
  });

  it('togglePositionLocked flips the boolean', async () => {
    expect(useSubtitleStore.getState().positionLocked).toBe(false);
    await useSubtitleStore.getState().togglePositionLocked();
    expect(useSubtitleStore.getState().positionLocked).toBe(true);
    await useSubtitleStore.getState().togglePositionLocked();
    expect(useSubtitleStore.getState().positionLocked).toBe(false);
  });

  it('setSpeakerDisplayMode / setParticipantDisplayMode store the new mode', async () => {
    await useSubtitleStore.getState().setSpeakerDisplayMode('translation');
    expect(useSubtitleStore.getState().speakerDisplayMode).toBe('translation');
    await useSubtitleStore.getState().setParticipantDisplayMode('source');
    expect(useSubtitleStore.getState().participantDisplayMode).toBe('source');
  });

  it('saveWindowBounds stores the rect (Electron path)', async () => {
    const b = { x: 10, y: 20, width: 800, height: 200 };
    await useSubtitleStore.getState().saveWindowBounds(b);
    expect(useSubtitleStore.getState().windowBounds).toEqual(b);
  });

  it('selector hooks exist and return current value', () => {
    // Render-less selector usage via getState().
    useSubtitleStore.setState({ fontSize: 30 });
    expect(useSubtitleStore.getState().fontSize).toBe(30);
    expect(typeof useSubtitleFontSize).toBe('function');
    expect(typeof useSubtitlePositionLocked).toBe('function');
  });
  it('toggleAlwaysOnTop applies the change to the live window (not just persistence)', async () => {
    // always-on-top is a native window property: toggling while the subtitle
    // window is open must invoke the surface so the main process re-applies it,
    // not merely persist the value for the next window creation.
    setAlwaysOnTopSpy.mockClear();
    expect(useSubtitleStore.getState().alwaysOnTop).toBe(false);
    await useSubtitleStore.getState().toggleAlwaysOnTop();
    expect(useSubtitleStore.getState().alwaysOnTop).toBe(true);
    expect(setAlwaysOnTopSpy).toHaveBeenCalledWith(true);
    await useSubtitleStore.getState().toggleAlwaysOnTop();
    expect(setAlwaysOnTopSpy).toHaveBeenCalledWith(false);
  });
});
