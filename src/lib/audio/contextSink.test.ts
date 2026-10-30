import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { createContextSink } from './contextSink';
import { FakeAudioContext, reaches } from './fakeWebAudio';
import { RESUME_DEADLINE_MS } from './graph';

const fakeStream = (id: string) => ({ id }) as unknown as MediaStream;

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
