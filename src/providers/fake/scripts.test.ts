import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { driveAdapter } from '../../lib/contract/testing/drive';
import { eventsFrom, type AdapterEvent } from '../../lib/contract/events';
import { Conversation } from '../../lib/conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { createFakeAdapter } from './adapter';
import { reflessStreamScript } from './generate';
import { FAKE_SCRIPT_NAMES, fakeScript, type FakeScriptName } from './scripts';

const auto: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const play = (name: FakeScriptName) => driveAdapter(createFakeAdapter(), { context: auto, config: { script: fakeScript(name) }, credentials: {}, steps: [{ advance: 40_000 }] });

describe('the fake\'s scripts', () => {
  it("offers the nine scripts, and every one plays conformant through the kit's driver", async () => {
    const ALL = ['exchange', 'cjk', 'rewrite', 'long', 'notices', 'refless-stream', 'framed', 'rangeless', 'reconnect'] as const;
    expect(FAKE_SCRIPT_NAMES).toEqual(ALL);
    for (const name of ALL) {
      const result = await play(name);
      expect(result.violations).toEqual([]);
      expect(result.startError).toBeUndefined();
    }
  });

  it('refless-stream: one continuous stream that names no segment, beside text with stated origins and a revision', async () => {
    const result = await play('refless-stream');
    const audioEvents = result.log.filter((e): e is Extract<AdapterEvent, { kind: 'audio' }> => e.kind === 'audio');
    for (const e of audioEvents) {
      expect(e.payload.ref).toBeUndefined();
      expect(e.payload.range).toBeUndefined();
    }
    const totalSamples = audioEvents.reduce((sum, e) => sum + e.payload.pcm.length, 0);
    expect(totalSamples).toBeGreaterThanOrEqual(24_000 * 30);

    const opens = result.log.filter((e): e is Extract<AdapterEvent, { kind: 'segmentOpened' }> => e.kind === 'segmentOpened');
    for (const e of opens) expect(e.payload.origin).toBeDefined();

    // A revision: some translation ref gets a segmentText after its own segmentClosed.
    const closedAt = new Map<number, number>();
    result.log.forEach((e, i) => {
      if (e.kind === 'segmentClosed' && !closedAt.has(e.payload.ref)) closedAt.set(e.payload.ref, i);
    });
    let revised = false;
    result.log.forEach((e, i) => {
      if (e.kind === 'segmentText' && closedAt.has(e.payload.ref) && i > closedAt.get(e.payload.ref)!) revised = true;
    });
    expect(revised).toBe(true);
  });

  it('refless-stream: paced in real time — jitter within 20 ms for 15 s, then a stall every 20 chunks, the chunks behind it arriving with it', () => {
    // Indexed rather than `.at(-1)`: the project's `lib` target predates it.
    const blocks = reflessStreamScript().blocks;
    const steps = blocks[blocks.length - 1].steps;
    let t = 0;
    let prevAt = -Infinity;
    let sawHiccup = false;
    for (const step of steps) {
      if (!('audio' in step)) continue;
      expect(step.at).toBeGreaterThanOrEqual(prevAt);
      prevAt = step.at;
      const lateness = step.at - t;
      if (t < 15_000) {
        expect(lateness).toBeGreaterThanOrEqual(0);
        expect(lateness).toBeLessThanOrEqual(20);
      }
      if (t >= 15_000 && lateness >= 100) sawHiccup = true;
      t += step.audio.ms;
    }
    expect(sawHiccup).toBe(true);
  });

  it('refless-stream: its chunks join without a click', async () => {
    const clock = createVirtualClock();
    const log: AdapterEvent[] = [];
    const events = eventsFrom((e) => log.push(e));
    await createFakeAdapter().start(
      { context: auto, config: { script: fakeScript('refless-stream') }, credentials: {}, clock, signal: new AbortController().signal },
      events,
    );
    clock.advance(31_000);
    const chunks = log.filter((e): e is Extract<AdapterEvent, { kind: 'audio' }> => e.kind === 'audio').map((e) => e.payload.pcm);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const next = chunks[i];
      expect(Math.abs(prev[prev.length - 1] - next[0])).toBeLessThan(1000);
    }
  });

  it('framed: no stated origin, a range on every audio frame, and the projection pairs by timing', async () => {
    const clock = createVirtualClock();
    const conv = new Conversation({ leg: 'speaker', session: 'framed', languages: auto.direction, clock });
    const log: AdapterEvent[] = [];
    const events = eventsFrom((e) => { log.push(e); conv.apply(e); });
    await createFakeAdapter().start(
      { context: auto, config: { script: fakeScript('framed') }, credentials: {}, clock, signal: new AbortController().signal },
      events,
    );
    clock.advance(40_000);

    for (const e of log) {
      if (e.kind === 'segmentOpened') expect(e.payload.origin).toBeUndefined();
      if (e.kind === 'audio') {
        expect(e.payload.ref).toBeDefined();
        expect(e.payload.range).toBeDefined();
      }
    }

    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    const exchanges = entries.filter((e) => e.kind === 'exchange');
    expect(exchanges.length).toBe(3);
    for (const ex of exchanges) { if (ex.kind === 'exchange') expect(ex.pairing).toBe('inferred'); }
  });

  it('rangeless: audio with a segment, never a range; origins stated', async () => {
    const clock = createVirtualClock();
    const conv = new Conversation({ leg: 'speaker', session: 'rangeless', languages: auto.direction, clock });
    const log: AdapterEvent[] = [];
    const events = eventsFrom((e) => { log.push(e); conv.apply(e); });
    await createFakeAdapter().start(
      { context: auto, config: { script: fakeScript('rangeless') }, credentials: {}, clock, signal: new AbortController().signal },
      events,
    );
    clock.advance(20_000);
    for (const e of log) {
      if (e.kind === 'audio') {
        expect(e.payload.ref).toBeDefined();
        expect(e.payload.range).toBeUndefined();
      }
    }
    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    const exchanges = entries.filter((e) => e.kind === 'exchange');
    expect(exchanges.length).toBeGreaterThan(0);
    for (const ex of exchanges) { if (ex.kind === 'exchange') expect(ex.pairing).toBe('stated'); }
  });

  it('reconnect: drops and comes back between two exchanges, refs never reused', async () => {
    const result = await play('reconnect');
    const kinds = result.log.map((e) => e.kind);
    const at = kinds.indexOf('reconnecting');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('reconnected', at)).toBeGreaterThan(at);
    const refs = result.log
      .filter((e): e is Extract<AdapterEvent, { kind: 'segmentOpened' }> => e.kind === 'segmentOpened')
      .map((e) => e.payload.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
});
