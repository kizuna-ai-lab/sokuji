// Hex <-> HSV conversions backing the in-app color picker.
//
// HSV, not HSL, because the picker's 2D area is the conventional
// saturation-x / value-y square sitting under a hue slider.
//
// Deliberately unrounded: hexToHsv keeps full float precision so a color the
// user never touched survives hsvToHex(hexToHsv(c)) byte-for-byte. Rounding
// h/s/v to integers here would silently drift every preset by a step or two
// the moment the picker opened. Round at the point of *display* instead.

export interface Hsv {
  /** Hue in degrees, [0, 360). */
  h: number;
  /** Saturation, [0, 100]. */
  s: number;
  /** Value / brightness, [0, 100]. */
  v: number;
}

const HEX_RE = /^#?(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i;

/**
 * Canonicalize user input into `#rrggbb` (lowercase), expanding 3-digit
 * shorthand. Returns null for anything that is not a hex color — named CSS
 * colors and rgb() are intentionally not accepted, since the value is stored
 * and re-parsed as hex everywhere else.
 */
export function normalizeHex(input: string): string | null {
  const m = HEX_RE.exec(input.trim());
  if (!m) return null;
  const [, short, long] = m;
  const body = short
    ? short.split('').map((c) => c + c).join('')
    : long;
  return `#${body.toLowerCase()}`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function hexToHsv(hex: string): Hsv {
  const normalized = normalizeHex(hex);
  // Unparseable input degrades to black rather than throwing: this runs on
  // every render of a persisted setting, and a corrupt stored value must not
  // take the settings popover down with it.
  if (!normalized) return { h: 0, s: 0, v: 0 };

  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;

  const i = Math.floor(hue / 60) % 6;
  const f = hue / 60 - Math.floor(hue / 60);
  const p = val * (1 - sat);
  const q = val * (1 - f * sat);
  const t = val * (1 - (1 - f) * sat);

  const [r, g, b] = (
    [
      [val, t, p],
      [q, val, p],
      [p, val, t],
      [p, q, val],
      [t, p, val],
      [val, p, q],
    ] as const
  )[i];

  const byte = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}
