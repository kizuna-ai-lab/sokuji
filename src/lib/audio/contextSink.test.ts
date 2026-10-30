import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { createContextSink } from './contextSink';
import { FakeAudioContext, reaches } from './fakeWebAudio';
import { MAX_REBUILDS, RESUME_DEADLINE_MS, WEDGE_GRACE_MS } from './graph';

const reportWarningSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/report')>();
  return { ...actual, reportWarning: reportWarningSpy };
});

const withKey = (key: string) =>
  reportWarningSpy.mock.calls.filter(([, , options]) => (options as { dedupeKey?: string } | undefined)?.dedupeKey === key);

beforeEach(() => { reportWarningSpy.mockClear(); });

const fakeStream = (id: string) => ({ id }) as unknown as MediaStream;
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

interface SetupOptions {
  state?: AudioContextState;
  prepare?: (ctx: FakeAudioContext, index: number) => void;
}

function setup({ state, prepare }: SetupOptions = {}) {
  const contexts: FakeAudioContext[] = [];
  const clock = createVirtualClock();
  const sink = createContextSink(fakeStream('a'), {
    label: 'them',
    clock,
    createContext: () => {
      const ctx = new FakeAudioContext(state);
      prepare?.(ctx, contexts.length);
      contexts.push(ctx);
      return ctx.asContext();
    },
  });
  /** Whether `ctx` currently plays the stream `id`. */
  const plays = (ctx: FakeAudioContext, id: string) =>
    ctx.streamSources.some((s) => (s.mediaStream as unknown as { id: string }).id === id && reaches(s, ctx.destination));
  return { sink, contexts, clock, plays };
}

describe('createContextSink', () => {
  it('plays the stream through its context', () => {
    const { contexts, plays } = setup();
    expect(contexts).toHaveLength(1);
    expect(plays(contexts[0], 'a')).toBe(true);
  });

  it('is paused until its context runs, and a refused start works on a later play()', async () => {
    const { sink, contexts, clock } = setup({ state: 'suspended', prepare: (ctx) => { ctx.stuck = true; } });
    expect(sink.paused).toBe(true);
    const refused = sink.play();
    clock.advance(RESUME_DEADLINE_MS);
    await refused;
    contexts[0].stuck = false;
    await sink.play();
    expect(sink.paused).toBe(false);
    expect(contexts[0].resumed).toBe(2);
  });

  it('play() settles though resume() never does', async () => {
    const { sink, clock } = setup({ state: 'suspended', prepare: (ctx) => { ctx.stuck = true; } });
    const started = sink.play();
    clock.advance(RESUME_DEADLINE_MS);
    await expect(started).resolves.toBeUndefined();
  });

  it('a new stream replaces the old one on the same context', () => {
    const { sink, contexts, plays } = setup();
    sink.srcObject = fakeStream('b');
    expect(contexts).toHaveLength(1);
    expect(plays(contexts[0], 'a')).toBe(false);
    expect(plays(contexts[0], 'b')).toBe(true);
    expect((sink.srcObject as unknown as { id: string }).id).toBe('b');
  });

  it('null closes the context, once', () => {
    const { sink, contexts } = setup();
    sink.srcObject = null;
    sink.srcObject = null;
    expect(contexts[0].closed).toBe(1);
    expect(sink.srcObject).toBeNull();
  });
});

