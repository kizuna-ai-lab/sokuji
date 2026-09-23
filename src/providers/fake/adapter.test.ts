import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import type { SessionContext } from '../../lib/contract/adapter';
import { createFakeAdapter, type FakeConfig } from './adapter';
import { longScript } from './generate';
import { exchange, type FakeScript } from './script';
import { synthPcm, msForText } from './synth';

const auto: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const kinds = (log: AdapterEvent[]) => log.map((e) => e.kind);

async function start(script: FakeScript, context = auto, faults?: FakeConfig['faults']) {
  const clock = createVirtualClock();
  const { events, log } = recordEvents();
  const session = await createFakeAdapter().start(
    { context, config: { script, faults }, credentials: {}, clock, signal: new AbortController().signal },
    events,
  );
  return { clock, log, session };
}

describe('synth', () => {
  it('makes 24 kHz pcm of the requested length', () => {
    expect(synthPcm(100).length).toBe(2400);
    expect(synthPcm(100)).toBeInstanceOf(Int16Array);
  });
  it('sizes audio to the text with a floor', () => {
    expect(msForText('')).toBe(200);
    expect(msForText('こんにちは')).toBe(300);
  });
});

describe('exchange', () => {
  it('builds source partials, a close, a translation with audio, and a close', () => {
    const block = exchange({ startAt: 0, ref: 1, source: ['今日は', '今日は天気が'], translation: 'The weather is nice.' });
    expect(block.steps.map((s) => Object.keys(s).find((k) => k !== 'at'))).toEqual([
      'open', 'text', 'text', 'close', 'open', 'text', 'audio', 'close',
    ]);
  });
});

describe('createFakeAdapter', () => {
  it('plays blocks at their start time under automatic turns', async () => {
    const script: FakeScript = { blocks: [
      exchange({ startAt: 100, ref: 1, source: ['a'], translation: 'A.' }),
      exchange({ startAt: 1000, ref: 3, source: ['b'], translation: 'B.' }),
    ] };
    const { clock, log } = await start(script);
    expect(log).toEqual([]);
    // Block 1 spans 100..700 (partial 200 ms apart, 200 ms of audio); block 2 starts at 1000.
    clock.advance(800);
    expect(kinds(log)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed', 'segmentOpened', 'segmentText', 'audio', 'segmentClosed']);
    clock.advance(1000);
    expect(log.length).toBe(14);
  });

  it('emits no audio when the context has speech off', async () => {
    const script: FakeScript = { blocks: [exchange({ startAt: 0, ref: 1, source: ['a'], translation: 'A.' })] };
    const { clock, log } = await start(script, { ...auto, speech: false });
    clock.advance(1000);
    expect(kinds(log)).not.toContain('audio');
  });

  it('holds blocks under manual turns until endTurn, and cancelTurn releases nothing', async () => {
    const script: FakeScript = { blocks: [exchange({ startAt: 0, ref: 1, source: ['a'], translation: 'A.' })] };
    const { clock, log, session } = await start(script, { ...auto, turns: 'manual' });
    clock.advance(5000);
    expect(log).toEqual([]);
    session.beginTurn();
    session.cancelTurn();
    clock.advance(5000);
    expect(log).toEqual([]);
    session.beginTurn();
    session.endTurn();
    clock.advance(5000);
    expect(kinds(log)[0]).toBe('segmentOpened');
  });

  it('answers appendText with a source segment and then a translation', async () => {
    const { log, session } = await start({ blocks: [] });
    session.appendText('hello');
    expect(kinds(log)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed', 'segmentOpened', 'segmentText', 'audio', 'segmentClosed']);
    expect(log[0]).toEqual({ kind: 'segmentOpened', payload: { ref: 1000, side: 'source', origin: 'text-1000' } });
    expect(log[4]).toEqual({ kind: 'segmentText', payload: { ref: 1001, text: '«hello»' } });
  });

  it('starts typed-text refs past every ref the script names', async () => {
    const { log, session } = await start(longScript(600));
    session.appendText('x');
    expect(log[0]).toEqual({ kind: 'segmentOpened', payload: { ref: 1201, side: 'source', origin: 'text-1201' } });
  });

  it('emits nothing after stop()', async () => {
    const script: FakeScript = { blocks: [exchange({ startAt: 100, ref: 1, source: ['a'], translation: 'A.' })] };
    const { clock, log, session } = await start(script);
    await session.stop();
    clock.advance(1000);
    expect(log).toEqual([]);
  });

  it('fails after the configured time and then stays silent', async () => {
    const script: FakeScript = { blocks: [exchange({ startAt: 500, ref: 1, source: ['a'], translation: 'A.' })] };
    const { clock, log } = await start(script, auto, { failAfterMs: 100, failMessage: 'boom' });
    clock.advance(1000);
    expect(log).toEqual([{ kind: 'failed', payload: { message: 'boom' } }]);
  });

  it('throws from start() when told to', async () => {
    const clock = createVirtualClock();
    const { events } = recordEvents();
    await expect(createFakeAdapter().start(
      { context: auto, config: { script: { blocks: [] }, faults: { startThrows: 'no network' } }, credentials: {}, clock, signal: new AbortController().signal },
      events,
    )).rejects.toThrow('no network');
  });

  it('waits the configured start delay on the request clock', async () => {
    const clock = createVirtualClock();
    const { events } = recordEvents();
    let done = false;
    const started = createFakeAdapter().start({ context: auto, config: { script: { blocks: [] }, faults: { startDelayMs: 500 } }, credentials: {}, clock, signal: new AbortController().signal }, events).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    clock.advance(500);
    await started;
    expect(done).toBe(true);
  });

  it('rejects a start aborted during its delay, and one aborted before it began', async () => {
    const clock = createVirtualClock();
    const { events } = recordEvents();
    const ac = new AbortController();
    const started = createFakeAdapter().start({ context: auto, config: { script: { blocks: [] }, faults: { startDelayMs: 500 } }, credentials: {}, clock, signal: ac.signal }, events);
    ac.abort(new Error('cancelled'));
    await expect(started).rejects.toThrow('cancelled');
    await expect(createFakeAdapter().start({ context: auto, config: { script: { blocks: [] } }, credentials: {}, clock, signal: ac.signal }, events)).rejects.toThrow('cancelled');
  });
});
