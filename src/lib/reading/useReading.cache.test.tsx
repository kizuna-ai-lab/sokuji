import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useReading } from './useReading';
import { CACHE_LIMIT, peekReading, requestReading } from './annotate';
import type { ReadingLanguage, RubyPiece } from './types';

// The real annotate and hook: more mounted rows than the cache holds must not
// evict one another's pieces during render, or each miss hands React a new
// snapshot and the rows re-render without end.
const got: (RubyPiece[] | null)[] = [];

function Row({ i, lang }: { i: number; lang: ReadingLanguage | null }) {
  got[i] = useReading(`слово${i}`, lang, false);
  return null;
}

function Rows({ n, lang }: { n: number; lang: ReadingLanguage | null }) {
  return <>{Array.from({ length: n }, (_, i) => <Row key={i} i={i} lang={lang} />)}</>;
}

describe('useReading with more rows than the cache holds', () => {
  it('settles, every row with its pieces', async () => {
    const n = CACHE_LIMIT + 10;
    const { rerender } = render(<Rows n={n} lang={null} />);
    requestReading('да', 'ru');
    await vi.waitFor(() => expect(peekReading('да', 'ru')).not.toBeNull());
    expect(() => act(() => rerender(<Rows n={n} lang="ru" />))).not.toThrow();
    expect(got).toHaveLength(n);
    expect(got.every((pieces) => pieces !== null)).toBe(true);
    expect(got[0]).toEqual([{ text: 'слово', reading: 'slovo' }, { text: '0' }]);
  });
});