describe('createContextSink — switching device', () => {
  it('opens a new context on the device, moves the stream, then closes the old one', async () => {
    const { sink, contexts, plays } = setup();
    await sink.setSinkId!('usb');
    expect(contexts).toHaveLength(2);
    expect(contexts[1].sinkIds).toEqual(['usb']);
    expect(plays(contexts[1], 'a')).toBe(true);
    expect(contexts[0].closed).toBe(1);
  });

  it('asks nothing of the default device', async () => {
    const { sink, contexts } = setup();
    await sink.setSinkId!('');
    expect(contexts[1].sinkIds).toEqual([]);
  });

  it('keeps the old context and rejects when the device refuses', async () => {
    const { sink, contexts, plays } = setup({ prepare: (ctx, i) => { ctx.sinkFails = i === 1; } });
    await expect(sink.setSinkId!('gone')).rejects.toThrow();
    expect(contexts[1].closed).toBe(1);
    expect(contexts[0].closed).toBe(0);
    expect(plays(contexts[0], 'a')).toBe(true);
  });

  it('keeps the old context and rejects when a new one will not start after a gesture', async () => {
    const { sink, contexts, clock } = setup({
      prepare: (ctx, i) => { if (i === 1) { ctx.state = 'suspended'; ctx.stuck = true; } },
    });
    const switching = sink.setSinkId!('usb');
    await flush();
    clock.advance(RESUME_DEADLINE_MS);
    await expect(switching).rejects.toThrow();
    expect(contexts[1].closed).toBe(1);
    expect(contexts[0].closed).toBe(0);
  });

  it('moves at once before any gesture, without waiting for a start', async () => {
    const { sink, contexts, plays } = setup({ state: 'suspended', prepare: (ctx) => { ctx.stuck = true; } });
    await sink.setSinkId!('usb');
    expect(plays(contexts[1], 'a')).toBe(true);
    expect(contexts[0].closed).toBe(1);
    contexts[1].stuck = false;
    await sink.play();
    expect(sink.paused).toBe(false);
  });

  it('a newer switch abandons one that hangs', async () => {
    const { sink, contexts, plays } = setup({ prepare: (ctx, i) => { ctx.holdSink = i === 1; } });
    const hung = sink.setSinkId!('dead');
    await flush();
    await sink.setSinkId!('usb');
    expect(contexts[1].closed).toBe(1);
    expect(plays(contexts[2], 'a')).toBe(true);
    contexts[1].releaseSink();
    await expect(hung).resolves.toBeUndefined();
    expect(plays(contexts[2], 'a')).toBe(true);
  });

  it('a stream swapped during a switch lands on the new context', async () => {
    const { sink, contexts, plays } = setup({ prepare: (ctx, i) => { ctx.holdSink = i === 1; } });
    const switching = sink.setSinkId!('usb');
    await flush();
    sink.srcObject = fakeStream('b');
    contexts[1].releaseSink();
    await switching;
    expect(plays(contexts[1], 'b')).toBe(true);
    expect(plays(contexts[1], 'a')).toBe(false);
  });

  it('closing during a switch closes both contexts', async () => {
    const { sink, contexts } = setup({ prepare: (ctx, i) => { ctx.holdSink = i === 1; } });
    const switching = sink.setSinkId!('usb');
    await flush();
    sink.srcObject = null;
    contexts[1].releaseSink();
    await switching;
    expect(contexts).toHaveLength(2);
    expect(contexts[0].closed).toBe(1);
    expect(contexts[1].closed).toBe(1);
  });
});

/** Takes the current context down with its device. */
const lose = (ctx: FakeAudioContext) => { ctx.stuck = true; ctx.wedge(); };

describe('createContextSink — a device that vanishes (#246)', () => {
  it('tells it to resume after the grace, then rebuilds on the same device', async () => {
    const { sink, contexts, clock, plays } = setup();
    await sink.setSinkId!('usb');
    const ctx = contexts[1];
    const before = ctx.resumed;
    lose(ctx);
    clock.advance(WEDGE_GRACE_MS - 1);
    expect(ctx.resumed).toBe(before);
    clock.advance(1);
    expect(ctx.resumed).toBe(before + 1);
    clock.advance(RESUME_DEADLINE_MS);
    await flush();
    expect(contexts).toHaveLength(3);
    expect(contexts[2].sinkIds).toEqual(['usb']);
    expect(plays(contexts[2], 'a')).toBe(true);
    expect(ctx.closed).toBe(1);
  });

  it('leaves alone a context that comes back', async () => {
    const { contexts, clock } = setup();
    contexts[0].wedge();
    clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
    await flush();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].state).toBe('running');
  });

  it('a context that never ran is waiting for a gesture, not wedged', async () => {
    const { sink, contexts, clock } = setup({ state: 'suspended', prepare: (ctx) => { ctx.stuck = true; } });
    void sink.play();
    clock.advance(10_000);
    await flush();
    expect(contexts).toHaveLength(1);
  });

  it('pause() is not a wedge', async () => {
    const { sink, contexts, clock } = setup();
    sink.pause();
    await flush();
    clock.advance(10_000);
    await flush();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resumed).toBe(0);
  });

  it('stops at the cap and reports once', async () => {
    const { contexts, clock } = setup({ prepare: (ctx, i) => { if (i > 0) { ctx.state = 'suspended'; ctx.stuck = true; } } });
    lose(contexts[0]);
    for (let i = 0; i < MAX_REBUILDS + 2; i += 1) {
      clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
      await flush();
    }
    expect(contexts).toHaveLength(1 + MAX_REBUILDS);
    expect(withKey('sink:them:gave-up')).toHaveLength(1);
  });

  it('a device that is gone keeps the old context, and a later switch recovers', async () => {
    const { sink, contexts, clock, plays } = setup({ prepare: (ctx, i) => { ctx.sinkFails = i === 2; } });
    await sink.setSinkId!('usb');
    lose(contexts[1]);
    clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
    await flush();
    expect(contexts[2].closed).toBe(1);
    await sink.setSinkId!('speakers');
    expect(plays(contexts[contexts.length - 1], 'a')).toBe(true);
  });

  it('a context replaced by a switch is no longer watched', async () => {
    const { sink, contexts, clock } = setup();
    await sink.setSinkId!('usb');
    contexts[0].stuck = true;
    contexts[0].wedge();
    clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
    await flush();
    expect(contexts).toHaveLength(2);
  });

  it('closing stops the watch', async () => {
    const { sink, contexts, clock } = setup();
    lose(contexts[0]);
    sink.srcObject = null;
    clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
    await flush();
    expect(contexts).toHaveLength(1);
  });
});
