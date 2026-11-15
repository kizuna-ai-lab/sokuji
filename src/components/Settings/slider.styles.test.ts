// The settings' sliders are drawn one way (owner, 2026-11-15): as Display's background opacity is — the browser's
// own slider in the primary colour, its run filled — whatever row holds them.
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const settings = compile(resolve(__dirname, 'Settings.scss')).css;
const popover = compile(resolve(__dirname, '../Display/DisplaySettingsPopover.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
const page = compile(resolve(__dirname, '../SettingsPage/SettingsPage.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
const rule = (css: string, selector: string) => new RegExp(String.raw`(^|\n)${selector.replace(/[.+()\[\]'=>]/g, '\\$&')}\s*\{([^}]*)\}`).exec(css)?.[2] ?? '';
const accent = (body: string) => /accent-color:\s*([^;]+);/.exec(body)?.[1].trim();

describe("the settings' sliders", () => {
  it("take the primary colour of Display's background opacity", () => {
    const opacity = accent(rule(page, '.display-category .display-settings-popover--page > .field .range input'));
    expect(opacity).toBeTruthy();
    expect(accent(rule(settings, '.slider'))).toBe(opacity);
  });

  it("are the browser's own slider, not a flat track with a dot drawn over it", () => {
    expect(rule(settings, '.slider')).not.toMatch(/appearance:\s*none/);
    expect(settings).not.toMatch(/\.slider::-webkit-slider-thumb|\.slider::-moz-range-thumb/);
  });

  it('on the caption bar and in the main window, the opacity keeps its size and takes the same colour', () => {
    const opacity = accent(rule(page, '.display-category .display-settings-popover--page > .field .range input'));
    const own = rule(popover, '.display-settings-popover .field input[type=range]');
    expect(own).toMatch(/width:\s*100%/);
    expect(accent(own)).toBe(opacity);
  });
});
