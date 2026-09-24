import { describe, it, expect } from 'vitest';
import type { Leg, Segment } from '../conversation/types';
import type { Entry } from '../projection/types';
import { conversationExporter, exportWords } from './exporter';
import { FULL_SCOPE } from './transcript';

// Local times, so the formatted clock reads the same in every timezone.
const said = new Date(2026, 8, 24, 10, 0, 5).getTime();
const exported = new Date(2026, 8, 24, 10, 1, 0).getTime();

const seg = (over: Partial<Segment>): Segment => ({ id: 'x', ref: 1, side: 'source', text: '', final: true, openedAt: said, marks: [], speech: [], ...over });
const src = seg({ id: 'r:speaker:1', text: '今日は天気がいいですね。' });
const tr = seg({ id: 'r:speaker:2', side: 'translation', text: '今天天气很好。', openedAt: said + 400 });
const legs: Leg[] = [{ leg: 'speaker', session: 'r', languages: { source: 'ja', target: 'zh' }, segments: [src, tr], notices: [] }];
const row = (s: Segment) => ({ key: `${s.id}:0`, segmentId: s.id, side: s.side, start: 0, end: s.text.length, text: s.text, final: true });
const entries: Entry[] = [
  { kind: 'exchange', id: 'g', leg: 'speaker', languages: legs[0].languages, pairing: 'stated', source: [row(src)], translation: [row(tr)], t: said },
];
const words = exportWords((_key, defaultValue) => defaultValue);
const exporter = (over: Partial<Parameters<typeof conversationExporter>[0]> = {}) => conversationExporter({
  entries, legs, info: { provider: 'fake', models: { asrModel: 'a', ttsModel: 't' } }, words, appVersion: '9.9.9', now: () => exported, ...over,
});

describe('conversationExporter', () => {
  it("copies without a header and writes a file with one, from the run's own provider and models", () => {
    expect(exporter().text(FULL_SCOPE, false)).toBe('[10:00:05] Me\n  今日は天気がいいですね。\n  → 今天天气很好。\n');
    expect(exporter().text(FULL_SCOPE, true)).toBe([
      'Sokuji conversation export',
      'Generated: 2026-09-24 10:01:00',
      'Provider: fake',
      'Models: asr=a, tts=t',
      "My Language: ja → Other's Language: zh",
      '',
      '[10:00:05] Me',
      '  今日は天気がいいですね。',
      '  → 今天天气很好。',
      '',
    ].join('\n'));
  });

  it('answers the menu: is there a conversation, and does the scope select any of it', () => {
    expect(exporter().hasContent).toBe(true);
    expect(exporter().hasScopedContent({ speaker: 'source', participant: 'both' })).toBe(true);
    expect(exporter().hasScopedContent({ speaker: 'none', participant: 'both' })).toBe(false);
    expect(exporter({ entries: [], legs: [] }).hasContent).toBe(false);
  });

  it('writes the JSON with the metadata of the export and the run', () => {
    expect(JSON.parse(exporter().json(FULL_SCOPE))).toMatchObject({
      exportedAt: new Date(exported).toISOString(),
      appVersion: '9.9.9',
      provider: 'fake',
      models: { asr: 'a', tts: 't' },
      languages: { source: 'ja', target: 'zh' },
      groups: [{ id: 'g', source: { text: '今日は天気がいいですね。' }, translation: { text: '今天天气很好。' } }],
    });
  });

  it('names no provider and no models before any run', () => {
    const text = exporter({ info: null }).text(FULL_SCOPE, true);
    expect(text).not.toContain('Provider:');
    expect(text).not.toContain('Models:');
  });
});

describe('exportWords', () => {
  it("reads today's export keys, and the two new ones", () => {
    const keyed = exportWords((key, defaultValue) => `${key}|${defaultValue}`);
    expect(keyed.labels).toEqual({
      me: 'mainPanel.export.speakerYou|Me',
      other: 'mainPanel.export.speakerOther|Other',
      noTranslation: 'mainPanel.export.noTranslation|(no translation)',
      noSource: 'mainPanel.export.noSource|(no source)',
    });
    expect(keyed.header.narrowed).toBe('mainPanel.export.headerNarrowed|Note: this export was narrowed at export time — some lines were left out.');
  });
});
