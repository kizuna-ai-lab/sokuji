import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import type { AdapterEvent } from '../contract/events';
import type { ClientDiagnosticCode } from '../diagnostics/clientDiagnostics';
import { Conversation, DEGRADED_DEDUPE_MS, MARK_COMPACT_MS, type ConversationDiagnostic } from './Conversation';

// The real rows, plus one test-only row whose severity is 'error': every real
// row is a warning, as is the fallback for an unknown code, so without this row
// no case could tell the table's severity from the fallback.
vi.mock('../diagnostics/clientDiagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/clientDiagnostics')>();
  return { ...actual, CLIENT_DIAGNOSTICS: { ...actual.CLIENT_DIAGNOSTICS, test_error_row: { severity: 'error' } } };
});
/** The test-only row above; not a real code, hence the cast. */
const TEST_ERROR_ROW = 'test_error_row' as ClientDiagnosticCode;

const pcm = (n: number) => new Int16Array(n);

function make(extra: Partial<ConstructorParameters<typeof Conversation>[0]> = {}) {
  const clock = createVirtualClock(10_000);
  const diagnostics: ConversationDiagnostic[] = [];
  const conv = new Conversation({
    leg: 'speaker', session: 's1', languages: { source: 'ja', target: 'en' }, clock,
    onDiagnostic: (d) => diagnostics.push(d),
    ...extra,
  });
  const apply = (...events: AdapterEvent[]) => events.forEach((e) => conv.apply(e));
  return { clock, conv, diagnostics, apply };
}

describe('Conversation — identity and text', () => {
  it('names segments by session, leg and a counter, in order of opening', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 5, side: 'source' } }, { kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } });
    expect(conv.snapshot().segments.map((s) => s.id)).toEqual(['s1:speaker:1', 's1:speaker:2']);
    expect(conv.snapshot().segments[0].openedAt).toBe(10_000);
  });

  it('replaces text wholesale, records timing and language, and keeps a compacted growth trace', () => {
    const { conv, clock, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: '今日' } });
    clock.advance(MARK_COMPACT_MS - 1);
    apply({ kind: 'segmentText', payload: { ref: 1, text: '今日は' } });
    clock.advance(2000);
    apply({ kind: 'segmentText', payload: { ref: 1, text: '今日は晴れ', timing: { startMs: 0, endMs: 900 }, language: 'ja' } });
    const seg = conv.snapshot().segments[0];
    expect(seg.text).toBe('今日は晴れ');
    expect(seg.timing).toEqual({ startMs: 0, endMs: 900 });
    expect(seg.language).toBe('ja');
    expect(seg.marks).toEqual([{ at: 10_000 + MARK_COMPACT_MS - 1, len: 3 }, { at: 12_099, len: 5 }]);
  });

  it('closes a segment as final and records a stated origin', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } });
    expect(conv.snapshot().segments[0]).toMatchObject({ final: true, origin: 'u1' });
  });

  it('treats text after close as a revision without reopening', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'a' } }, { kind: 'segmentClosed', payload: { ref: 1 } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'ab' } });
    expect(conv.snapshot().segments[0]).toMatchObject({ text: 'ab', final: true });
  });

  it('reports a contract violation for text on an unknown ref and for a ref opened twice, and ignores them', () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentText', payload: { ref: 3, text: 'x' } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    expect(diagnostics.map((d) => d.code)).toEqual(['contract_violation', 'contract_violation']);
    expect(conv.snapshot().segments).toHaveLength(1);
  });

  it('ignores a re-sent identical text, so a pause survives and the segment keeps its identity', () => {
    const { conv, clock, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'abc' } });
    const before = conv.snapshot();
    for (let k = 0; k < 6; k++) { clock.advance(300); apply({ kind: 'segmentText', payload: { ref: 1, text: 'abc' } }); }
    expect(conv.snapshot()).toBe(before);
    clock.advance(300);
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'abcdef' } });
    expect(conv.snapshot().segments[0].marks.map((m) => [m.at - 10_000, m.len])).toEqual([[0, 3], [2100, 6]]);
  });

  it('pushes no growth mark when only the timing or the language changed', () => {
    const { conv, clock, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello' } });
    const before = conv.snapshot().segments[0].marks;
    clock.advance(5000);
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello', timing: { startMs: 0, endMs: 400 }, language: 'en' } });
    const seg = conv.snapshot().segments[0];
    expect(seg.timing).toEqual({ startMs: 0, endMs: 400 });
    expect(seg.language).toBe('en');
    expect(seg.marks).toEqual(before);
  });
});

