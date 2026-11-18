import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { LanguagePairText } from './LanguagePairText';

afterEach(cleanup);

// Owner, 2026-11-19: the arrow between the two languages was a character the interface's fonts lack, so each machine
// drew it from a different font (Cantarell, Liberation Sans): small, and below the names' middle. It is an icon now.
describe('two language names with an arrow between them', () => {
  it('draws the icon it is given between the names, and no arrow character', () => {
    const { container } = render(<LanguagePairText left="中文" arrow={ArrowLeft} label="译自" right="英语" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('lucide-arrow-left');
    expect(svg).toHaveClass('language-pair-text__arrow');
    expect(container.textContent).not.toMatch(/[→←⇄]/);
    expect([...container.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['中文', '英语']);
  });

  // Owner, 2026-11-19: a screen reader reads the icon too, by its label, between the two names.
  it('names the icon for a screen reader', () => {
    render(<LanguagePairText left="中文" arrow={ArrowLeft} label="译自" right="英语" />);
    expect(screen.getByRole('img', { name: '译自' })).toHaveClass('lucide-arrow-left');
  });

  // Review, 2026-11-18: in Hebrew, Arabic and Persian the names swapped places around the arrow, which pointed the
  // wrong way. The pair is laid out left to right, each name in its own direction.
  it('keeps mine first, at the left, in a right-to-left script', () => {
    const { container } = render(<LanguagePairText left="יפנית" arrow={ArrowRight} label="תרגום אל" right="סינית" />);
    const pair = container.firstElementChild!;
    expect(pair).toHaveAttribute('dir', 'ltr');
    expect([...pair.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['יפנית', 'סינית']);
  });
});
