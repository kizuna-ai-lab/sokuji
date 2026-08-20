// electron/topmost-level.test.js
//
// The pinned subtitle bar and the popover child windows that hang off it must
// be pinned at the SAME always-on-top level. They are separate top-level
// windows — siblings, not parent/child — so the only thing that keeps a
// popover above the bar is being in the same z-order band and raised last.
// Disagree on the level and no amount of re-raising helps: on Windows every
// level except 'screen-saver' is followed by a second SetWindowPos that tucks
// the window BELOW the taskbar inside the topmost band, so a 'floating'
// popover sits permanently under a 'screen-saver' bar.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { topmostLevel } = nodeRequire('./topmost-level.js');

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const setPlatform = (value) =>
  Object.defineProperty(process, 'platform', { value, configurable: true });

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
});

describe('topmostLevel', () => {
  it('is screen-saver on Windows, the only level not demoted below the taskbar', () => {
    // 'screen-saver' is also what lets the bar beat a PowerPoint slideshow,
    // which sits above the taskbar itself (#326).
    setPlatform('win32');
    expect(topmostLevel()).toBe('screen-saver');
  });

  it('is floating elsewhere, where the level is honored by the WM as-is', () => {
    // On macOS this is a real NSWindow level and windows raised later win
    // within it; on Linux the WM owns the ordering. Neither needs — nor
    // benefits from — the Windows escape hatch.
    setPlatform('darwin');
    expect(topmostLevel()).toBe('floating');
    setPlatform('linux');
    expect(topmostLevel()).toBe('floating');
  });

  it('reads the platform per call, so a level is never baked in at load', () => {
    // The module is required once and shared by both windows; caching the
    // answer at import time would be invisible until it wasn't.
    setPlatform('win32');
    const first = topmostLevel();
    setPlatform('darwin');
    expect(topmostLevel()).not.toBe(first);
  });
});
