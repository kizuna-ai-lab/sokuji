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

  // From the OpenCodeReview pass (2026-10-22). Each fix keeps dark as it
  // was unless the comment says otherwise.
  it('a label on a solid fill is on-accent; a label on a neutral or tinted surface is text-primary', () => {
    const main = css('components/MainPanel/MainPanel.scss');
    // the error fill while push-to-talk records (was text-primary: #1a1a1a on #c0392b in light)
    expect(rule(main, '.push-to-talk-button.recording')).toMatch(/color:\s*var\(--sk-on-accent\)/);
    // the running and disabled session button sit on neutral surfaces (was white on #e3e3e3 / #c4c4c4 in light)
    expect(rule(main, '.session-button.active')).toMatch(/color:\s*var\(--sk-text-primary\)/);
    expect(rule(main, '.session-button:disabled')).toMatch(/color:\s*var\(--sk-text-primary\)/);
    // the engine's secondary action is a neutral button (was white on #e3e3e3 in light)
    expect(rule(css('components/Settings/sections/EngineSection.scss'), '__action--secondary')).toMatch(/color:\s*var\(--sk-text-primary\)/);
    // the replay button while playing is a 45% tint (was white on pale green in a light conversation)
    expect(rule(css('components/MainPanel/ConversationRow.scss'), '.row-play-btn.playing')).toMatch(/color:\s*var\(--sk-text-primary\)/);
    // the subtitle's "fix it" action is an overlay tint that follows the tone (was white on a light tint)
    expect(rule(css('components/Subtitle/SubtitleApp.scss'), '__action--fix:not(:disabled)')).toMatch(/color:\s*var\(--sk-text-primary\)/);
  });

  // The participant's second shade is bright in both schemes (#f8c471 dark,
  // #d97706 light), so its numeral is dark ink in both; the near-white
  // bg-base read 2.87:1 on it in light. Dark moves #1a1a1a → #000.
  it("the participant's second shade carries a dark numeral in both schemes", () => {
    expect(rule(css('components/MainPanel/ConversationRow.scss'), '.row-avatar.avatar-participant.person-shade-1')).toMatch(/color:\s*var\(--sk-overlay-bg\)/);
    expect(rule(css('components/Subtitle/SubtitleStream.scss'), '__line--participant .subtitle-stream__person.person-shade-1')).toMatch(/color:\s*var\(--sk-overlay-bg\)/);
  });

  it('dividers and seams are lines, not surfaces', () => {
    // dark #444 either way
    expect(rule(css('components/MainPanel/ExportButton.scss'), '.export-menu-divider')).toMatch(/background:\s*var\(--sk-line\)/);
    // dark #555 either way
    expect(rule(css('components/MainLayout/PanelResizer.scss'), '.panel-resizer:hover')).toMatch(/background:\s*var\(--sk-line-strong\)/);
    // was bg-hover, 1.06:1 on the light bar; dark moves #3a3a3a → #444
    expect(rule(css('components/Subtitle/SubtitleBar.scss'), '.subtitle-bar__divider')).toMatch(/background:\s*var\(--sk-line\)/);
  });

  // A recessed area inside a popover or modal has to differ from it: in
  // light bg-page was the popover's own white, and bg-base the import modal's
  // own grey.
  it('recessed areas differ from the surface they sit in', () => {
    expect(rule(css('components/MainPanel/ModeDevicePopover.scss'), '.mode-device-popover__row--expanded')).toMatch(/background:\s*var\(--sk-bg-base\)/);
    expect(rule(css('components/MainPanel/ModeDevicePopover.scss'), '.mode-device-popover__device-list')).toMatch(/background:\s*var\(--sk-bg-base\)/);
    const modal = css('components/Settings/sections/ModelImportModal.scss');
    expect(rule(modal, '.import-cmd__term')).toMatch(/background:\s*var\(--sk-bg-page\)/);
    expect(rule(modal, '.import-cmd__term')).toMatch(/border:\s*1px solid var\(--sk-line\)/);
    expect(rule(modal, '.import-cmd__tab.is-active')).toMatch(/background:\s*var\(--sk-bg-page\)/);
    expect(rule(modal, '.import-cmd__tab.is-active')).toMatch(/border-color:\s*var\(--sk-line\)/);
  });

  // The halo that keeps the custom chip's white plus legible on a pale chip
  // was black at .9; the scrim token is .6 and a different role.
  it("the custom chip's halo is the overlay ink at 90%", () => {
    expect(rule(css('components/Display/DisplaySettingsPopover.scss'), '.custom'))
      .toMatch(/filter:\s*drop-shadow\(0 0 1px color-mix\(in srgb, var\(--sk-overlay-bg\) 90%, transparent\)\)/);
  });

  // A colour chip the same colour as the popover behind it (black on the
  // dark popover, the cream and white presets on the light one) still has
  // an edge: a hairline in the overlay ink, which is white in dark and black
  // in light, so it reads on either popover whatever the chip's colour.
  it('every colour chip carries a hairline in the overlay ink', () => {
    expect(rule(css('components/Display/DisplaySettingsPopover.scss'), '.swatch'))
      .toMatch(/outline:\s*1px solid color-mix\(in srgb, var\(--sk-overlay-fg\) 20%, transparent\)/);
  });
});
