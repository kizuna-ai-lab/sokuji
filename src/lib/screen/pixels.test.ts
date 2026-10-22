import { describe, expect, it } from 'vitest';
import { CHANGE_THRESHOLD, fitInside, greyThumb, isBlank, meanAbsDiff } from './pixels';

function solid(r: number, g: number, b: number, width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([r, g, b, 255], i * 4);
  return rgba;
}

/** Black on the left edge to white on the right edge. */
function gradient(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round((x / (width - 1)) * 255);
      rgba.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return rgba;
}

describe('fitInside', () => {
  it('fits inside 1280×720 without upscaling', () => {
    expect(fitInside(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(fitInside(720, 1280)).toEqual({ width: 405, height: 720 });
    expect(fitInside(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('honours another bound, and keeps at least one pixel on a very thin picture', () => {
    expect(fitInside(4000, 2000, { width: 400, height: 400 })).toEqual({ width: 400, height: 200 });
    expect(fitInside(10_000, 2, { width: 1280, height: 720 })).toEqual({ width: 1280, height: 1 });
  });

  it('refuses a picture without area', () => {
    expect(() => fitInside(0, 720)).toThrow(RangeError);
    expect(() => fitInside(1280, -1)).toThrow(RangeError);
  });
});

describe('greyThumb', () => {
  it('reduces a picture to a 64×36 grey thumb, and tells a flat or black one from a lit one', () => {
    expect(greyThumb(solid(0, 0, 0, 128, 72), 128, 72)).toHaveLength(64 * 36);
    expect(isBlank(greyThumb(solid(0, 0, 0, 128, 72), 128, 72))).toBe(true);
    expect(isBlank(greyThumb(solid(40, 40, 40, 128, 72), 128, 72))).toBe(true); // flat
    expect(isBlank(greyThumb(gradient(128, 72), 128, 72))).toBe(false);
  });

  it('averages luma as 0.299R + 0.587G + 0.114B', () => {
    const thumb = greyThumb(solid(255, 0, 0, 128, 72), 128, 72);
    expect(thumb.every((v) => v === Math.round(0.299 * 255))).toBe(true);
    expect(greyThumb(solid(0, 255, 0, 128, 72), 128, 72)[0]).toBe(Math.round(0.587 * 255));
    expect(greyThumb(solid(0, 0, 255, 128, 72), 128, 72)[0]).toBe(Math.round(0.114 * 255));
  });

  it('box-averages: each thumb pixel is the mean of the block it covers', () => {
    // Left half black, right half white: the thumb's left half is 0, its right half 255.
    const rgba = solid(0, 0, 0, 128, 72);
    for (let y = 0; y < 72; y++) for (let x = 64; x < 128; x++) rgba.set([255, 255, 255, 255], (y * 128 + x) * 4);
    const thumb = greyThumb(rgba, 128, 72);
    expect(thumb[0]).toBe(0);
    expect(thumb[31]).toBe(0);
    expect(thumb[32]).toBe(255);
    expect(thumb[63]).toBe(255);
  });

  it('takes a smaller thumb and a picture smaller than it', () => {
    expect(greyThumb(solid(9, 9, 9, 10, 10), 10, 10, { width: 4, height: 2 })).toHaveLength(8);
    expect(greyThumb(solid(200, 200, 200, 3, 2), 3, 2)).toHaveLength(64 * 36);
  });

  it('refuses an array that is not width × height × 4', () => {
    expect(() => greyThumb(new Uint8ClampedArray(10), 128, 72)).toThrow(RangeError);
  });
});

describe('meanAbsDiff', () => {
  it('measures the mean absolute difference, 0 for the same picture', () => {
    const a = greyThumb(gradient(128, 72), 128, 72);
    expect(meanAbsDiff(a, a)).toBe(0);
    expect(meanAbsDiff(a, greyThumb(solid(255, 255, 255, 128, 72), 128, 72))).toBeGreaterThan(CHANGE_THRESHOLD);
  });

  it('is the mean of the per-pixel gaps', () => {
    expect(meanAbsDiff(new Uint8Array([0, 10, 20, 30]), new Uint8Array([4, 10, 10, 40]))).toBe((4 + 0 + 10 + 10) / 4);
  });

  it('refuses thumbs of different lengths', () => {
    expect(() => meanAbsDiff(new Uint8Array(3), new Uint8Array(4))).toThrow(RangeError);
  });
});

describe('isBlank', () => {
  it('is blank under a mean of 8, or with a variance under 1', () => {
    expect(isBlank(new Uint8Array(100).fill(7))).toBe(true);
    expect(isBlank(new Uint8Array(100).fill(200))).toBe(true); // bright but flat
    const dim = new Uint8Array(100);
    for (let i = 0; i < 100; i++) dim[i] = i % 2 === 0 ? 0 : 14; // mean 7, varied: still too dark
    expect(isBlank(dim)).toBe(true);
    const lit = new Uint8Array(100);
    for (let i = 0; i < 100; i++) lit[i] = i % 2 === 0 ? 30 : 60;
    expect(isBlank(lit)).toBe(false);
  });

  it('counts nothing as blank', () => {
    expect(isBlank(new Uint8Array(0))).toBe(true);
  });
});
