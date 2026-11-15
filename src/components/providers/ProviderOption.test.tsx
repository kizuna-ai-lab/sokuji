// Owner, 2026-11-15: Bing's and Edge's line is their description, not a credit; the closed select shows one line.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { resolve } from 'node:path';
import { compile } from 'sass';
import { useOptionModel } from './ProviderOption';

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
});
