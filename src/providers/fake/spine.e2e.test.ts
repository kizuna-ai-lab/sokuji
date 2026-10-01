import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { eventsFrom } from '../../lib/contract/events';
import { checkConformance, type ConformanceLog } from '../../lib/contract/conformance';
import { Conversation } from '../../lib/conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { renderTranscriptTxt } from '../../lib/export/transcript';
import { createFakeAdapter } from './adapter';
import { exchange } from './script';
import { longScript } from './generate';

const context = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' as const };
const options = {
  labels: { me: 'Me', other: 'Other', noTranslation: '(no translation)', noSource: '(no source)' },
  formatTime: (ms: number) => `[${ms}]`,
};

describe('the spine on the fake', () => {
  it('turns a two-exchange script into two paired entries and a transcript', async () => {
    const clock = createVirtualClock();
    const conv = new Conversation({ leg: 'speaker', session: 'e2e', languages: context.direction, clock, punctuate: async (_l, t) => `${t}。` });
    const log: ConformanceLog = [];
    const events = eventsFrom((e) => { log.push(e); conv.apply(e); });
    const script = { blocks: [
      exchange({ startAt: 0, ref: 1, source: ['今日は', '今日は天気がいい'], translation: 'The weather is nice.', origin: 'u1', audioChunks: 2 }),
      exchange({ startAt: 3000, ref: 3, source: ['公園に'], translation: 'To the park.', origin: 'u2' }),
    ] };
    const session = await createFakeAdapter().start({ context, config: { script }, credentials: {}, clock, signal: new AbortController().signal }, events);
    clock.advance(10_000);
    await session.stop();
    await conv.settled();
    expect(checkConformance(log, context)).toEqual([]);

    const leg = conv.snapshot();
    expect(leg.segments.map((s) => [s.side, s.final, s.text])).toEqual([
      ['source', true, '今日は天気がいい。'],
      ['translation', true, 'The weather is nice.'],
      ['source', true, '公園に。'],
      ['translation', true, 'To the park.'],
    ]);
    expect(leg.segments[1].speech.map((s) => s.range)).toEqual([[0, 10], [10, 20]]);

    const entries = createProjector().project([leg], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    expect(entries.map((e) => e.kind === 'exchange' && e.pairing)).toEqual(['stated', 'stated']);
    expect(renderTranscriptTxt(entries, [leg], options)).toBe([
      '[0] Me', '  今日は天気がいい。', '  → The weather is nice.', '',
      '[3000] Me', '  公園に。', '  → To the park.', '',
    ].join('\n'));
  });

  it('projects a long session incrementally: one new exchange changes one entry', async () => {
    const clock = createVirtualClock();
    const conv = new Conversation({ leg: 'speaker', session: 'long', languages: context.direction, clock, retention: { keepPcm: false, maxPcmBytes: 0 } });
    const events = eventsFrom((e) => conv.apply(e));
    const session = await createFakeAdapter().start({ context, config: { script: longScript(2000, 3000) }, credentials: {}, clock, signal: new AbortController().signal }, events);
    const projector = createProjector();
    clock.advance(1999 * 3000 + 500);
    const before = projector.project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    expect(before.length).toBe(2000);
    clock.advance(10_000);
    await session.stop();
    const after = projector.project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    expect(after.length).toBe(2000);
    let changed = 0;
    for (let i = 0; i < 1999; i++) if (after[i] !== before[i]) changed++;
    expect(changed).toBe(0);
    expect(after[1999]).not.toBe(before[1999]);
  });

  it('keeps earlier entries while retention trims their audio', async () => {
    const clock = createVirtualClock();
    const conv = new Conversation({ leg: 'speaker', session: 'trim', languages: context.direction, clock, retention: { keepPcm: true, maxPcmBytes: 300_000 } });
    const events = eventsFrom((e) => conv.apply(e));
    const session = await createFakeAdapter().start({ context, config: { script: longScript(100, 3000) }, credentials: {}, clock, signal: new AbortController().signal }, events);
    const projector = createProjector();
    const settings = { ...DEFAULT_PROJECTION, mode: 'sentences' as const, sentencesPerRow: 1 };
    clock.advance(99 * 3000 + 500);
    const before = projector.project([conv.snapshot()], settings);
    clock.advance(10_000);
    await session.stop();
    const after = projector.project([conv.snapshot()], settings);
    expect(after.length).toBe(100);
    for (let i = 0; i < 99; i++) expect(after[i]).toBe(before[i]);
    expect(after[99]).not.toBe(before[99]);
  });
});
