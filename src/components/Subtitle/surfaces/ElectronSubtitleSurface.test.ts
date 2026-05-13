import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ElectronSubtitleSurface } from './ElectronSubtitleSurface';

// Mock SettingsService factory so subtitleStore can be imported without
// pulling audio worklet side-effects through ServiceFactory.
vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: vi.fn(async (_key: string, def: unknown) => def),
      setSetting: vi.fn(async () => ({ success: true })),
    }),
  },
}));

describe('ElectronSubtitleSurface', () => {
  const invoke = vi.fn(async () => ({ ok: true }));

  beforeEach(() => {
    invoke.mockClear();
    // @ts-ignore — minimal global stub
    globalThis.window = globalThis.window || {};
    // @ts-ignore
    (globalThis.window as any).electron = { invoke };
  });

  it('enter() sends subtitle:enter with bounds + alwaysOnTop + locked from subtitleStore', async () => {
    // Arrange — seed the subtitle store
    const { useSubtitleStore } = await import('../../../stores/subtitleStore');
    useSubtitleStore.setState({
      windowBounds: { x: 10, y: 20, width: 800, height: 200 },
      alwaysOnTop: true,
      positionLocked: false,
    });

    const surface = new ElectronSubtitleSurface();
    await surface.enter();

    expect(invoke).toHaveBeenCalledWith('subtitle:enter', {
      bounds: { x: 10, y: 20, width: 800, height: 200 },
      alwaysOnTop: true,
      locked: false,
    });
  });

  it('exit() sends subtitle:exit with an empty payload, regardless of stored windowBounds', async () => {
    // Regression: subtitleStore.windowBounds is the SUBTITLE window's bounds
    // (the small floating bar), not the main window's pre-subtitle bounds.
    // The main process captures pre-subtitle bounds itself on enter and
    // restores from that snapshot — the renderer must NOT pass restoreBounds,
    // or the window would shrink to subtitle size on exit.
    const { useSubtitleStore } = await import('../../../stores/subtitleStore');
    useSubtitleStore.setState({
      windowBounds: { x: 100, y: 800, width: 960, height: 200 },
    });

    const surface = new ElectronSubtitleSurface();
    await surface.exit();
    expect(invoke).toHaveBeenCalledWith('subtitle:exit', {});
  });

  it('exit() sends an empty payload even when no subtitle bounds were stored', async () => {
    const { useSubtitleStore } = await import('../../../stores/subtitleStore');
    useSubtitleStore.setState({
      windowBounds: null,
    });

    const surface = new ElectronSubtitleSurface();
    await surface.exit();
    expect(invoke).toHaveBeenCalledWith('subtitle:exit', {});
  });
});
