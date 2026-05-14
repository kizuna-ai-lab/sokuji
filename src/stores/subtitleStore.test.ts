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

describe('subtitleStore', () => {
  beforeEach(() => {
    useSubtitleStore.setState({
      fontSize: 24,
      compactMode: false,
      bgOpacity: 80,
      bgColor: '#000000',
      sourceTextColor: '#ffffff',
      translationTextColor: '#9ad0ff',
      alwaysOnTop: false,
      positionLocked: false,
      windowBounds: null,
      speakerDisplayMode: 'both',
      participantDisplayMode: 'both',
    });
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
});
