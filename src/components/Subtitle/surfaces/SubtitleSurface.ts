export interface SubtitleSurface {
  /** Open subtitle mode. Must be called inside a user gesture. */
  enter(): Promise<void>;
  /** Exit subtitle mode. Idempotent. */
  exit(): Promise<void>;
}
