import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import type { AdapterEvent } from '../contract/events';
import { Conversation, MARK_COMPACT_MS, type ConversationDiagnostic } from './Conversation';

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

  it('drops a range outside the text, keeps the pcm, and reports it once', () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'abc' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 9], pcm: pcm(240) } });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: undefined, pcm: pcm(240) }]);
    expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);
  });
});

describe('Conversation — notices and closing', () => {
  it('turns failed into an error notice and degraded into a notice with the table\'s severity', () => {
    const { conv, apply } = make();
    apply({ kind: 'failed', payload: { message: 'socket died', code: 'E1' } });
    apply({ kind: 'degraded', payload: { code: 'input_pipeline_failed', message: 'mic gone' } });
    apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'no voice' } });
    expect(conv.snapshot().notices.map((n) => [n.severity, n.message, n.code])).toEqual([
      ['error', 'socket died', 'E1'],
      ['error', 'mic gone', 'input_pipeline_failed'],
      ['warning', 'no voice', 'tts_degraded'],
    ]);
    expect(conv.snapshot().notices[0].id).toBe('s1:speaker:n1');
  });

  it('finalizes every open segment on failed, since nothing follows it', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    apply({ kind: 'failed', payload: { message: 'socket died' } });
    expect(conv.snapshot().segments[0].final).toBe(true);
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

  it('trims pcm held for refs that have not opened when it pushes the leg over the ceiling', () => {
    const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 1000 } });
    apply({ kind: 'audio', payload: { ref: 9, pcm: pcm(300) } });   // 600 bytes, pending
    apply({ kind: 'audio', payload: { ref: 10, pcm: pcm(300) } });  // 1200 total: ref 9 is dropped
    apply({ kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } }, { kind: 'segmentOpened', payload: { ref: 10, side: 'translation' } });
    expect(conv.snapshot().segments.map((s) => s.speech.length)).toEqual([0, 1]);
  });

  it('drops pcm held for a ref that never opened when the leg closes', () => {
    const { conv, apply } = make();
    apply({ kind: 'audio', payload: { ref: 9, pcm: pcm(10) } });
    apply({ kind: 'closed', payload: { reason: 'server' } });
    apply({ kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } });
    expect(conv.snapshot().segments[0].speech).toEqual([]);
  });

  it('enforces the ceiling when a segment opens with held pcm', () => {
    const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 1000 } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'audio', payload: { ref: 1, pcm: pcm(300) } }); // 600
    apply({ kind: 'audio', payload: { ref: 2, pcm: pcm(300) } }); // pending, 1200 total: the oldest (segment 1) is trimmed
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } });
    expect(conv.snapshot().segments.map((s) => s.speech[0].pcm.length)).toEqual([0, 300]);
  });
});
