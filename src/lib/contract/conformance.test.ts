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
    const session = await createFakeAdapter().start({ context: auto, config: { script }, credentials: {}, clock, signal: new AbortController().signal }, events);
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
    const session = await createFakeAdapter().start({ context: ctx, config: { script }, credentials: {}, clock, signal: new AbortController().signal }, events);
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
  const closed = (ref: number) => ({ kind: 'segmentClosed' as const, payload: { ref } });
  const pcm = new Int16Array(240);
  const audio = (ref: number, range: [number, number] | undefined, p: Int16Array = pcm) => ({ kind: 'audio' as const, payload: { ref, range, pcm: p } });
  const frame = (direction: 'in' | 'out', type: string, payload?: unknown) => ({ kind: 'frame' as const, payload: { direction, type, payload } });

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

  it('flags a range past the text once the segment closes', () => {
    const log: ConformanceLog = [opened(1, 'translation'), text(1, 'hi'), { kind: 'audio', payload: { ref: 1, pcm, range: [0, 5] } }, closed(1)];
    expect(rules(log)).toContain('range-in-text');
  });

  it('flags a range past the text on a still-open ref when the session ends', () => {
    const log: ConformanceLog = [opened(1, 'translation'), text(1, 'hi'), { kind: 'audio', payload: { ref: 1, pcm, range: [0, 5] } }, { kind: 'failed', payload: { message: 'x' } }];
    expect(rules(log)).toContain('range-in-text');
  });

  it('flags a range past the text on a ref still open when the log ends without failed or closed', () => {
    const log: ConformanceLog = [opened(1, 'translation'), text(1, 'hi'), { kind: 'audio', payload: { ref: 1, pcm, range: [0, 5] } }, { kind: 'marker', payload: 'stop' }];
    expect(checkConformance(log, auto)).toEqual([expect.objectContaining({ rule: 'range-in-text', index: 2 })]);
  });

  it('flags a close for a ref that never opened', () => {
    expect(rules([closed(9)])).toContain('close-unopened');
  });

  it('flags audio on a source-side ref', () => {
    expect(rules([opened(1, 'source'), audio(1, undefined)])).toContain('audio-on-source');
  });

  it('flags a frame type not shaped domain.event', () => {
    expect(rules([frame('in', 'message')])).toContain('frame-type');
  });

  it('flags a credential-shaped value in a frame payload', () => {
    const log: ConformanceLog = [frame('out', 'local.init', { url: 'https://x/?key=AIzaSyA-FAKE-KEY-0123456789abcdefghij' })];
    expect(rules(log)).toContain('frame-secret');
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

  it('accepts a typed text answered by its exact source segment alone in a session that says translation_unavailable', () => {
    const log: ConformanceLog = [
      { kind: 'degraded', payload: { code: 'translation_unavailable', message: 'transcription only' } },
      { kind: 'marker', payload: 'appendText', text: 'hi' },
      opened(1), text(1, 'hi'), closed(1),
      { kind: 'marker', payload: 'appendText', text: 'there' },
      opened(2), text(2, 'there'), closed(2),
    ];
    expect(checkConformance(log, auto)).toEqual([]);
  });

  it('still flags a typed text answered by its source segment alone when the session never says translation_unavailable', () => {
    const log: ConformanceLog = [
      { kind: 'marker', payload: 'appendText', text: 'hi' },
      opened(1), text(1, 'hi'), closed(1),
    ];
    expect(rules(log)).toEqual(['text-input-answered']);
  });

  it('does not let translation_unavailable answer a typed text with no exact source segment', () => {
    const log: ConformanceLog = [
      { kind: 'marker', payload: 'appendText', text: 'hi' },
      opened(1), text(1, 'hi there'), closed(1),
      { kind: 'degraded', payload: { code: 'translation_unavailable', message: 'transcription only' } },
    ];
    expect(rules(log)).toEqual(['text-input-answered']);
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
