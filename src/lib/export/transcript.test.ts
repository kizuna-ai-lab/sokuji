import { describe, it, expect } from 'vitest';
import type { Leg, Segment } from '../conversation/types';
import type { Entry } from '../projection/types';
import { renderTranscriptTxt, renderTranscriptJson } from './transcript';

let n = 0;
const seg = (leg: 'speaker' | 'participant', over: Partial<Segment>): Segment => ({
  id: `s:${leg}:${++n}`, ref: n, side: 'source', text: '', final: true, openedAt: 0, marks: [], speech: [], ...over,
});
const rows = (s: Segment) => [{ key: `${s.id}:0`, segmentId: s.id, side: s.side, start: 0, end: s.text.length }];

const src = seg('speaker', { text: '今天天气很好。我们去公园吧。', openedAt: 1_000 });
const tr = seg('speaker', { side: 'translation', text: 'The weather is nice. Let us go to the park.', openedAt: 1_500 });
const other = seg('participant', { text: 'Sounds good.', openedAt: 8_000 });
const otherTr = seg('participant', { side: 'translation', text: '听起来不错。', openedAt: 8_400 });
const lone = seg('speaker', { text: '下午三点吧。', openedAt: 13_000 });
const legs: Leg[] = [
  { leg: 'speaker', session: 's', languages: { source: 'zh', target: 'en' }, segments: [src, tr, lone], notices: [] },
  { leg: 'participant', session: 's', languages: { source: 'en', target: 'zh' }, segments: [other, otherTr], notices: [] },
];
const entries: Entry[] = [
  { kind: 'exchange', id: 'a', leg: 'speaker', languages: legs[0].languages, pairing: 'stated', source: rows(src), translation: rows(tr), t: 1_000 },
  { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'hiccup', at: 2_000 },
  { kind: 'exchange', id: 'b', leg: 'participant', languages: legs[1].languages, pairing: 'inferred', source: rows(other), translation: rows(otherTr), t: 8_000 },
  { kind: 'exchange', id: 'c', leg: 'speaker', languages: legs[0].languages, pairing: 'none', source: rows(lone), translation: [], t: 13_000 },
];
const options = {
  labels: { me: 'Me', other: 'Other', noTranslation: '(no translation)', noSource: '(no source)' },
  formatTime: (ms: number) => `[t${ms}]`,
};

describe('renderTranscriptTxt', () => {
  it('writes one block per group, whole segment text, one timestamp, a stated missing side, and no notices', () => {
    expect(renderTranscriptTxt(entries, legs, options)).toBe([
      '[t1000] Me',
      '  今天天气很好。我们去公园吧。',
      '  → The weather is nice. Let us go to the park.',
      '',
      '[t8000] Other',
      '  Sounds good.',
      '  → 听起来不错。',
      '',
      '[t13000] Me',
      '  下午三点吧。',
      '  (no translation)',
      '',
    ].join('\n'));
  });

  it('honours the scope: translation only', () => {
    const txt = renderTranscriptTxt(entries, legs, { ...options, scope: { source: false, translation: true } });
    expect(txt).toContain('  → The weather is nice.');
    expect(txt).not.toContain('今天天气很好');
  });
});

describe('renderTranscriptJson', () => {
  it('keeps pairing and ids on every group and lists notices separately', () => {
    const json = renderTranscriptJson(entries, legs);
    expect(json.groups.map((g) => [g.id, g.pairing, g.source?.text, g.translation?.text])).toEqual([
      ['a', 'stated', '今天天气很好。我们去公园吧。', 'The weather is nice. Let us go to the park.'],
      ['b', 'inferred', 'Sounds good.', '听起来不错。'],
      ['c', 'none', '下午三点吧。', undefined],
    ]);
    expect(json.groups[0].source?.segmentIds).toEqual([src.id]);
    expect(json.notices).toEqual([{ id: 'n', leg: 'speaker', at: 2_000, severity: 'warning', message: 'hiccup', code: undefined }]);
  });

  it('joins several segments of one side with a space only between space-delimited text', () => {
    const zh1 = seg('speaker', { text: '今天天气很好。', openedAt: 0 });
    const zh2 = seg('speaker', { text: '我们去公园吧。', openedAt: 100 });
    const en1 = seg('speaker', { side: 'translation', text: 'The weather is nice.', openedAt: 200 });
    const en2 = seg('speaker', { side: 'translation', text: 'Let us go to the park.', openedAt: 300 });
    const leg: Leg = { leg: 'speaker', session: 's', languages: { source: 'zh', target: 'en' }, segments: [zh1, zh2, en1, en2], notices: [] };
    const e: Entry = { kind: 'exchange', id: 'm', leg: 'speaker', languages: leg.languages, pairing: 'stated', source: [...rows(zh1), ...rows(zh2)], translation: [...rows(en1), ...rows(en2)], t: 0 };
    const [g] = renderTranscriptJson([e], [leg]).groups;
    expect(g.source?.text).toBe('今天天气很好。我们去公园吧。');
    expect(g.translation?.text).toBe('The weather is nice. Let us go to the park.');
    expect(g.source?.segmentIds).toEqual([zh1.id, zh2.id]);
  });
});

describe('renderTranscriptJson — notice params', () => {
  it('writes a notice with its code and params', () => {
    const json = renderTranscriptJson([{ kind: 'notice', id: 'n2', leg: 'participant', severity: 'error', message: 'ended', code: 'source_ended', params: { leg: 'participant' }, at: 9 }], []);
    expect(json.notices).toEqual([{ id: 'n2', leg: 'participant', at: 9, severity: 'error', message: 'ended', code: 'source_ended', params: { leg: 'participant' } }]);
  });
});
