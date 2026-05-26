// src/components/Subtitle/surfaces/getSubtitleSurface.ts
import { isElectron, isExtension } from '../../../utils/environment';
import type { SubtitleSurface } from './SubtitleSurface';
import { ElectronSubtitleSurface } from './ElectronSubtitleSurface';
import { ExtensionContentScriptSubtitleSurface } from './ExtensionContentScriptSubtitleSurface';

class NoopSubtitleSurface implements SubtitleSurface {
  async enter(): Promise<void> {
    throw new Error('Subtitle mode is not supported in this context');
  }
  async exit(): Promise<void> { /* no-op */ }
  async setFullscreen(_flag: boolean): Promise<void> { /* no-op */ }
}

let cached: SubtitleSurface | null = null;

export function getSubtitleSurface(): SubtitleSurface {
  if (cached) return cached;
  if (isElectron()) {
    cached = new ElectronSubtitleSurface();
  } else if (isExtension()) {
    cached = new ExtensionContentScriptSubtitleSurface();
  } else {
    cached = new NoopSubtitleSurface();
  }
  return cached;
}

// Test-only reset hook
export function __resetSubtitleSurfaceForTests() { cached = null; }