describe('Conversation — audio', () => {
  it('attaches audio to its segment with its range', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 2, text: 'Hello there.' } });
    apply({ kind: 'audio', payload: { ref: 2, range: [0, 6], pcm: pcm(240) } });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 6], pcm: pcm(240) }]);
  });

  it('holds audio that arrives before its segment opens, and attaches it on open', () => {
    const { conv, apply } = make();
    apply({ kind: 'audio', payload: { ref: 2, pcm: pcm(240) } });
    expect(conv.snapshot().segments).toHaveLength(0);
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } });
    expect(conv.snapshot().segments[0].speech).toHaveLength(1);
  });

  it('ignores audio without a ref', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'audio', payload: { pcm: pcm(240) } });
    expect(conv.snapshot().segments[0].speech).toEqual([]);
  });

  it('keeps a range that overtakes its text, and checks it when the segment closes', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 12], pcm: pcm(2400) } }); // "Hello there." has not arrived yet
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello there.' } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    expect(conv.snapshot().segments[0].speech[0].range).toEqual([0, 12]);
  });

  it('drops a range still outside the text once the segment closes, and reports it once', () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hi.' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 40], pcm: pcm(2400) } });
    expect(conv.snapshot().segments[0].speech[0].range).toEqual([0, 40]);
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    expect(conv.snapshot().segments[0].speech[0].range).toBeUndefined();
    expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);
  });

  it("drops a range past a segment's text and reports it right away when the audio arrives after close, with no fill-in in flight (Gemini/AST2 follow-up, choice 19)", () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 12], pcm: pcm(240) } }); // 12 is past 'hello world' (11 characters)
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: undefined, pcm: pcm(240) }]);
    expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);
  });

  it("after fill-in, re-anchors a range measured against the adapter's own text onto the filled text (Gemini/AST2 follow-up, choice 19)", async () => {
    const { conv, diagnostics, apply } = make({ languages: { source: 'ja', target: 'zh' }, punctuate: async () => '我来帮你，翻译。' });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: '我来帮你翻译' } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    await conv.settled();
    expect(conv.snapshot().segments[0].text).toBe('我来帮你，翻译。');
    // The whole of the adapter's text, [0, 6]: the whole of the filled one.
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 6], pcm: pcm(240) } });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 8], pcm: pcm(240) }]);
    expect(diagnostics).toEqual([]);
  });

  it("after fill-in, drops a range past the adapter's own text with a diagnostic, keeping the pcm", async () => {
    const { conv, diagnostics, apply } = make({ punctuate: async () => 'Hello, world.' });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    await conv.settled();
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 12], pcm: pcm(240) } }); // 12 is past 'hello world' (11), not past the filled text (13)
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: undefined, pcm: pcm(240) }]);
    expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);
  });
});

describe('Conversation — notices and closing', () => {
  it('turns failed into an error notice and degraded into a notice with the table\'s severity', () => {
    const { conv, apply } = make();
    apply({ kind: 'failed', payload: { message: 'socket died', code: 'E1' } });
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
    apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'no voice' } });
    apply({ kind: 'degraded', payload: { code: TEST_ERROR_ROW, message: 'an error row' } });
    expect(conv.snapshot().notices.map((n) => [n.severity, n.message, n.code])).toEqual([
      ['error', 'socket died', 'E1'],
      ['warning', 'bad frame', 'parse_error'],
      ['warning', 'no voice', 'tts_degraded'],
      ['error', 'an error row', 'test_error_row'],
    ]);
    expect(conv.snapshot().notices[0].id).toBe('s1:speaker:n1');
  });

  it('finalizes every open segment on failed, since nothing follows it', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    apply({ kind: 'failed', payload: { message: 'socket died' } });
    expect(conv.snapshot().segments[0].final).toBe(true);
  });

  it('a session-level failed also checks an open segment\'s held ranges, via finalizeAll', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hi.' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 40], pcm: pcm(10) } });
    apply({ kind: 'failed', payload: { message: 'socket died' } });
    expect(conv.snapshot().segments[0].speech[0].range).toBeUndefined();
  });

  it('records a failure without a code as leg_failed, so it has words', () => {
    const { conv, apply } = make();
    apply({ kind: 'failed', payload: { message: 'socket closed' } });
    const notices = conv.snapshot().notices;
    expect(notices[notices.length - 1]).toMatchObject({ severity: 'error', code: 'leg_failed', message: 'socket closed' });
  });

  it('finalizes every open segment on closed and on finalizeAll', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } });
    apply({ kind: 'closed', payload: { reason: 'server' } });
    expect(conv.snapshot().segments.every((s) => s.final)).toBe(true);
    apply({ kind: 'segmentOpened', payload: { ref: 3, side: 'source' } });
    conv.finalizeAll();
    expect(conv.snapshot().segments[2].final).toBe(true);
  });

  it('ignores loading, busy, frame, reconnecting and reconnected', () => {
    const { conv, apply } = make();
    apply({ kind: 'loading', payload: { stage: 'asr', done: 1, total: 2 } }, { kind: 'busy', payload: true }, { kind: 'frame', payload: { direction: 'in', type: 't' } }, { kind: 'reconnecting', payload: undefined }, { kind: 'reconnected', payload: undefined });
    expect(conv.snapshot()).toMatchObject({ segments: [], notices: [] });
  });
});

