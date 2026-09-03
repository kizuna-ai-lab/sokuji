/**
 * Tests for LanguageTags — a model card's language chips (decision
 * 2026-09-03): one language keeps its own chip, two or more collapse into a
 * "Multi" chip whose tooltip lists them by name.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LanguageTags } from './LanguageTags';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string, options?: Record<string, unknown>) => {
      let s = defaultValue ?? key;
      for (const [k, v] of Object.entries(options ?? {})) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));

// The real Tooltip floats through a portal on hover; here it renders its
// content inline next to the trigger so the list can be asserted directly.
vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ content, children }: { content: React.ReactNode; children: React.ReactNode }) => (
    <span className="tooltip-trigger" data-testid="tooltip-trigger">
      {children}
      <span data-testid="tooltip-content">{content}</span>
    </span>
  ),
}));

vi.mock('../engine/languageName', () => ({
  languageNameFor: (code: string) => ({ ja: '日本語', en: 'English', zh: '中文' } as Record<string, string>)[code] ?? code,
}));

const tags = (c: HTMLElement) => Array.from(c.querySelectorAll('.model-card__lang-tag')).map((el) => el.textContent);

describe('LanguageTags', () => {
  it('renders nothing for an empty or blank list', () => {
    expect(render(<LanguageTags languages={[]} />).container.querySelector('.model-card__lang-tag')).toBeNull();
    expect(render(<LanguageTags languages={['', ' ']} />).container.querySelector('.model-card__lang-tag')).toBeNull();
  });

  it('one language: its own chip, no tooltip', () => {
    const { container, queryByTestId } = render(<LanguageTags languages={['ja']} />);
    expect(tags(container)).toEqual(['ja']);
    expect(queryByTestId('tooltip-trigger')).toBeNull();
  });

  it.each([['multilingual', 'the WASM manifest'], ['multi', 'the native catalog (Whisper)']])(
    'a lone "%s" marker (%s) reads as Multi, its tooltip just says Multilingual', (marker) => {
      const { container, getByTestId } = render(<LanguageTags languages={[marker]} />);
      expect(tags(container)).toEqual(['Multi']);
      expect(container.querySelector('.model-card__lang-tag--multi')).not.toBeNull();
      expect(getByTestId('tooltip-content')).toHaveTextContent('Multilingual');
      expect(getByTestId('tooltip-content').querySelector('.model-card__lang-list')).toBeNull();
    });

  it('two or more languages: one Multi chip, the tooltip lists them by name with a count', () => {
    const { container, getByTestId } = render(<LanguageTags languages={['ja', 'en', 'zh', 'cantonese']} />);
    expect(tags(container)).toEqual(['Multi']);
    expect(container.querySelector('.model-card__lang-tag--multi')).not.toBeNull();
    const tip = getByTestId('tooltip-content');
    expect(tip.querySelector('.model-card__lang-list-count')).toHaveTextContent('4 languages');
    expect(tip).toHaveTextContent('日本語, English, 中文, cantonese');
  });

  it('duplicates collapse and a stray "multilingual" marker is not listed as a language', () => {
    const { container, getByTestId } = render(<LanguageTags languages={['en', 'en', 'multilingual', 'ja']} />);
    expect(tags(container)).toEqual(['Multi']);
    const tip = getByTestId('tooltip-content');
    expect(tip.querySelector('.model-card__lang-list-count')).toHaveTextContent('2 languages');
    expect(tip).toHaveTextContent('English, 日本語');
  });
});
