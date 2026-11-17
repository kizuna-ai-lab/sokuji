// src/components/SetupWizard/SetupWizard.styles.test.ts
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// Asserted on the compiled CSS, never by reading SCSS source.
const css = '\n' + compile(resolve(__dirname, 'SetupWizard.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
const ruleBody = (selector: string): string | null => {
  const i = css.indexOf(`\n${selector} {`);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
};

describe('the line-up a path sets up', () => {
  // B-32: neither the wizard nor these rows set a size, so the stage and the provider's name fell to the browser's
  // 16px among 12–13px text. They read as the finish step's summary does: the stage small, the name at body size.
  it('sets the stage at caption size and the provider at body size, as the summary rows do', () => {
    expect(ruleBody('.lineup-preview__rows dt')).toMatch(/font-size:\s*12px/);
    expect(ruleBody('.lineup-preview__name')).toMatch(/font-size:\s*13px/);
  });
});
