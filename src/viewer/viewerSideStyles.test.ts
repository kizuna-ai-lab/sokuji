// src/viewer/viewerSideStyles.test.ts
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// His ruling 2026-10-04: on site and remote lines are told apart by a stripe
// down each line and a tag where the side changes, in two colours far apart
// (the old 0.5em dots in green and orange read alike). Asserted on the
// compiled CSS, never by reading SCSS source.
const css = '\n' + compile(resolve(__dirname, 'viewer.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
const ruleBody = (selector: string): string | null => {
  const i = css.indexOf(`\n${selector} {`);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
};

describe('viewer: which side is speaking', () => {
  it('draws a stripe down each line in its side colour once both sides have spoken', () => {
    expect(ruleBody('.viewer--two-legs .viewer-entry')).toMatch(/border-left:\s*3px solid/);
    expect(ruleBody('.viewer--two-legs .viewer-entry--speaker')).toMatch(/border-left-color:\s*var\(--v-speaker\)/);
    expect(ruleBody('.viewer--two-legs .viewer-entry--participant')).toMatch(/border-left-color:\s*var\(--v-participant\)/);
  });

  it('colours the tag by side', () => {
    expect(ruleBody('.viewer-entry--speaker .viewer-entry__side')).toMatch(/color:\s*var\(--v-speaker\)/);
    expect(ruleBody('.viewer-entry--participant .viewer-entry__side')).toMatch(/color:\s*var\(--v-participant\)/);
  });

  // "Japanisch ⇄ Chinesisch (China)" is wider than a phone's sheet allows a
  // third of: the sheet's choices wrap instead of clipping.
  it("lets the settings sheet's choices wrap rather than clip a long both-languages label", () => {
    const option = ruleBody('.viewer-settings__field .viewer-segmented__option');
    expect(option).toMatch(/white-space:\s*normal/);
    expect(option).toMatch(/min-width:\s*0/);
    expect(ruleBody('.viewer-settings__field .viewer-segmented')).toMatch(/height:\s*auto/);
  });

  it('keeps no dots and no legend', () => {
    expect(css).not.toMatch(/\.viewer-legend/);
    expect(css).not.toMatch(/content:\s*"●"/);
  });
});
