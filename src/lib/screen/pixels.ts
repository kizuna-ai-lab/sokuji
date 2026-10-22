/**
 * The arithmetic the frame sampler does on a picture, kept pure so it needs no
 * canvas: the size a picture is sent at, its 64×36 grey thumb, how far two
 * thumbs are apart, and whether one is flat (black is flat). Every function takes and
 * returns plain arrays and numbers.
 */

/** Past this mean absolute difference (0..255) between two grey thumbs, a picture counts as changed. */
export const CHANGE_THRESHOLD = 6;

export interface Size {
  width: number;
  height: number;
}

/** A rectangle: the top-left corner and the size, in whatever pixels the caller counts. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SEND_BOUND: Size = { width: 1280, height: 720 };
const THUMB: Size = { width: 64, height: 36 };

/**
 * A thumb whose grey variance (0..255 levels, squared) is under this reads as flat. Black is flat; a dark slide with
 * one bright title line is not (mean about 3, variance in the hundreds), and sensor or compression noise on an empty
 * picture averages out well under it on the 64×36 thumb.
 */
const BLANK_VARIANCE = 16;

/** The largest size with the picture's aspect that fits inside `max`; never larger than the picture. */
export function fitInside(width: number, height: number, max: Size = SEND_BOUND): Size {
  if (!(width > 0) || !(height > 0)) throw new RangeError(`fitInside needs a picture with area, not ${width}×${height}`);
  const scale = Math.min(1, max.width / width, max.height / height);
  return {
    width: Math.min(width, Math.max(1, Math.round(width * scale))),
    height: Math.min(height, Math.max(1, Math.round(height * scale))),
  };
}

/**
 * The picture reduced to `thumb` grey levels, each the mean luma
 * (0.299R + 0.587G + 0.114B) of the block of pixels it covers. A picture
 * smaller than the thumb repeats its pixels.
 */
export function greyThumb(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, thumb: Size = THUMB): Uint8Array {
  if (!(width > 0) || !(height > 0)) throw new RangeError(`greyThumb needs a picture with area, not ${width}×${height}`);
  if (rgba.length !== width * height * 4) {
    throw new RangeError(`greyThumb: ${rgba.length} bytes are not a ${width}×${height} RGBA picture`);
  }
  const out = new Uint8Array(thumb.width * thumb.height);
  for (let ty = 0; ty < thumb.height; ty++) {
    const y0 = Math.min(height - 1, Math.floor((ty * height) / thumb.height));
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / thumb.height));
    for (let tx = 0; tx < thumb.width; tx++) {
      const x0 = Math.min(width - 1, Math.floor((tx * width) / thumb.width));
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / thumb.width));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      }
      out[ty * thumb.width + tx] = Math.round(sum / ((x1 - x0) * (y1 - y0)));
    }
  }
  return out;
}

/** The mean of the per-pixel gaps between two thumbs of the same length, 0..255. */
export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new RangeError(`meanAbsDiff: thumbs of ${a.length} and ${b.length} pixels`);
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * A thumb that is flat (grey variance under 16), however bright or dark: a minimized, covered or black window. How
 * dark it is does not count, so a black slide with a white title is sent. Nothing at all is blank.
 */
export function isBlank(grey: Uint8Array): boolean {
  if (grey.length === 0) return true;
  let sum = 0;
  for (let i = 0; i < grey.length; i++) sum += grey[i];
  const mean = sum / grey.length;
  let squares = 0;
  for (let i = 0; i < grey.length; i++) squares += (grey[i] - mean) ** 2;
  return squares / grey.length < BLANK_VARIANCE;
}