describe('Conversation — snapshot sharing', () => {
  it('returns the same Leg until something changes, and keeps untouched segment objects', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentOpened', payload: { ref: 2, side: 'source' } });
    const a = conv.snapshot();
    expect(conv.snapshot()).toBe(a);
    apply({ kind: 'segmentText', payload: { ref: 2, text: 'x' } });
    const b = conv.snapshot();
    expect(b).not.toBe(a);
    expect(b.segments[0]).toBe(a.segments[0]);
    expect(b.segments[1]).not.toBe(a.segments[1]);
  });

  it('notifies subscribers on every change', () => {
    const { conv, apply } = make();
    let n = 0;
    const off = conv.subscribe(() => n++);
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'a' } });
    expect(n).toBe(2);
    off();
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'ab' } });
    expect(n).toBe(2);
  });

  it('notifies once per event, after the whole event', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentOpened', payload: { ref: 2, side: 'source' } });
    const seen: Array<[string | undefined, boolean]> = [];
    conv.subscribe(() => { const s = conv.snapshot().segments[0]; seen.push([s.origin, s.final]); });
    apply({ kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } });
    expect(seen).toEqual([['u1', true]]);
    let n = 0;
    conv.subscribe(() => n++);
    conv.finalizeAll();
    expect(n).toBe(1);
  });
});

describe('Conversation — re-anchoring and fill-in', () => {
  it('re-anchors speech ranges when punctuation is inserted, and drops them when letters change', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 5], pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 1, range: [6, 11], pcm: pcm(10) } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello, world.' } });
    expect(conv.snapshot().segments[0].speech.map((s) => s.range)).toEqual([[0, 7], [7, 13]]);
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hallo, world.' } });
    expect(conv.snapshot().segments[0].speech.map((s) => s.range)).toEqual([undefined, undefined]);
    expect(conv.snapshot().segments[0].speech.every((s) => s.pcm.length === 10)).toBe(true);
  });

  it('a range held past an open segment\'s text is dropped when the text is rewritten, not shrunk, and kept when it grows', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [6, 20], pcm: pcm(10) } }); // past the text so far: kept while open
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello, world.' } }); // re-punctuated, not grown
    expect(conv.snapshot().segments[0].speech[0]).toEqual({ range: undefined, pcm: pcm(10) });

    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 2, text: 'hello' } });
    apply({ kind: 'audio', payload: { ref: 2, range: [6, 11], pcm: pcm(10) } });
    apply({ kind: 'segmentText', payload: { ref: 2, text: 'hello world' } }); // grown
    expect(conv.snapshot().segments[1].speech[0].range).toEqual([6, 11]);
  });

  it('runs fill-in when a segment closes, in the segment\'s language, and re-anchors through it', async () => {
    const seen: string[] = [];
    const { conv, apply } = make({ punctuate: async (lang, text) => { seen.push(`${lang}:${text}`); return `${text}.`; } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 11], pcm: pcm(10) } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    await conv.settled();
    expect(seen).toEqual(['en:hello world']);
    expect(conv.snapshot().segments[0]).toMatchObject({ text: 'hello world.', final: true });
    expect(conv.snapshot().segments[0].speech[0].range).toEqual([0, 11]);
  });

  it('prefers the segment\'s detected language and skips fill-in for an auto source', async () => {
    const seen: string[] = [];
    const { conv, apply } = make({ languages: { source: 'auto', target: 'en' }, punctuate: async (lang, text) => { seen.push(lang); return `${text}.`; } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'a b' } }, { kind: 'segmentClosed', payload: { ref: 1 } });
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'source' } }, { kind: 'segmentText', payload: { ref: 2, text: 'c d', language: 'ja-JP' } }, { kind: 'segmentClosed', payload: { ref: 2 } });
    await conv.settled();
    expect(seen).toEqual(['ja']);
    expect(conv.snapshot().segments[0].text).toBe('a b');
  });

  it('settled() waits for a slow fill-in', async () => {
    const { conv, apply } = make({ punctuate: (_l, t) => new Promise((r) => setTimeout(() => r(`${t}.`), 20)) });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'a b' } }, { kind: 'segmentClosed', payload: { ref: 1 } });
    await conv.settled();
    expect(conv.snapshot().segments[0].text).toBe('a b.');
  });

  it('moves the growth trace with the text when fill-in rewrites it', async () => {
    const { conv, clock, apply } = make({ punctuate: async () => 'Hello, world how are you.' });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    clock.advance(2000);
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'hello world how are you' } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    await conv.settled();
    expect(conv.snapshot().segments[0].marks.map((m) => m.len)).toEqual([13, 25]);
  });
});

