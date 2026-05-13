// src/components/Subtitle/surfaces/getSubtitleSurface.ts
import { isElectron } from '../../../utils/environment';
import type { SubtitleSurface } from './SubtitleSurface';
import { ElectronSubtitleSurface } from './ElectronSubtitleSurface';

class NoopSubtitleSurface implements SubtitleSurface {
  async enter(): Promise<void> {
    throw new Error('Subtitle mode is not supported in this context');
  }
  async exit(): Promise<void> { /* no-op */ }
}

let cached: SubtitleSurface | null = null;

export function getSubtitleSurface(): SubtitleSurface {
  if (cached) return cached;
  if (isElectron()) {
    cached = new ElectronSubtitleSurface();
  } else {
    // ExtensionContentScriptSubtitleSurface lands in Task 11 — until then,
    // the extension build falls through to the no-op which throws on enter().
    cached = new NoopSubtitleSurface();
  }
  return cached;
}

// Test-only reset hook
export function __resetSubtitleSurfaceForTests() { cached = null; }
