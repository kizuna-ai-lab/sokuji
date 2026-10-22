/**
 * Is a user-chosen colour light or dark? (spec 2026-10-22 §3)
 *
 * The conversation area and the subtitle view are painted in colours the user
 * picked, and keep them in both app themes. Their palette (the people's
 * colours, badges, overlays) therefore follows their own background, not the
 * app's scheme: the surface carries `data-tone`, and theme.scss repeats the
 * full token set under it.
 *
 * One rule decides "light or dark" everywhere a user colour is read: a
 * background is dark when white text contrasts better with it than black
 * does, which by WCAG relative luminance is the 0.179 threshold. (The subtitle
 * highlight overlay used to decide by YIQ brightness; the two disagree only on
 * saturated colours, where this rule is the one that picks the legible text.)
 */

export type Tone = 'dark' | 'light';

/** WCAG 2.x relative luminance of a 6-digit hex colour, with or without `#`. */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Luminance at which black and white text contrast equally: sqrt(1.05 * 0.05) - 0.05. */
const THRESHOLD = 0.179;

/** `dark` when white reads better on the colour than black; a value the picker cannot produce is `dark`. */
export function toneOf(hex: string): Tone {
  try {
    return relativeLuminance(hex) < THRESHOLD ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}