describe('Conversation — ranges filled in after the audio (speechRanges)', () => {
  const ranges = (ref: number, list: Array<[number, [number, number]]>): AdapterEvent => ({ kind: 'speechRanges', payload: { ref, ranges: list.map(([index, range]) => ({ index, range })) } });
  const speechOf = (conv: Conversation, k = 0) => conv.snapshot().segments[k].speech;

  it('sets ranges on speech a closed segment already holds', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 1, pcm: pcm(10) } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    apply(ranges(1, [[0, [0, 5]], [1, [6, 11]]]));
    expect(speechOf(conv).map((s) => s.range)).toEqual([[0, 5], [6, 11]]);
    expect(speechOf(conv).map((s) => s.pcm.length)).toEqual([10, 10]);
  });

  it("re-anchors ranges measured against the adapter's text onto punctuation fill-in's", async () => {
    const { conv, apply } = make({ punctuate: async () => 'Hello, world.' });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 1, pcm: pcm(10) } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    await conv.settled();
    expect(conv.snapshot().segments[0].text).toBe('Hello, world.');
    apply(ranges(1, [[0, [0, 5]], [1, [5, 11]]]));
    expect(speechOf(conv).map((s) => s.range)).toEqual([[0, 7], [7, 13]]);
  });

  it('a fill-in landing after the ranges re-anchors them as it re-anchors any range', async () => {
    const { conv, apply } = make({ punctuate: () => new Promise((r) => setTimeout(() => r('Hello, world.'), 20)) });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 1, pcm: pcm(10) } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    apply(ranges(1, [[0, [0, 5]], [1, [5, 11]]]));
    expect(speechOf(conv).map((s) => s.range)).toEqual([[0, 5], [5, 11]]);
    await conv.settled();
    expect(speechOf(conv).map((s) => s.range)).toEqual([[0, 7], [7, 13]]);
  });

  it('a revision after fill-in measures later ranges against the revised text, not the pre-fill one', async () => {
    const { conv, apply } = make({ punctuate: async () => 'Hello, world.' });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 1, pcm: pcm(10) } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    await conv.settled();
    expect(conv.snapshot().segments[0].text).toBe('Hello, world.');
    // Different letters on purpose: a revision that only grows re-anchors the same either way.
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'hello there' } });
    apply(ranges(1, [[0, [0, 5]], [1, [6, 11]]]));
    expect(speechOf(conv).map((s) => s.range)).toEqual([[0, 5], [6, 11]]);
  });

  it('sets ranges on audio held before its segment opened', () => {
    const { conv, apply } = make();
    apply({ kind: 'audio', payload: { ref: 3, pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 3, pcm: pcm(10) } });
    apply(ranges(3, [[1, [2, 4]]]));
    apply({ kind: 'segmentOpened', payload: { ref: 3, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 3, text: 'abcd' } });
    expect(speechOf(conv).map((s) => s.range)).toEqual([undefined, [2, 4]]);
  });

  it('drops a range for an entry the segment does not hold, or an invalid range, with a diagnostic, and applies the rest', () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'Hello' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } });
    apply(ranges(1, [[0, [0, 3]], [4, [0, 1]], [0, [5, 2]]]));
    expect(speechOf(conv)[0].range).toEqual([0, 3]);
    expect(diagnostics.map((d) => d.code).filter((c) => c === 'range_out_of_text')).toHaveLength(2);
  });

  it('ignores ranges for a ref it does not hold', () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'abc' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }, { kind: 'segmentClosed', payload: { ref: 1 } });
    conv.clear();
    const before = conv.snapshot();
    apply(ranges(1, [[0, [0, 3]]]));
    expect(conv.snapshot()).toBe(before);
    expect(diagnostics).toEqual([]);
  });

  it("counts a fill-in's entries from the adapter's first audio, across a clear", () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }); // the adapter's entries 0 and 1
    conv.clear();
    expect(conv.snapshot().segments.map((s) => [s.text, s.speech.length])).toEqual([['', 0]]);
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'hello world, bye' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }); // the adapter's entry 2
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    apply(ranges(1, [[0, [0, 5]], [1, [6, 11]], [2, [13, 16]]]));
    expect(speechOf(conv).map((s) => s.range)).toEqual([[13, 16]]);
    expect(diagnostics).toEqual([]);
  });

  it("drops a filled range beyond a closed segment's text, keeping the pcm", () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'Hi.' } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } }, { kind: 'audio', payload: { ref: 1, pcm: pcm(10) } });
    apply(ranges(1, [[0, [0, 9]]]));
    expect(speechOf(conv)[0]).toEqual({ range: undefined, pcm: pcm(10) });
    expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);
  });

  it("after fill-in, drops a filled range beyond the adapter's own text with the same diagnostic as without it", async () => {
    // Rewritten by fill-in: the skeleton re-anchoring leaves such a range unmapped.
    const rewritten = make({ punctuate: async () => 'Hello, world.' });
    rewritten.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    rewritten.apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 1, pcm: pcm(10) } });
    rewritten.apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    await rewritten.conv.settled();
    expect(rewritten.conv.snapshot().segments[0].text).toBe('Hello, world.');
    rewritten.apply(ranges(1, [[0, [0, 5]], [1, [5, 12]]])); // 12 is past 'hello world' (11), not past the filled text (13)
    expect(speechOf(rewritten.conv).map((s) => s.range)).toEqual([[0, 7], undefined]);
    expect(rewritten.diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);

    // Only grown by fill-in: the range would otherwise stand, since it fits the filled text.
    const grown = make({ punctuate: async (_l, t) => `${t}.` });
    grown.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    grown.apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }, { kind: 'segmentClosed', payload: { ref: 1 } });
    await grown.conv.settled();
    expect(grown.conv.snapshot().segments[0].text).toBe('hello world.');
    grown.apply(ranges(1, [[0, [0, 12]]]));
    expect(speechOf(grown.conv)[0]).toEqual({ range: undefined, pcm: pcm(10) });
    expect(grown.diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);
  });

  it('on held audio too, a bad entry is reported and an entry named twice takes the last range, as on a segment', () => {
    const held = make();
    held.apply({ kind: 'audio', payload: { ref: 3, pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 3, pcm: pcm(10) } });
    held.apply(ranges(3, [[1, [0, 2]], [1, [2, 4]], [5, [0, 1]], [0, [3, 1]]]));
    expect(held.diagnostics.map((d) => d.code)).toEqual(['range_out_of_text', 'range_out_of_text']);
    held.apply({ kind: 'segmentOpened', payload: { ref: 3, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 3, text: 'abcd' } });
    expect(speechOf(held.conv).map((s) => s.range)).toEqual([undefined, [2, 4]]);

    const open = make();
    open.apply({ kind: 'segmentOpened', payload: { ref: 3, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 3, text: 'abcd' } });
    open.apply({ kind: 'audio', payload: { ref: 3, pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 3, pcm: pcm(10) } });
    open.apply(ranges(3, [[1, [0, 2]], [1, [2, 4]], [5, [0, 1]], [0, [3, 1]]]));
    expect(open.diagnostics.map((d) => d.code)).toEqual(['range_out_of_text', 'range_out_of_text']);
    expect(speechOf(open.conv).map((s) => s.range)).toEqual([undefined, [2, 4]]);
  });

  it('reports a negative or fractional index; only an entry a clear dropped goes silently', () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } });
    apply(ranges(1, [[-1, [0, 5]]]));
    expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);

    conv.clear(); // the adapter's entry 0 is gone
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(10) } }); // the adapter's entry 1
    diagnostics.length = 0;
    apply(ranges(1, [[0, [0, 5]], [-1, [0, 5]], [0.5, [0, 5]], [1, [6, 11]]]));
    expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text', 'range_out_of_text']);
    expect(speechOf(conv).map((s) => s.range)).toEqual([[6, 11]]);
  });
});

