/**
 * The guard for src/styles/theme.scss (spec 2026-10-22, §7).
 *
 * Four things, all read off the COMPILED stylesheet, never the Sass source:
 * the four blocks define the same token set; the dark block is pinned to the
 * owner's values so the dark theme cannot drift while the light one is tuned;
 * the light block clears the contrast floors, each role against the background
 * it sits on; and every `--sk-` name any stylesheet references is one the
 * theme defines, so a typo in a migration fails here instead of rendering
 * transparent.
 */
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const css = compile(resolve(__dirname, 'theme.scss')).css;

/**
 * The declarations of the one top-level rule whose selector is exactly
 * `selector`. Sass drops the quotes of an attribute value where it can
 * (`[data-theme=light]`), so the selector is matched without them.
 */
function block(sheet: string, selector: string): string {
  const esc = selector.replace(/"/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = sheet.match(new RegExp(String.raw`(?:^|\n)${esc}\s*\{([^}]*)\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

/** `--sk-` declarations of a block, values with their whitespace removed. */
function tokens(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of body.matchAll(/--sk-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1], m[2].replace(/\s+/g, ''));
  }
  return map;
}

/** The same map with `var(--sk-x)` references replaced by x's value in the same block. */
function resolved(map: Map<string, string>): Map<string, string> {
  const out = new Map(map);
  for (const [name, value] of out) {
    const ref = value.match(/^var\(--sk-([a-z0-9-]+)\)$/);
    if (ref) out.set(name, out.get(ref[1]) ?? value);
  }
  return out;
}

