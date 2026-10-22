/**
 * The first-paint script (spec 2026-10-22 §1): `public/theme-boot.js` reads the
 * scheme the theme module cached and sets `data-theme` before any stylesheet
 * applies, so a light user never sees a dark first frame. It is a file, not an
 * inline script: the extension's page CSP is `script-src 'self'`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const runBoot = () => new Function(read('public/theme-boot.js'))();
const attr = () => document.documentElement.getAttribute('data-theme');

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

describe('theme-boot.js', () => {
  it('the boot script sets data-theme from the cache', () => {
    localStorage.setItem('sokuji.theme', 'light');
    runBoot();
    expect(attr()).toBe('light');
  });

  it('the boot script leaves dark alone', () => {
    runBoot();
    expect(attr()).toBeNull();
    localStorage.setItem('sokuji.theme', 'dark');
    runBoot();
    expect(attr()).toBeNull();
  });

  it('the boot script survives a throwing storage', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); } });
    expect(() => runBoot()).not.toThrow();
    expect(attr()).toBeNull();
  });

  it.each(['index.html', 'extension/fullpage.html'])('%s loads theme-boot.js before any stylesheet or module', (file) => {
    const html = read(file);
    const boot = html.indexOf('theme-boot.js');
    expect(boot).toBeGreaterThan(-1);
    for (const later of [html.search(/<link[^>]*rel="stylesheet"/), html.indexOf('type="module"')]) {
      if (later >= 0) expect(boot).toBeLessThan(later);
    }
  });

  it('the extension build copies theme-boot.js', () => {
    expect(read('extension/vite.config.ts')).toContain("'../public/theme-boot.js'");
  });
});
