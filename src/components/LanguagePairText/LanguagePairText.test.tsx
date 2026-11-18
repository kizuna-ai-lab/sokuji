import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LanguagePairText } from './LanguagePairText';

afterEach(cleanup);

// Owner, 2026-11-19: the arrow between the two languages was a character the interface's fonts lack (on Ubuntu it came
// from Cantarell): small, and below the names' middle. It is drawn now, sized and placed against the names.
describe('two language names with an arrow between them', () => {
  it('draws the arrow, one for each way a session translates', () => {
    for (const [arrow, icon] of [['→', 'lucide-arrow-right'], ['←', 'lucide-arrow-left'], ['⇄', 'lucide-arrow-right-left']] as const) {
      const { container, unmount } = render(<LanguagePairText left="中文" arrow={arrow} right="英语" />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveClass(icon);
      expect(svg).toHaveClass('language-pair-text__arrow');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
  });

  it('still reads with the arrow, to a screen reader and when copied', () => {
    const { container } = render(<LanguagePairText left="中文" arrow="←" right="英语" />);
    expect(container.textContent).toBe('中文 ← 英语');
    expect(container.querySelector('.language-pair-text__said')).toHaveTextContent('←');
  });

  // Review, 2026-11-18: in Hebrew, Arabic and Persian the names swapped places around the arrow, which pointed the
  // wrong way. The pair is laid out left to right, each name in its own direction.
  it('keeps mine first, at the left, in a right-to-left script', () => {
    const { container } = render(<LanguagePairText left="יפנית" arrow="→" right="סינית" />);
    const pair = container.firstElementChild!;
    expect(pair).toHaveAttribute('dir', 'ltr');
    expect([...pair.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['יפנית', 'סינית']);
  });
});
