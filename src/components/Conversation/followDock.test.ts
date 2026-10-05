import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

// The Back to live row is docked below the list, never floating over it (spec
// 2026-10-05 goal 4: no floating layer in the main panel), and on the subtitle
// surface it spans the window as the status line does. Asserted on the compiled CSS.
const panel = compile(resolve(__dirname, '../MainPanel/MainPanel.scss')).css;
const stream = compile(resolve(__dirname, '../Subtitle/SubtitleStream.scss')).css;
const rule = (css: string, selector: string) => css.match(new RegExp(`(?:^|\\n|\\})\\s*${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
const trimmed = (css: string, selector: string) =>
  css.match(new RegExp(`@supports \\(text-box: trim-both cap alphabetic\\)\\s*\\{\\s*${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('the Back to live row', () => {
  it('is a row of its own, not a floating layer', () => {
    const dock = rule(panel, '\\.follow-dock');
    expect(dock).toMatch(/flex-shrink:\s*0/);
    expect(dock).toMatch(/border-top:\s*1px solid #333/);
    expect(dock).not.toMatch(/position:\s*(absolute|fixed|sticky)/);
  });

  it('centres its label by the font’s metrics, as the status line does', () => {
    expect(trimmed(panel, '\\.follow-dock__label')).toMatch(/text-box:\s*trim-both cap alphabetic/);
  });

  // The subtitle window's background is the user's own colour and opacity, and its
  // controls are translucent white over it; the panel's solid #252525 looked like a
  // patch there (rendered on black 80%, black 35% and navy 90%). S1, his pick.
  it('lets the subtitle window’s own background through, with a hairline and translucent words', () => {
    const dock = rule(stream, '\\.subtitle-stream\\.expanded \\.follow-dock');
    expect(dock).toMatch(/background:\s*transparent/);
    expect(dock).toMatch(/border-top:\s*1px solid rgba\(255, 255, 255, 0\.14\)/);
    expect(dock).toMatch(/color:\s*rgba\(255, 255, 255, 0\.62\)/);
    expect(rule(stream, '\\.subtitle-stream\\.expanded \\.follow-dock:hover')).toMatch(/background:\s*rgba\(255, 255, 255, 0\.08\)/);
  });

  it('bleeds through exactly the subtitle stream’s padding to its edges and bottom', () => {
    const pad = rule(stream, '\\.subtitle-stream').match(/padding:\s*(\d+)px (\d+)px (\d+)px/);
    expect(pad).not.toBeNull();
    const [, top, side, bottom] = pad!;
    expect(rule(stream, '\\.subtitle-stream\\.expanded \\.follow-dock')).toMatch(
      new RegExp(`margin:\\s*${top}px -${side}px -${bottom}px`),
    );
  });
});
