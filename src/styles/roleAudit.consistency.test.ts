/**
 * What the final review of the light theme found (2026-10-22), pinned on the
 * COMPILED stylesheets so it cannot come back:
 *
 * - A pseudo-class selector rewritten as a Sass nested property
 *   (`input: checked + &-box {`) compiles silently into nonsense declarations
 *   and the rule vanishes in both schemes. No CSS property is named after an
 *   element, so a declaration whose property is one is always that mistake.
 * - A role error reads in one scheme only: a label on a TINT is text (the
 *   tint is on the surface), a label on a FILL is on-accent (white in both
 *   schemes); a progress track or a seam is a hairline, not a control surface
 *   (`bg-control` is white in light); a glyph drawn on the user's own colour
 *   is fixed white; the tour's spotlight shadow is the scrim.
 */
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const css = (rel: string) => compile(resolve(SRC, rel)).css;

/** The body of the first top-level rule whose selector contains `fragment`. */
function rule(sheet: string, fragment: string): string {
  const esc = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = sheet.match(new RegExp(String.raw`(?:^|\n)[^{}\n]*${esc}[^{}\n]*\{([^}]*)\}`));
  if (!m) throw new Error(`no rule containing ${fragment}`);
  return m[1];
}

function stylesheets(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') stylesheets(path, out);
    } else if (entry.endsWith('.scss') && !entry.startsWith('_')) {
      out.push(path);
    }
  }
  return out;
}

const ELEMENT_AS_PROPERTY = /^\s+(?:input|option|select|button|textarea|label|a|svg|span|div|p|ul|ol|li|fieldset|legend|img|h[1-6]|table|tr|td|th)\s*:\s*[^;{]*;/gm;

describe('compiled stylesheets', () => {
  it('no declaration has an element name for a property (a pseudo-class written as a nested property)', () => {
    const found: string[] = [];
    for (const file of stylesheets(SRC)) {
      for (const m of compile(file).css.matchAll(ELEMENT_AS_PROPERTY)) found.push(`${file.slice(SRC.length + 1)}: ${m[0].trim()}`);
    }
    expect(found).toEqual([]);
  });

  it('the clone-review consent box and the engine option keep their selected colour', () => {
    expect(rule(css('components/Settings/Settings.scss'), 'input:checked + .voice-review__consent-box')).toMatch(/background-color:\s*var\(--sk-primary\)/);
    expect(rule(css('components/Settings/engine/Engine.scss'), 'option:checked')).toMatch(/color:\s*var\(--sk-primary\)/);
  });
});

describe('colour roles', () => {
  it('a label on a tint is text; a label on a fill is on-accent', () => {
    expect(rule(css('components/MainPanel/ModeDevicePopover.scss'), '__device-row--selected')).toMatch(/color:\s*var\(--sk-text-primary\)/);
    expect(rule(css('components/Subtitle/SubtitleBar.scss'), '.subtitle-bar__session')).toMatch(/color:\s*var\(--sk-on-accent\)/);
    expect(rule(css('components/Subtitle/SubtitleStream.scss'), '.subtitle-stream__person')).toMatch(/color:\s*var\(--sk-on-accent\)/);
    expect(rule(css('components/Auth/SignInForm.scss'), '.loading-spinner')).toMatch(/border:\s*2px solid var\(--sk-on-accent\)/);
    expect(rule(css('components/Auth/SignUpForm.scss'), '.loading-spinner')).toMatch(/border:\s*2px solid var\(--sk-on-accent\)/);
    expect(rule(css('components/Settings/sections/VoicePicker.scss'), '--danger:hover:not(:disabled)')).toMatch(/color:\s*var\(--sk-on-accent\)/);
  });

  it('tracks and seams are hairlines, not control surfaces', () => {
    expect(rule(css('components/MainLayout/PanelResizer.scss'), '.panel-resizer')).toMatch(/background:\s*var\(--sk-line-subtle\)/);
    expect(rule(css('components/LogsPanel/LogsPanel.scss'), '.separator-line')).toMatch(/background-color:\s*var\(--sk-line-subtle\)/);
    expect(rule(css('components/LogsPanel/LogsPanel.scss'), '.icon-container')).toMatch(/background-color:\s*var\(--sk-line-subtle\)/);
    expect(rule(css('components/Auth/UserAccountInfo.scss'), '.quota-bar ')).toMatch(/background:\s*var\(--sk-line-subtle\)/);
    expect(rule(css('components/UpdateDialog/UpdateDialog.scss'), '.progress-bar')).toMatch(/background-color:\s*var\(--sk-line-subtle\)/);
    expect(rule(css('components/Settings/sections/EngineSection.scss'), '__bar')).toMatch(/background:\s*var\(--sk-line-subtle\)/);
    expect(rule(css('components/Display/DisplaySettingsPopover.scss'), '__bar')).toMatch(/background:\s*var\(--sk-line-subtle\)/);
  });

  it("the custom-colour chip's glyph is white on any chip; the tour spotlight dims like the scrim", () => {
    expect(rule(css('components/Display/DisplaySettingsPopover.scss'), '.custom')).toMatch(/color:\s*var\(--sk-white\)/);
    expect(rule(css('components/Tour/Tour.scss'), '.tour-spotlight')).toMatch(/box-shadow:\s*0 0 0 9999px var\(--sk-scrim\)/);
  });
});