describe('Conversation — retention and clear', () => {
  it('keeps the range but no pcm when keepPcm is off', () => {
    const { conv, apply } = make({ retention: { keepPcm: false, maxPcmBytes: 1 << 20 } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'abc' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 3], pcm: pcm(240) } });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 3], pcm: new Int16Array(0) }]);
  });

  it('drops the oldest pcm past the byte ceiling, text and ranges intact', () => {
    const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 1000 } });
    for (const ref of [1, 2, 3]) {
      apply({ kind: 'segmentOpened', payload: { ref, side: 'translation' } }, { kind: 'segmentText', payload: { ref, text: 'abc' } });
      apply({ kind: 'audio', payload: { ref, range: [0, 3], pcm: pcm(200) } }); // 400 bytes each
    }
    const speech = conv.snapshot().segments.map((s) => s.speech[0]);
    expect(speech.map((s) => s.pcm.length)).toEqual([0, 200, 200]);
    expect(speech.map((s) => s.range)).toEqual([[0, 3], [0, 3], [0, 3]]);
  });

  it('clear() drops closed segments, notices and audio, and keeps open segments open with empty text', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'done' } }, { kind: 'segmentClosed', payload: { ref: 1 } });
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 2, text: 'live' } }, { kind: 'audio', payload: { ref: 2, pcm: pcm(10) } });
    // degraded, not failed: failed finalizes every open segment, and this test wants segment 2 to stay open.
    apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'x' } });
    conv.clear();
    const leg = conv.snapshot();
    expect(leg.notices).toEqual([]);
    expect(leg.segments.map((s) => [s.ref, s.text, s.final, s.speech.length])).toEqual([[2, '', false, 0]]);
    apply({ kind: 'segmentText', payload: { ref: 2, text: 'still live' } });
    expect(conv.snapshot().segments[0].text).toBe('still live');
  });

  it('trims pcm held for refs that have not opened when it pushes the leg over the ceiling, keeping their entries (Gemini/AST2 follow-up, choice 6)', () => {
    const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 1000 } });
    apply({ kind: 'audio', payload: { ref: 9, pcm: pcm(300) } });   // 600 bytes, pending
    apply({ kind: 'audio', payload: { ref: 10, pcm: pcm(300) } });  // 1200 total: ref 9's pcm is dropped
    apply({ kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } }, { kind: 'segmentOpened', payload: { ref: 10, side: 'translation' } });
    expect(conv.snapshot().segments.map((s) => s.speech.map((x) => x.pcm.length))).toEqual([[0], [300]]);
  });

  it('a range stated after the ceiling dropped a held clip\'s pcm still lands on its entry, unsaid', () => {
    const { conv, apply, diagnostics } = make({ retention: { keepPcm: true, maxPcmBytes: 1000 } });
    apply({ kind: 'audio', payload: { ref: 9, pcm: pcm(300) } });
    apply({ kind: 'audio', payload: { ref: 10, pcm: pcm(300) } });
    apply({ kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 9, text: 'Hello.' } }, { kind: 'segmentClosed', payload: { ref: 9 } });
    apply({ kind: 'speechRanges', payload: { ref: 9, ranges: [{ index: 0, range: [0, 6] }] } });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 6], pcm: new Int16Array(0) }]);
    expect(diagnostics).toEqual([]);
  });

  it('a range stated for the second of two held clips lands on it, after the ceiling dropped only the first\'s pcm (Gemini/AST2 follow-up, choice 6)', () => {
    const { conv, apply, diagnostics } = make({ retention: { keepPcm: true, maxPcmBytes: 400 } });
    apply({ kind: 'audio', payload: { ref: 9, pcm: pcm(100) } });   // 200 bytes, held, index 0
    apply({ kind: 'audio', payload: { ref: 10, pcm: pcm(150) } });  // 500 total: over the ceiling, ref 9's pcm is dropped, its entry kept
    apply({ kind: 'audio', payload: { ref: 9, pcm: pcm(50) } });    // a second held clip for ref 9, index 1 — 400 total, at the ceiling: kept
    apply({ kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } });
    apply({ kind: 'speechRanges', payload: { ref: 9, ranges: [{ index: 1, range: [0, 6] }] } });
    expect(conv.snapshot().segments[0].speech).toEqual([
      { range: undefined, pcm: new Int16Array(0) },
      { range: [0, 6], pcm: pcm(50) },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it('drops pcm held for a ref that never opened when the leg closes', () => {
    const { conv, apply } = make();
    apply({ kind: 'audio', payload: { ref: 9, pcm: pcm(10) } });
    apply({ kind: 'closed', payload: { reason: 'server' } });
    apply({ kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } });
    expect(conv.snapshot().segments[0].speech).toEqual([]);
  });

  it('trims retained pcm from where it last stopped, not from the first segment', () => {
    // A conversation over its pcm ceiling: many segments, each chunk trims the oldest pcm once.
    const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 4_800 * 2 } });
    for (let i = 1; i <= 50; i++) {
      apply({ kind: 'segmentOpened', payload: { ref: i, side: 'translation' } }, { kind: 'segmentText', payload: { ref: i, text: 'x' } });
      apply({ kind: 'audio', payload: { ref: i, pcm: pcm(2_400) } });
    }
    const kept = conv.snapshot().segments.flatMap((s) => s.speech).filter((s) => s.pcm.length > 0);
    expect(kept).toHaveLength(2);
  });

  it('keeps trimming an open segment that the cursor already drained once it regains pcm, including after setRetention lowers the ceiling', () => {
    // LocalInference sends several audio clips to one open translation segment before it
    // closes (one per sentence): a segment the cursor has already passed can still grow.
    const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 400 } });
    const total = () => conv.snapshot().segments.flatMap((s) => s.speech).reduce((n, s) => n + s.pcm.byteLength, 0);
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(200) } }); // 400, at the ceiling
    apply({ kind: 'audio', payload: { ref: 2, pcm: pcm(200) } }); // 800: drains ref1's chunk; ref1 stays open
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(200) } }); // ref1 regains pcm: drains ref2's chunk in turn
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(200) } }); // ref1 regains pcm again: must still be trimmable
    expect(total()).toBeLessThanOrEqual(400);
    conv.setRetention({ keepPcm: true, maxPcmBytes: 200 });
    expect(total()).toBeLessThanOrEqual(200);
  });

  it('pulls the cursor back to a closed, already-retired segment that regains pcm after close', () => {
    // The spec allows local speech to arrive after a segment closes, so a
    // segment the cursor retired (final and drained) is not done for good.
    const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 0 } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } }); // final; no pcm yet
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(200) } }); // over the (zero) ceiling: drained and retired at once
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(200) } }); // regains pcm after being retired
    const total = conv.snapshot().segments.flatMap((s) => s.speech).reduce((n, s) => n + s.pcm.byteLength, 0);
    expect(total).toBe(0);
  });

  it('enforces the ceiling when a segment opens with held pcm', () => {
    const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 1000 } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'audio', payload: { ref: 1, pcm: pcm(300) } }); // 600
    apply({ kind: 'audio', payload: { ref: 2, pcm: pcm(300) } }); // pending, 1200 total: the oldest (segment 1) is trimmed
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } });
    expect(conv.snapshot().segments.map((s) => s.speech[0].pcm.length)).toEqual([0, 300]);
  });
});

