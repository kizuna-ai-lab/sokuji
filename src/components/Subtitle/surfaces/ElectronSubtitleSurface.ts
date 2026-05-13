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
    // Empty payload on purpose: the main process snapshots the pre-subtitle
    // bounds on subtitle:enter and restores from that snapshot here. The
    // renderer must NOT pass restoreBounds — subtitleStore.windowBounds is
    // the *subtitle* window's bounds (the small floating bar), so sending
    // it would shrink the window to subtitle size instead of restoring
    // normal mode.
    await window.electron?.invoke('subtitle:exit', {});
  }
}
