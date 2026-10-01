import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const translation = vi.hoisted(() => ({ value: { t: (key: string, fallback?: string) => fallback ?? key } as Record<string, unknown> }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation.value }));

import { languageLabel } from './label';
import { useLanguageLabel } from './useLanguageLabel';

describe('useLanguageLabel', () => {
  it('names in English when the mock carries no i18n object', () => {
    translation.value = { t: (key: string, fallback?: string) => fallback ?? key };
    const { result } = renderHook(() => useLanguageLabel());
    expect(result.current('ja')).toBe(languageLabel('ja', 'en'));
  });

  it("names in i18n's language, and auto with common.autoDetect", () => {
    translation.value = { t: (key: string) => (key === 'common.autoDetect' ? '自動検出' : key), i18n: { language: 'ja' } };
    const { result } = renderHook(() => useLanguageLabel());
    expect(result.current('en')).toBe(languageLabel('en', 'ja'));
    expect(result.current('auto')).toBe('自動検出');
  });
});
