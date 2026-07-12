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
  /**
   * Apply always-on-top to the live subtitle window. Electron-only (a native
   * window property); other surfaces implement this as a no-op. The persisted
   * value is applied at window creation via enter(); this keeps the OPEN
   * window in sync when the user toggles it.
   */
  setAlwaysOnTop(flag: boolean): Promise<void>;
}
