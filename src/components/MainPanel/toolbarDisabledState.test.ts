import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// The toolbar is now shown before any conversation exists, so Clear can be
// visible with nothing to clear. It must look disabled then, like the font
// size buttons at their limits. Asserted on the compiled CSS.
const css = compile(resolve(__dirname, 'MainPanel.scss')).css;

describe('Clear conversation disabled state', () => {
  it('dims when disabled', () => {
    expect(css).toMatch(/\.clear-conversation-btn:disabled\s*\{[^}]*\bopacity:\s*0\.3/);
  });

  it('keeps the red hover off a disabled button', () => {
    expect(css).toMatch(/\.clear-conversation-btn:hover:not\(:disabled\)\s*\{/);
    expect(css).not.toMatch(/\.clear-conversation-btn:hover\s*\{/);
  });
});
