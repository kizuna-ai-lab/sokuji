// src/components/MainLayout/MainLayout.styles.test.ts
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// Asserted on the compiled CSS, never by reading SCSS source.
const css = compile(resolve(__dirname, 'MainLayout.scss'), { silenceDeprecations: ['import', 'global-builtin'] }).css;
/** The body of the rule, inside `@media (max-width: 768px)`, whose selector list names `selector`. */
const narrowRule = (selector: string): string | null => {
  const at = css.indexOf('@media (max-width: 768px)');
  if (at === -1) return null;
  const block = css.slice(at);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    if (m[1].split(',').some((s) => s.trim().endsWith(selector))) return m[2];
  }
  return null;
};

describe('the main layout in a narrow window with a side panel open', () => {
  // Review: only the control footer stays under the panel; the live notes go with the transcript.
  it('hides the live notes with the transcript: the area they share', () => {
    expect(narrowRule('.main-content.with-panel .conversation-area')).toMatch(/display:\s*none/);
  });
});
