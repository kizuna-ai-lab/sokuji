// src/viewer/viewerThemeStyles.test.ts
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// His ruling 2026-10-04 (after the live look): the colour scheme a viewer
// picks reaches the page's chrome too — the phone's settings button, the
// settings sheet or menu, and the desktop's top bar and footer — not only the
// caption area. Asserted on the compiled CSS, never by reading SCSS source.
const css = '\n' + compile(resolve(__dirname, 'viewer.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
const rules = (): Array<{ selector: string; body: string }> =>
  [...css.matchAll(/\n([^\n{}@]+?)\s*\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
const ruleBody = (selector: string): string | null => rules().find((r) => r.selector === selector)?.body ?? null;

const CHROME_TOKENS = ['--v-chrome-bg', '--v-chrome-line', '--v-chrome-text', '--v-chrome-muted', '--v-control-bg', '--v-control-line', '--v-control-text', '--v-accent', '--v-accent-fill', '--v-on-accent'];

describe('viewer: the colour scheme reaches the chrome', () => {
  it('gives every scheme its own chrome colours', () => {
    for (const scheme of ['.viewer', '.viewer--light', '.viewer--contrast']) {
      const body = ruleBody(scheme);
      for (const token of CHROME_TOKENS) expect(body, `${scheme} ${token}`).toMatch(new RegExp(`${token}:`));
    }
  });

  it('paints the bars, the settings and their controls from those colours', () => {
    expect(ruleBody('.viewer-bar')).toMatch(/background:\s*var\(--v-chrome-bg\)/);
    expect(ruleBody('.viewer-footer')).toMatch(/background:\s*var\(--v-chrome-bg\)/);
    expect(ruleBody('.viewer-settings')).toMatch(/background:\s*var\(--v-chrome-bg\)/);
    expect(ruleBody('.viewer-statusline__settings')).toMatch(/background:\s*var\(--v-control-bg\)/);
    expect(ruleBody('.viewer-segmented__option')).toMatch(/background:\s*var\(--v-control-bg\)/);
    expect(ruleBody('.viewer-segmented__option.active')).toMatch(/background:\s*var\(--v-accent-fill\)/);
  });

  it("recolours the app's switch and buttons inside the page", () => {
    expect(ruleBody('.viewer .toggle-switch-component .toggle-switch-label .toggle-track-container .toggle-track')).toMatch(/background-color:\s*var\(--v-toggle-off\)/);
    expect(ruleBody('.viewer .toggle-switch-component .toggle-switch-label .toggle-track-container input:checked + .toggle-track')).toMatch(/background-color:\s*var\(--v-accent\)/);
    expect(ruleBody('.viewer .settings-btn--secondary')).toMatch(/color:\s*var\(--v-accent\)/);
    expect(ruleBody('.viewer .settings-btn--ghost')).toMatch(/color:\s*var\(--v-chrome-muted\)/);
  });

  it('keeps fixed colours out of the chrome rules', () => {
    const chrome = /^\.viewer-(bar|footer|settings|statusline__settings|icon-btn|segmented|jump|enter|option)\b/;
    const fixed = rules()
      .filter((r) => chrome.test(r.selector))
      .flatMap((r) => [...r.body.matchAll(/(?:^|;)\s*((?:background|color|border[\w-]*)\s*:[^;]*#[0-9a-f]{3,8}\b[^;]*)/gi)].map((m) => `${r.selector} { ${m[1].trim()} }`));
    expect(fixed).toEqual([]);
  });
});