describe('Conversation — what the runner adds', () => {
  it('records a notice raised outside the adapter, with its code and params', () => {
    const { conv, clock } = make();
    clock.advance(250);
    conv.notice({ severity: 'error', message: 'microphone unplugged', code: 'source_ended', params: { leg: 'speaker' } });
    expect(conv.snapshot().notices).toEqual([
      { id: 's1:speaker:n1', at: 10_250, severity: 'error', message: 'microphone unplugged', code: 'source_ended', params: { leg: 'speaker' } },
    ]);
  });

  it('drops a degraded notice that repeats its code within the dedupe window, and keeps other codes', () => {
    const { conv, clock, apply } = make();
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
    clock.advance(DEGRADED_DEDUPE_MS - 1);
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
    apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'no voice' } });
    clock.advance(1);
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
    expect(conv.snapshot().notices.map((n) => n.code)).toEqual(['parse_error', 'tts_degraded', 'parse_error']);
  });

  it('turning pcm retention off drops the pcm already held and keeps the ranges', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'abc' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 3], pcm: pcm(240) } });
    apply({ kind: 'audio', payload: { ref: 2, range: [0, 1], pcm: pcm(10) } });
    conv.setRetention({ keepPcm: false, maxPcmBytes: 0 });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 3], pcm: new Int16Array(0) }]);
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 1], pcm: pcm(10) } });
    expect(conv.snapshot().segments[0].speech[1].pcm.length).toBe(0);
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } });
    expect(conv.snapshot().segments[1].speech).toEqual([{ range: [0, 1], pcm: new Int16Array(0) }]);
  });

  it('lowering the ceiling trims the oldest pcm at once', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'a' } });
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 2, text: 'b' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(100) } }, { kind: 'audio', payload: { ref: 2, pcm: pcm(100) } });
    conv.setRetention({ keepPcm: true, maxPcmBytes: 200 });
    const [a, b] = conv.snapshot().segments;
    expect(a.speech[0].pcm.length).toBe(0);
    expect(b.speech[0].pcm.length).toBe(100);
  });

  it('a subscriber that throws is reported and does not stop the next one hearing', () => {
    const { conv, apply, diagnostics } = make();
    let heard = 0;
    conv.subscribe(() => { throw new Error('boom'); });
    conv.subscribe(() => { heard++; });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    expect(heard).toBe(1);
    expect(diagnostics).toEqual([{ code: 'listener_threw', message: 'A conversation subscriber threw: boom' }]);
  });
});

