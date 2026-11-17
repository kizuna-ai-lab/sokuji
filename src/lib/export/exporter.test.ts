import { describe, it, expect } from 'vitest';
import type { Leg, Segment } from '../conversation/types';
import type { Entry } from '../projection/types';
import { conversationExporter, exportWords, rowsExporter } from './exporter';
import { FULL_SCOPE } from './transcript';

// Local times, so the formatted clock reads the same in every timezone.
const started = new Date(2026, 8, 24, 10, 0, 0).getTime();
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
  entries, legs, info: { provider: 'fake', models: { asrModel: 'a', ttsModel: 't' }, startedAt: started }, words, appVersion: '9.9.9', now: () => exported, ...over,
});

describe('conversationExporter', () => {
  it("copies without a header and writes a file with one: when the session started and when it was exported, the run's own provider and models", () => {
    expect(exporter().text(FULL_SCOPE, false)).toBe('[10:00:05] Me\n  今日は天気がいいですね。\n  → 今天天气很好。\n');
    expect(exporter().text(FULL_SCOPE, true)).toBe([
      'Sokuji conversation export',
      'Session started: 2026-09-24 10:00:00',
      'Exported: 2026-09-24 10:01:00',
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

  it('answers false for a scope that shows only a side the one exchange has no rows for', () => {
    const noTranslation: Entry[] = [
      { kind: 'exchange', id: 'g', leg: 'speaker', languages: legs[0].languages, pairing: 'stated', source: [row(src)], translation: [], t: said },
    ];
    expect(exporter({ entries: noTranslation }).hasScopedContent({ speaker: 'translation', participant: 'none' })).toBe(false);
  });

  it('writes the JSON with the metadata of the export and the run: when the session started, and when it was exported', () => {
    const written = exporter().json(FULL_SCOPE);
    expect(written.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(written);
    expect(Object.keys(parsed)).toEqual(['format', 'sessionStartedAt', 'exportedAt', 'appVersion', 'provider', 'models', 'languages', 'groups', 'notices']);
    expect(parsed).toMatchObject({
      format: 'sokuji-conversation/2',
      sessionStartedAt: new Date(started).toISOString(),
      exportedAt: new Date(exported).toISOString(),
      appVersion: '9.9.9',
      provider: 'fake',
      models: { asr: 'a', tts: 't' },
      languages: { source: 'ja', target: 'zh' },
      groups: [{ id: 'g', source: { text: '今日は天気がいいですね。' }, translation: { text: '今天天气很好。' } }],
    });
  });

  it('names no provider, no models and no session start before any run', () => {
    const text = exporter({ info: null }).text(FULL_SCOPE, true);
    expect(text).not.toContain('Provider:');
    expect(text).not.toContain('Models:');
    expect(text).not.toContain('Session started:');
    expect(text).toContain('Exported: 2026-09-24 10:01:00');
    expect(JSON.parse(exporter({ info: null }).json(FULL_SCOPE)).sessionStartedAt).toBeNull();
  });
});

describe('exportWords', () => {
  it("reads today's export keys, the two new ones, and the person's", () => {
    const keyed = exportWords((key, defaultValue, params) => `${key}|${defaultValue}${params ? `|${JSON.stringify(params)}` : ''}`);
    const { person, ...labels } = keyed.labels;
    expect(labels).toEqual({
      me: 'mainPanel.export.speakerYou|Me',
      other: 'mainPanel.export.speakerOther|Other',
      noTranslation: 'mainPanel.export.noTranslation|(no translation)',
      noSource: 'mainPanel.export.noSource|(no source)',
    });
    expect(person(3)).toBe('mainPanel.displayMode.person|Speaker {{n}}|{"n":3}');
    expect(keyed.header.sessionStarted).toBe('mainPanel.export.headerSessionStarted|Session started');
    expect(keyed.header.exported).toBe('mainPanel.export.headerExported|Exported');
    expect(keyed.header.narrowed).toBe('mainPanel.export.headerNarrowed|Note: this export was narrowed at export time — some lines were left out.');
  });
});

// Review: a file transcript (an imported file's, or a record transcribed again) has no conversation behind it: it is
// exported from its own rows, as the page shows them.
describe('rowsExporter', () => {
  const start = new Date(2026, 8, 24, 10, 0, 0).getTime();
  const rows = [
    { leg: 'participant' as const, startMs: 5000, speakerLabel: 'Speaker 1', sentences: [{ n: 1, text: 'Welcome.' }, { n: 2, text: 'Let us start.' }], translation: null },
    { leg: 'participant' as const, startMs: 65_000, speakerLabel: 'Speaker 2', sentences: [{ n: 3, text: '好的。' }, { n: 4, text: '开始吧。' }], translation: null },
  ];
  const rowsOut = (over: Partial<Parameters<typeof rowsExporter>[0]> = {}) => rowsExporter({
    rows, startedAt: start, legs: [], info: { provider: 'soniox', models: {}, startedAt: start }, words, appVersion: '9.9.9', now: () => exported, ...over,
  });

  it('writes each row at its clock time with its speaker, and its sentences as one line', () => {
    expect(rowsOut().text(FULL_SCOPE, false)).toBe('[10:00:05] Speaker 1\n  Welcome. Let us start.\n\n[10:01:05] Speaker 2\n  好的。开始吧。\n');
    expect(rowsOut().text(FULL_SCOPE, true).split('\n').slice(0, 5)).toEqual([
      'Sokuji conversation export', 'Session started: 2026-09-24 10:00:00', 'Exported: 2026-09-24 10:01:00', 'Provider: soniox', '',
    ]);
  });

  it('answers the menu, and leaves out a side the scope drops', () => {
    expect(rowsOut().hasContent).toBe(true);
    expect(rowsOut().hasScopedContent(FULL_SCOPE)).toBe(true);
    expect(rowsOut().hasScopedContent({ speaker: 'both', participant: 'none' })).toBe(false);
    expect(rowsOut().hasScopedContent({ speaker: 'none', participant: 'translation' })).toBe(false);
    expect(rowsOut({ rows: [] }).hasContent).toBe(false);
  });

  it('writes the JSON with the metadata and one group per row', () => {
    const json = JSON.parse(rowsOut().json(FULL_SCOPE));
    expect(json.format).toBe('sokuji-transcript/1');
    expect(json.sessionStartedAt).toBe(new Date(start).toISOString());
    expect(json.exportedAt).toBe(new Date(exported).toISOString());
    expect(json.provider).toBe('soniox');
    expect(json.groups).toEqual([
      { leg: 'participant', t: new Date(start + 5000).toISOString(), speaker: 'Speaker 1', source: { text: 'Welcome. Let us start.' } },
      { leg: 'participant', t: new Date(start + 65_000).toISOString(), speaker: 'Speaker 2', source: { text: '好的。开始吧。' } },
    ]);
  });
});
