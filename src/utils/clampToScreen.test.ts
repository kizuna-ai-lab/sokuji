import { describe, it, expect } from 'vitest';
import { clampToScreen } from './clampToScreen';

describe('clampToScreen', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1080 };

  it('returns the same bounds when fully inside', () => {
    const b = { x: 100, y: 100, width: 800, height: 200 };
    expect(clampToScreen(b, work)).toEqual(b);
  });

  it('clamps a window pushed off the right edge back inside', () => {
    const b = { x: 1500, y: 100, width: 800, height: 200 };
    expect(clampToScreen(b, work)).toEqual({ x: 1120, y: 100, width: 800, height: 200 });
  });

  it('clamps a window pushed off the bottom edge back inside', () => {
    const b = { x: 100, y: 1000, width: 800, height: 200 };
    expect(clampToScreen(b, work)).toEqual({ x: 100, y: 880, width: 800, height: 200 });
  });

  it('clamps a window with negative origin to (workArea.x, workArea.y)', () => {
    const b = { x: -50, y: -50, width: 800, height: 200 };
    expect(clampToScreen(b, work)).toEqual({ x: 0, y: 0, width: 800, height: 200 });
  });

  it('shrinks a window that is wider than the work area', () => {
    const b = { x: 0, y: 0, width: 3000, height: 200 };
    expect(clampToScreen(b, work)).toEqual({ x: 0, y: 0, width: 1920, height: 200 });
  });

  it('respects a non-zero work area origin (e.g. taskbar offset)', () => {
    const offsetWork = { x: 0, y: 40, width: 1920, height: 1040 };
    const b = { x: 100, y: 0, width: 800, height: 200 };
    expect(clampToScreen(b, offsetWork)).toEqual({ x: 100, y: 40, width: 800, height: 200 });
  });
});