describe('Conversation — a degradation from outside the adapter', () => {
  it('records it as a warning with its code, throttled per code like an adapter degradation', () => {
    const { conv, clock } = make();
    conv.degraded('app_capture_lost_using_system_audio', 'widened to system audio');
    conv.degraded('app_capture_lost_using_system_audio', 'widened again');
    conv.degraded('silent_no_permission', 'nothing heard');
    clock.advance(DEGRADED_DEDUPE_MS);
    conv.degraded('app_capture_lost_using_system_audio', 'widened a third time');
    expect(conv.snapshot().notices.map((n) => [n.severity, n.code, n.message])).toEqual([
      ['warning', 'app_capture_lost_using_system_audio', 'widened to system audio'],
      ['warning', 'silent_no_permission', 'nothing heard'],
      ['warning', 'app_capture_lost_using_system_audio', 'widened a third time'],
    ]);
  });
});

describe('Conversation — every notice is redacted', () => {
  const secret = 'upload failed: https://x/y?key=AIzaSyA-secret';

  it("redacts an adapter's degraded notice", () => {
    const { conv, apply } = make();
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: secret } });
    const notice = conv.snapshot().notices[0];
    expect(notice.message).toContain('[REDACTED]');
    expect(notice.message).not.toContain('AIzaSyA-secret');
  });

  it("redacts an adapter's failed notice", () => {
    const { conv, apply } = make();
    apply({ kind: 'failed', payload: { message: secret } });
    const notice = conv.snapshot().notices[0];
    expect(notice.message).toContain('[REDACTED]');
    expect(notice.message).not.toContain('AIzaSyA-secret');
  });

  it('redacts a notice raised outside the adapter, via notice()', () => {
    const { conv } = make();
    conv.notice({ severity: 'error', message: secret, code: 'source_ended' });
    const notice = conv.snapshot().notices[0];
    expect(notice.message).toContain('[REDACTED]');
    expect(notice.message).not.toContain('AIzaSyA-secret');
  });

  it("redacts a source's degradation, via degraded()", () => {
    const { conv } = make();
    conv.degraded('app_capture_lost_using_system_audio', secret);
    const notice = conv.snapshot().notices[0];
    expect(notice.message).toContain('[REDACTED]');
    expect(notice.message).not.toContain('AIzaSyA-secret');
  });

  it('leaves a message with nothing secret unchanged', () => {
    const { conv, apply } = make();
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
    expect(conv.snapshot().notices[0].message).toBe('bad frame');
  });
});

describe('Conversation — person', () => {
  it('records the person given at open; a later defined one replaces it, an absent one keeps it', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source', person: '1.1' } });
    expect(conv.snapshot().segments[0].person).toBe('1.1');
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hi', person: '1.2' } });
    expect(conv.snapshot().segments[0].person).toBe('1.2');
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hi there' } });
    expect(conv.snapshot().segments[0].person).toBe('1.2');
  });

  it('takes a person-only snapshot as a change, with no growth mark', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source', person: '1.1' } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello' } });
    const before = conv.snapshot();
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello', person: '1.2' } });
    const after = conv.snapshot();
    expect(after).not.toBe(before);
    expect(after.segments[0].person).toBe('1.2');
    expect(after.segments[0].marks).toHaveLength(before.segments[0].marks.length);
  });

  it('has no person for a segment the adapter never labelled', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'Hi' } });
    expect(conv.snapshot().segments[0].person).toBeUndefined();
  });
});
