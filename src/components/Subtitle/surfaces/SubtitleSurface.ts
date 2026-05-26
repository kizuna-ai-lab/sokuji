export interface SubtitleSurface {
  /** Open subtitle mode. Must be called inside a user gesture. */
  enter(): Promise<void>;
  /** Exit subtitle mode. Idempotent. */
  exit(): Promise<void>;
  /**
   * Toggle OS-level fullscreen for the subtitle surface. Electron-only;
   * other surfaces implement this as a no-op.
   */
  setFullscreen(flag: boolean): Promise<void>;
}
