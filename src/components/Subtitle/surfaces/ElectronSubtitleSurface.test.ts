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

  it('exit() sends subtitle:exit with restoreBounds undefined when none stored', async () => {
    const { useSubtitleStore } = await import('../../../stores/subtitleStore');
    useSubtitleStore.setState({
      windowBounds: null,
    });

    const surface = new ElectronSubtitleSurface();
    await surface.exit();
    expect(invoke).toHaveBeenCalledWith('subtitle:exit', { restoreBounds: undefined });
  });
});
