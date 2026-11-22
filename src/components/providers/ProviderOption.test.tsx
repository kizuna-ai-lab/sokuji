// Owner, 2026-11-15: Bing's and Edge's line is their description, not a credit; the closed select shows one line.
import { describe, it, expect } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { resolve } from 'node:path';
import { compile } from 'sass';
import { optionText, ProviderOption, useOptionModel } from './ProviderOption';

describe('a provider option', () => {
  it("draws Bing's and Edge's line as their description, with nothing in the credit's place", () => {
    const { result } = renderHook(() => useOptionModel());
    for (const id of ['bing', 'edge']) {
      const m = result.current(id);
      expect(m.note).toBeUndefined();
      expect(m.description).toBe('Free · online, a Microsoft service');
    }
  });

  it('shows one line in the closed select: the description only in the list', () => {
    const { css } = compile(resolve(__dirname, '../Settings/Settings.scss'));
    expect(css).toMatch(/\.provider-select selectedcontent \.provider-select__description\s*\{\s*display:\s*none;/);
  });

  // Owner, 2026-11-22: what a service needs is said after its name and leaves it a choice; why it cannot be combined
  // holds it back, and is said in place of what it needs.
  it('says what an option needs and leaves it a choice; a reason it cannot be combined holds it back instead', () => {
    const needs = { id: 'gemini_text', name: 'Gemini Text Model', needs: 'needs a key' };
    expect(optionText(needs)).toBe('Gemini Text Model (needs a key)');
    expect(optionText({ ...needs, blocked: 'reads only its own translation' })).toBe('Gemini Text Model (reads only its own translation)');
    for (const rich of [false, true]) {
      const { container, unmount } = render(<select><ProviderOption model={needs} rich={rich} /></select>);
      const option = container.querySelector('option')!;
      expect([rich, option.disabled]).toEqual([rich, false]);
      expect(option.textContent).toContain('needs a key');
      if (rich) expect(option.querySelector('.provider-needs')?.textContent).toBe('needs a key');
      unmount();
    }
    const { container } = render(<select><ProviderOption model={{ ...needs, blocked: 'reads only its own translation' }} rich /></select>);
    const option = container.querySelector('option')!;
    expect(option.disabled).toBe(true);
    expect(option.querySelector('.provider-needs')).toBeNull();
    expect(option.querySelector('.provider-blocked')?.textContent).toBe('reads only its own translation');
  });
});
