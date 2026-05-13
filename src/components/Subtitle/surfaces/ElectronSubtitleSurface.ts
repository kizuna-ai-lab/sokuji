import type { SubtitleSurface } from './SubtitleSurface';
import { useSubtitleStore } from '../../../stores/subtitleStore';

export class ElectronSubtitleSurface implements SubtitleSurface {
  async enter(): Promise<void> {
    const { windowBounds, alwaysOnTop, positionLocked } = useSubtitleStore.getState();
    await window.electron?.invoke('subtitle:enter', {
      bounds: windowBounds ?? undefined,
      alwaysOnTop,
      locked: positionLocked,
    });
  }

  async exit(): Promise<void> {
    const { windowBounds } = useSubtitleStore.getState();
    await window.electron?.invoke('subtitle:exit', {
      restoreBounds: windowBounds ?? undefined,
    });
  }
}
