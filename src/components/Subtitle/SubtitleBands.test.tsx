import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Entry, Row } from '../../lib/projection/types';
import { SubtitleBody, type SubtitleBodyProps } from './SubtitleBands';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

const row = (segmentId: string, k: number, start: number, text: string, side: 'source' | 'translation' = 'source'): Row =>
  ({ key: `${segmentId}:${k}`, segmentId, side, start, end: start + text.length, text, final: true });
const exchange = (id: string, source: Row[], translation: Row[] = []): Entry =>
  ({ kind: 'exchange', id, leg: 'speaker', languages: { source: 'en', target: 'ja' }, pairing: 'stated', source, translation, t: 0 });
const props = (over: Partial<SubtitleBodyProps> = {}): SubtitleBodyProps => ({
  entries: [exchange('a', [row('s1', 0, 0, 'Hello.')], [row('t1', 0, 0, 'こんにちは。', 'translation')])],
  lit: new Map(),
  compact: true,
  fontSize: 24,
  filters: { speaker: 'both', participant: 'both' },
  newItemHighlightEnabled: true,
  ...over,
});

describe('SubtitleBody — compact', () => {
  it("draws a band per leg and side with today's classes", () => {
    const { container } = render(<SubtitleBody {...props()} />);
    expect(container.querySelector('.subtitle-stream.compact')).not.toBeNull();
    const lines = [...container.querySelectorAll('.subtitle-stream__line')];
    expect(lines.map((line) => line.className)).toEqual([
      'subtitle-stream__line subtitle-stream__line--source subtitle-stream__line--speaker',
      'subtitle-stream__line subtitle-stream__line--translation subtitle-stream__line--speaker',
    ]);
    expect(lines.map((line) => line.textContent)).toEqual(['Hello.', 'こんにちは。']);
  });

  it('joins Japanese segments without a space and English ones with one', () => {
    const entries = [
      exchange('a', [row('s1', 0, 0, 'One.')], [row('t1', 0, 0, '一つ。', 'translation')]),
      exchange('b', [row('s2', 0, 0, 'Two.')], [row('t2', 0, 0, '二つ。', 'translation')]),
    ];
    const { container } = render(<SubtitleBody {...props({ entries })} />);
    const lines = [...container.querySelectorAll('.subtitle-stream__line')].map((line) => line.textContent);
    expect(lines).toEqual(['One. Two.', '一つ。二つ。']);
  });

  it('lights the spoken characters of a stretch', () => {
    const { container } = render(<SubtitleBody {...props({ lit: new Map([['t1', 3]]) })} />);
    expect(container.querySelector('.subtitle-stream__line--translation .karaoke-played')?.textContent).toBe('こんに');
  });

  it('highlights a segment that arrives after the first draw, once, and not the ones already there', () => {
    const first = props();
    const { container, rerender } = render(<SubtitleBody {...first} />);
    expect(container.querySelector('.subtitle-stream__item--new')).toBeNull();
    const later = [...first.entries, exchange('b', [row('s2', 0, 0, 'Again.')])];
    rerender(<SubtitleBody {...props({ entries: later })} />);
    const fresh = [...container.querySelectorAll('.subtitle-stream__item--new')].map((span) => span.textContent);
    expect(fresh).toEqual([' Again.']);
  });

  it('draws no highlight when the setting is off', () => {
    const first = props({ newItemHighlightEnabled: false });
    const { container, rerender } = render(<SubtitleBody {...first} />);
    rerender(<SubtitleBody {...props({ newItemHighlightEnabled: false, entries: [...first.entries, exchange('b', [row('s2', 0, 0, 'Again.')])] })} />);
    expect(container.querySelector('.subtitle-stream__item--new')).toBeNull();
  });

  it('draws one item per segment run when a segment is cut into two rows', () => {
    const entries = [exchange('a', [
      row('s1', 0, 0, '今日は天気がいいですね。'),
      row('s1', 1, 12, '公園に行きましょう。'),
    ])];
    const { container } = render(<SubtitleBody {...props({ entries })} />);
    const items = [...container.querySelectorAll('.subtitle-stream__line--source .subtitle-stream__item')];
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute('data-segment')).toBe('s1');
    expect(items[0].textContent).toBe('今日は天気がいいですね。公園に行きましょう。');
  });

  it('does not re-mark an already-drawn segment as new when it is re-cut into more rows', () => {
    const first = props({ entries: [exchange('a', [row('s1', 0, 0, '今日は天気がいいですね。公園に行きましょう。')])] });
    const { container, rerender } = render(<SubtitleBody {...first} />);
    expect(container.querySelector('.subtitle-stream__item--new')).toBeNull();
    const recut = [exchange('a', [
      row('s1', 0, 0, '今日は天気がいいですね。'),
      row('s1', 1, 12, '公園に行きましょう。'),
    ])];
    rerender(<SubtitleBody {...props({ entries: recut })} />);
    expect(container.querySelector('.subtitle-stream__item--new')).toBeNull();
    const items = [...container.querySelectorAll('.subtitle-stream__line--source .subtitle-stream__item')];
    expect(items).toHaveLength(1);
  });

  it('lights karaoke across a run of two rows', () => {
    const entries = [exchange('a', [
      row('s1', 0, 0, '今日は天気がいいですね。'),
      row('s1', 1, 12, '公園に行きましょう。'),
    ])];
    const { container } = render(<SubtitleBody {...props({ entries, lit: new Map([['s1', 14]]) })} />);
    const litSpans = [...container.querySelectorAll('.subtitle-stream__line--source .karaoke-played')].map((span) => span.textContent);
    expect(litSpans).toEqual(['今日は天気がいいですね。', '公園']);
  });
});

describe('SubtitleBody — expanded', () => {
  it("draws the panel's list with the subtitle's filters and no replay", () => {
    const { container } = render(<SubtitleBody {...props({ compact: false, filters: { speaker: 'translation', participant: 'both' } })} />);
    expect(container.querySelector('.subtitle-stream.expanded')).not.toBeNull();
    expect([...container.querySelectorAll('.conversation-row .row-text')].map((el) => el.textContent)).toEqual(['こんにちは。']);
    expect(container.querySelector('.row-play-btn')).toBeNull();
  });
});