const luminance = (hex: string): number => {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`not a 6-digit hex: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const DARK = ':root';
const LIGHT = ':root[data-theme="light"]';
const TONE_DARK = '[data-tone="dark"]';
const TONE_LIGHT = '[data-tone="light"]';

// The dark column of spec §2, verbatim (R1, R7: today's literals plus the collapses).
const DARK_PINNED: Record<string, string> = {
  'bg-base': '#1a1a1a', 'bg-page': '#1e1e1e', 'bg-surface': '#252525', 'bg-bar': '#2a2a2a', 'bg-popover': '#2a2a2a',
  'bg-control': '#333333', 'bg-hover': '#3a3a3a', 'bg-elevated': '#444444', 'bg-elevated-hover': '#555555', 'bg-dim': '#666666',
  'white': '#ffffff',
  'text-primary': '#ffffff', 'text-secondary': '#cccccc', 'text-tertiary': '#aaaaaa', 'text-muted': '#888888',
  'text-dim': '#666666', 'text-disabled': '#555555', 'text-source': '#9aa0a6', 'on-accent': '#ffffff',
  'line': '#444444', 'line-subtle': '#333333', 'line-strong': '#555555',
  'overlay-fg': '#ffffff', 'overlay-bg': '#000000', 'scrim': 'rgba(0,0,0,0.6)', 'shadow': 'rgba(0,0,0,0.3)', 'shadow-strong': 'rgba(0,0,0,0.5)',
  'primary': '#0fbb8f', 'primary-hover': '#0da77f', 'primary-fill': '#008261', 'primary-fill-hover': '#006e52',
  'speaker': 'var(--sk-primary)', 'speaker-fill': 'var(--sk-primary-fill)', 'speaker-person-3': '#005c45',
  'participant': '#f39c12', 'participant-person-2': '#f8c471', 'participant-person-3': '#ca6f1e',
  'success': '#10a37f', 'error': '#e74c3c', 'error-deep': '#c0392b', 'warning': '#ffc107', 'recommended': '#f59e0b',
  'degraded': '#f39c12', 'usage': '#e67e22', 'usage-hover': '#f39c12', 'usage-deep': '#d35400', 'info': '#4285f4',
  'toolbar-icon': '#8a8a8a',
  'waveform-speaker': '#0099ff', 'waveform-participant': '#f59e0b', 'waveform-output': '#ff9900',
};

// Spec §7: the light block's floors, each role against the background it sits on.
const SURFACES = ['bg-page', 'bg-surface', 'bg-control'];
const LIGHT_FLOORS: [string, string, number][] = [
  ...['text-primary', 'text-secondary', 'text-tertiary', 'text-muted', 'text-source'].flatMap((fg) => SURFACES.map((bg): [string, string, number] => [fg, bg, 4.5])),
  ...['text-dim', 'toolbar-icon'].flatMap((fg) => SURFACES.map((bg): [string, string, number] => [fg, bg, 3])),
  ...['primary-fill', 'error', 'usage'].map((bg): [string, string, number] => ['on-accent', bg, 4.5]),
  ...['primary', 'participant', 'success', 'error', 'warning', 'degraded', 'info'].flatMap((fg) => ['bg-page', 'bg-surface'].map((bg): [string, string, number] => [fg, bg, 4.5])),
];

/** `color-mix(in srgb, fg p, bg)`: a component-wise blend of the two sRGB colours, as a hex. */
const tint = (fg: string, bg: string, p: number): string => {
  const ch = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [f, b] = [ch(fg), ch(bg)];
  return '#' + f.map((c, i) => Math.round(c * p + b[i] * (1 - p)).toString(16).padStart(2, '0')).join('');
};

// The status roles whose text sits on its own tint (and the accent, whose
// chips do), at the tints the stylesheets use, over the three light surfaces
// those tints are drawn on.
const TINTED_FLOORS: [string, number, string][] = ['warning', 'recommended', 'success', 'error', 'info', 'usage', 'primary'].flatMap((fg) =>
  [10, 15].flatMap((percent) => ['bg-page', 'bg-surface', 'bg-base'].map((bg): [string, number, string] => [fg, percent, bg])));

/** Every stylesheet under src/, the viewer included; partials only when asked. */
function stylesheets(dir: string, partials = false, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') stylesheets(path, partials, out);
    } else if (entry.endsWith('.scss') && (partials || !entry.startsWith('_'))) {
      out.push(path);
    }
  }
  return out;
}

describe('theme.scss', () => {
  it('defines the same token set in all four blocks', () => {
    const names = (sel: string) => [...tokens(block(css, sel)).keys()].sort();
    expect(names(LIGHT)).toEqual(names(DARK));
    expect(names(TONE_DARK)).toEqual(names(DARK));
    expect(names(TONE_LIGHT)).toEqual(names(DARK));
    expect(names(DARK)).toHaveLength(51);
  });

  it('sets color-scheme on the two root blocks only', () => {
    expect(block(css, DARK)).toMatch(/color-scheme:\s*dark/);
    expect(block(css, LIGHT)).toMatch(/color-scheme:\s*light/);
    expect(block(css, TONE_DARK)).not.toMatch(/color-scheme/);
    expect(block(css, TONE_LIGHT)).not.toMatch(/color-scheme/);
  });

  it("pins the dark block to the owner's values", () => {
    expect(Object.fromEntries(tokens(block(css, DARK)))).toEqual(DARK_PINNED);
    expect(Object.fromEntries(tokens(block(css, TONE_DARK)))).toEqual(DARK_PINNED);
  });

  it('the tone-light block repeats the light block', () => {
    expect(Object.fromEntries(tokens(block(css, TONE_LIGHT)))).toEqual(Object.fromEntries(tokens(block(css, LIGHT))));
  });

  it.each(LIGHT_FLOORS)('light: %s on %s reaches %s:1', (fg, bg, floor) => {
    const light = resolved(tokens(block(css, LIGHT)));
    expect(contrast(light.get(fg)!, light.get(bg)!)).toBeGreaterThanOrEqual(floor);
  });

  // Status text drawn on its own pale tint — the warning banner, the GPU
  // notice, the Recommended badge — sits on the tint, not the bare surface.
  // The owner's calls (2026-10-22, after the OpenCodeReview pass and the
  // rendered comparison): every light status role, and the accent's text,
  // darkens until the floor holds there too.
  it.each(TINTED_FLOORS)('light: %s on its own %i-percent tint over %s reaches 4.5:1', (fg, percent, bg) => {
    const light = resolved(tokens(block(css, LIGHT)));
    const text = light.get(fg)!;
    expect(contrast(text, tint(text, light.get(bg)!, percent / 100))).toBeGreaterThanOrEqual(4.5);
  });

  it('every --sk- name a stylesheet references is defined', () => {
    const defined = new Set(tokens(block(css, DARK)).keys());
    const referenced = new Map<string, string>();
    const files = stylesheets(SRC);
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      for (const m of compile(file).css.matchAll(/var\(--sk-([a-z0-9-]+)/g)) {
        if (!referenced.has(m[1])) referenced.set(m[1], file);
      }
    }
    const missing = [...referenced].filter(([name]) => !defined.has(name)).map(([name, file]) => `${name} (${file})`);
    expect(missing).toEqual([]);
  });

  // The token files are aliases of custom properties (spec §2), and Sass cannot
  // compute `rgba($alias, a)` on a `var()`: such a site is `color-mix(in srgb,
  // $alias N%, transparent)`. Read off the source, since the compile would fail.
  it('no stylesheet still computes alpha on a token', () => {
    const sites = stylesheets(SRC, true).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/rgba\(\s*(?:tk\.|vars\.)?\$[a-z-]+\s*,/g)].map(() => file.slice(SRC.length + 1)),
    );
    expect(sites).toEqual([]);
  });
});
