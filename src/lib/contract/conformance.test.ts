import { describe, it, expect } from 'vitest';
import { createVirtualClock } from './clock';
import type { SessionContext } from './adapter';
import { checkConformance, recordConformance, type ConformanceLog } from './conformance';
import { createFakeAdapter } from '../../providers/fake/adapter';
import { exchange, type FakeScript } from '../../providers/fake/script';

const auto: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const rules = (log: ConformanceLog, ctx = auto) => checkConformance(log, ctx).map((v) => v.rule);

describe('checkConformance on the fake', () => {
  it('passes a clean exchange', async () => {
    const clock = createVirtualClock();
    const { events, log, mark } = recordConformance();
    const script: FakeScript = { blocks: [exchange({ startAt: 0, ref: 1, source: ['a', 'ab'], translation: 'Ab.', audioChunks: 2 })] };
    const session = await createFakeAdapter(clock).start({ context: auto, config: { script }, credentials: {} }, events);
    clock.advance(5000);
    await session.stop();
    mark('stop');
    clock.advance(5000);
    expect(checkConformance(log, auto)).toEqual([]);
  });

  it('passes manual turns and text input', async () => {
    const clock = createVirtualClock();
    const { events, log, mark } = recordConformance();
    const ctx: SessionContext = { ...auto, turns: 'manual' };
    const script: FakeScript = { blocks: [exchange({ startAt: 0, ref: 1, source: ['a'], translation: 'A.' })] };
    const session = await createFakeAdapter(clock).start({ context: ctx, config: { script }, credentials: {} }, events);
    session.beginTurn(); session.cancelTurn(); mark('cancelTurn');
    clock.advance(1000);
    session.beginTurn(); session.endTurn(); mark('endTurn');
    clock.advance(5000);
    mark('appendText', 'typed'); session.appendText('typed');
    expect(checkConformance(log, ctx)).toEqual([]);
  });
});

describe('checkConformance rules', () => {
  const opened = (ref: number, side: 'source' | 'translation' = 'source') => ({ kind: 'segmentOpened' as const, payload: { ref, side } });
  const text = (ref: number, t: string) => ({ kind: 'segmentText' as const, payload: { ref, text: t } });
  const pcm = new Int16Array(240);

  it('flags an event after failed', () => {
    const log: ConformanceLog = [{ kind: 'failed', payload: { message: 'x' } }, opened(1)];
    expect(rules(log)).toContain('ended-silence');
  });

  it('flags an event after the stop marker', () => {
    const log: ConformanceLog = [{ kind: 'marker', payload: 'stop' }, opened(1)];
    expect(rules(log)).toContain('stop-silence');
  });

  it('flags a ref opened twice', () => {
    expect(rules([opened(1), opened(1)])).toContain('ref-opened-once');
  });

  it('flags text for a ref never opened', () => {
    expect(rules([text(7, 'hi')])).toContain('text-before-open');
  });

  it('allows audio before the text of its ref', () => {
    expect(rules([{ kind: 'audio', payload: { ref: 1, pcm } }, opened(1, 'translation'), text(1, 'hi')])).toEqual([]);
  });

  it('flags a range past the text', () => {
    const log: ConformanceLog = [opened(1, 'translation'), text(1, 'hi'), { kind: 'audio', payload: { ref: 1, pcm, range: [0, 5] } }];
    expect(rules(log)).toContain('range-in-text');
  });

  it('flags audio when speech is off', () => {
    const log: ConformanceLog = [opened(1, 'translation'), text(1, 'hi'), { kind: 'audio', payload: { ref: 1, pcm } }];
    expect(rules(log, { ...auto, speech: false })).toContain('no-audio-when-silent');
  });

  it('flags a frame carrying audio, a huge string, or a credential key', () => {
    const big = 'x'.repeat(3000);
    const log: ConformanceLog = [
      { kind: 'frame', payload: { direction: 'out', type: 't', payload: { audio: pcm } } },
      { kind: 'frame', payload: { direction: 'out', type: 't', payload: { data: big } } },
      { kind: 'frame', payload: { direction: 'out', type: 't', payload: { apiKey: 'sk-1' } } },
    ];
    expect(checkConformance(log, auto).filter((v) => v.rule === 'frame-clean')).toHaveLength(3);
  });

  it('flags text input that is not answered with a source then a translation', () => {
    const log: ConformanceLog = [{ kind: 'marker', payload: 'appendText', text: 'hi' }, opened(1, 'translation')];
    expect(rules(log)).toContain('text-input-answered');
  });

  it('accepts a typed text answered after an interleaved speech segment', () => {
    const log: ConformanceLog = [
      { kind: 'marker', payload: 'appendText', text: 'hi' },
      opened(1), text(1, 'spoken words'),
      opened(2), text(2, 'hi'), { kind: 'segmentClosed', payload: { ref: 2 } },
      opened(3, 'translation'), text(3, 'やあ'),
    ];
    expect(rules(log)).toEqual([]);
  });

  it('does not mistake usage token counts in a frame for a credential', () => {
    const log: ConformanceLog = [
      { kind: 'frame', payload: { direction: 'in', type: 'response.done', payload: { usage: { input_tokens: 10, output_tokens: 5 } } } },
    ];
    expect(rules(log)).toEqual([]);
  });

  it('flags the second of two typed texts when only the first is translated', () => {
    const log: ConformanceLog = [
      { kind: 'marker', payload: 'appendText', text: 'A' },
      opened(1), text(1, 'A'),
      { kind: 'marker', payload: 'appendText', text: 'B' },
      opened(2), text(2, 'B'),
      opened(3, 'translation'), text(3, 'a'),
    ];
    const v = checkConformance(log, auto).filter((x) => x.rule === 'text-input-answered');
    expect(v.map((x) => x.index)).toEqual([3]);
  });
});
