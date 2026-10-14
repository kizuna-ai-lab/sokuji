import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { Row } from '../../lib/projection/types';
import type { DisplayItem } from '../../lib/view/filter';
import type { ReadingLanguage, RubyPiece } from '../../lib/reading/types';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));

const calls: { text: string; lang: ReadingLanguage | null; holdTail: boolean }[] = [];
let answer: (text: string) => RubyPiece[] | null = () => null;
vi.mock('../../lib/reading/useReading', () => ({
  useReading: (text: string, lang: ReadingLanguage | null, holdTail: boolean) => {
    calls.push({ text, lang, holdTail });
    return lang ? answer(text) : null;
  },
}));

const { ConversationList } = await import('./ConversationList');

const row = (over: Partial<Row> = {}): Row => ({ key: 'k', segmentId: 's:speaker:1', side: 'translation', start: 0, end: 4, text: '今日は雨', final: true, ...over });
const item = (over: Partial<Extract<DisplayItem, { kind: 'row' }>> = {}): DisplayItem => ({
  kind: 'row', row: row(), leg: 'speaker', languages: { source: 'zh', target: 'ja' }, t: 0, header: true, endsSegment: true, ...over,
});
const list = (items: DisplayItem[], readings?: ReadonlySet<ReadingLanguage>, lit = new Map()) => render(
  <ConversationList items={items} lit={lit} replaying={null} replayLegs={new Set()} canReplay={() => false} onReplay={() => {}} compact={false} fontSize={14} empty={null} readings={readings} />,
);
const JA: ReadonlySet<ReadingLanguage> = new Set(['ja']);

describe('ConversationList readings', () => {
  beforeEach(() => { calls.length = 0; answer = () => [{ text: '今日', reading: 'きょう' }, { text: 'は' }, { text: '雨', reading: 'あめ' }]; });

  it('draws ruby with hidden readings on a row in the target language', () => {
    const { container } = list([item()], JA);
    const rubies = container.querySelectorAll('.row-text ruby');
    expect(rubies).toHaveLength(2);
    expect(rubies[0].querySelector('rt')?.textContent).toBe('きょう');
    expect(rubies[0].querySelector('rt')?.getAttribute('aria-hidden')).toBe('true');
  });

  it("annotates the other side's original too, and not my source", () => {
    list([
      item({ row: row({ key: 'k1', side: 'source', text: '我们走吧' }), languages: { source: 'zh', target: 'ja' } }),
      item({ leg: 'participant', row: row({ key: 'k2', segmentId: 's:participant:1', side: 'source', text: '雨です' }), languages: { source: 'ja', target: 'zh' } }),
    ], JA);
    expect(calls.find((c) => c.text === '我们走吧')?.lang).toBeNull();
    expect(calls.find((c) => c.text === '雨です')?.lang).toBe('ja');
  });

  it("takes the row's detected language over the leg (face-to-face code-switching)", () => {
    list([item({ row: row({ language: 'zh', text: '好的' }) })], JA);
    expect(calls[0].lang).toBeNull();
  });

  it("draws today's markup with the switch off", () => {
    const { container } = list([item()]);
    expect(container.querySelector('ruby')).toBeNull();
    expect(container.querySelector('.row-text')?.textContent).toBe('今日は雨');
  });

  it('holds the tail only on an unfinished row that ends its segment', () => {
    list([item({ row: row({ final: false }), endsSegment: true }), item({ row: row({ key: 'k2', final: false }), endsSegment: false })], JA);
    expect(calls.map((c) => c.holdTail)).toEqual([true, false]);
  });

  it('re-annotates when a final row\'s text changes (punctuation fill-in)', () => {
    const { rerender } = list([item()], JA);
    rerender(<ConversationList items={[item({ row: row({ text: '今日は雨。', end: 5 }) })]} lit={new Map()} replaying={null} replayLegs={new Set()} canReplay={() => false} onReplay={() => {}} compact={false} fontSize={14} empty={null} readings={JA} />);
    expect(calls[calls.length - 1]?.text).toBe('今日は雨。');
  });

  it('karaoke over pieces: plain text splits at the offset, a ruby piece counts once wholly played', () => {
    const { container } = list([item()], JA, new Map([['s:speaker:1', 3]]));
    const played = [...container.querySelectorAll('.karaoke-played')].map((n) => n.textContent).join('');
    expect(played).toBe('今日きょうは');
  });

  it('karaoke over pieces keeps a surrogate pair whole', () => {
    answer = () => [{ text: '𠮷' }, { text: '雨', reading: 'あめ' }];
    const { container } = list([item({ row: row({ text: '𠮷雨', end: 3 }) })], JA, new Map([['s:speaker:1', 1]]));
    expect(container.querySelector('.row-text')?.textContent).toBe('𠮷雨あめ');
    expect(container.querySelector('.karaoke-played')).toBeNull();
  });
});
