import { describe, it, expect, vi } from 'vitest';
import type { AdapterSession, SessionContext } from '../adapter';
import type { ConformanceLog, Marker } from '../conformance';
import { createFakeAdapter } from '../../../providers/fake/adapter';
import { exchange, type FakeScript } from '../../../providers/fake/script';
import { driveAdapter, type ScenarioHandles } from './drive';
import { createBrokenAdapter } from './examples';

const auto: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const script: FakeScript = {
  blocks: [exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello there.'], translation: 'こんにちは。', origin: 'x1', audioChunks: 2 })],
};

describe('driveAdapter', () => {
  it('starts on a virtual clock, plays the steps, stops the session and checks the log', async () => {
    const r = await driveAdapter(createFakeAdapter(), { context: auto, config: { script }, credentials: {}, steps: [{ advance: 5000 }] });
    expect(r.violations).toEqual([]);
    expect(r.startOutcome).toBe('resolved');
    expect(r.startError).toBeUndefined();
    expect(r.log.some((e) => e.kind === 'segmentOpened')).toBe(true);
    expect(r.log[r.log.length - 1]).toEqual({ kind: 'marker', payload: 'stop' });
  });

  it('marks what the caller did in the log: typed text, the ends of turns, and stop', async () => {
    const r = await driveAdapter(createFakeAdapter(), {
      context: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'manual' },
      config: { script },
      credentials: {},
      steps: [{ text: 'hi' }, { turn: 'begin' }, { turn: 'end' }, { turn: 'cancel' }],
    });
    // A `begin` marks nothing. Conformance reads only the `appendText` and
    // `stop` markers; `endTurn` and `cancelTurn` are recorded for a reader of
    // the log, and no rule checks what a turn did.
    expect(r.log.filter((e): e is Marker => e.kind === 'marker')).toEqual([
      { kind: 'marker', payload: 'appendText', text: 'hi' },
      { kind: 'marker', payload: 'endTurn' },
      { kind: 'marker', payload: 'cancelTurn' },
      { kind: 'marker', payload: 'stop' },
    ]);
  });

  it('runs the clock on past the end, so an emission after stop is a violation', async () => {
    // The broken adapter's stop() schedules a segmentOpened on request.clock 100 ms later.
    const r = await driveAdapter(createBrokenAdapter(), { context: auto, config: {}, credentials: {} });
    expect(r.violations.map((v) => v.rule)).toContain('stop-silence');
  });

  it('reports a start that never settles instead of hanging', async () => {
    const r = await driveAdapter({ start: () => new Promise<AdapterSession>(() => {}) }, { context: auto, config: {}, credentials: {} });
    expect(r.session).toBeNull();
    expect(r.startOutcome).toBe('hung');
    expect(r.startError).toBeInstanceOf(Error);
    expect((r.startError as Error).message).toBe('start neither resolved nor rejected after the opening steps');
  });

  it('skips the steps when start rejects, and returns why', async () => {
    const spy = vi.fn();
    const r = await driveAdapter(
      { start: () => Promise.reject(new Error('nope')) },
      { context: auto, config: {}, credentials: {}, steps: [{ run: spy }] },
    );
    expect(spy).not.toHaveBeenCalled();
    expect(r.startOutcome).toBe('rejected');
    expect((r.startError as Error).message).toBe('nope');
  });

  it('turns a start that throws synchronously into its startError, instead of rejecting', async () => {
    const r = await driveAdapter(
      { start: () => { throw new Error('sync'); } },
      { context: auto, config: {}, credentials: {} },
    );
    expect(r.startOutcome).toBe('rejected');
    expect((r.startError as Error).message).toBe('sync');
    expect(r.session).toBeNull();
  });

  it('hands a run step the session, the clock and the log', async () => {
    const seen: Array<{ session: AdapterSession | null; now: number; log: ConformanceLog }> = [];
    const spy = vi.fn((h: ScenarioHandles) => {
      seen.push({ session: h.session, now: h.clock.now(), log: h.log });
    });
    const r = await driveAdapter(createFakeAdapter(), { context: auto, config: { script }, credentials: {}, steps: [{ advance: 700 }, { run: spy }] });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(seen[0].session).not.toBeNull();
    expect(seen[0].now).toBe(700);
    expect(seen[0].log).toBe(r.log);
  });

  it("an abort while opening reaches the adapter's signal", async () => {
    const r = await driveAdapter(createFakeAdapter(), {
      context: auto,
      config: { script, faults: { startDelayMs: 1000 } },
      credentials: {},
      opening: [{ abort: true }, { flush: true }],
    });
    expect(r.startOutcome).toBe('rejected');
    expect((r.startError as Error).message).toBe('the scenario cancelled the start');
    expect(r.session).toBeNull();
  });
});
