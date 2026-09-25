import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { LEAD_S } from './clipQueue';
import {
  FakeAudioContext, FakeSink, FakeWorkletNode, reaches, type FakeBufferSource, type FakeGain, type FakeNode,
} from './fakeWebAudio';
import { CLOSE_WAIT_MS, createAudioGraph, MAX_REBUILDS } from './graph';
import { createPlayback, type RoutingSource } from './playback';

const reportWarningSpy = vi.hoisted(() => vi.fn());
const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/report')>();
  return { ...actual, reportWarning: reportWarningSpy, reportError: reportErrorSpy };
});

async function setup(virtual: 'device' | 'tabs' | 'none' = 'device') {
  const ctx = new FakeAudioContext();
  const sinks: FakeSink[] = [];
  const taps: FakeWorkletNode[] = [];
  const sent: Float32Array[] = [];
  const graph = await createAudioGraph({
    context: ctx.asContext(),
    addTapModule: async () => {},
    createTapNode: (_context, chunk) => {
      const node = new FakeWorkletNode('pcm-tap-processor', chunk);
      taps.push(node);
      return node as unknown as AudioWorkletNode;
    },
    createSink: (stream) => {
      const sink = new FakeSink(stream);
      sinks.push(sink);
      return sink;
    },
    virtual: virtual === 'tabs' ? { kind: 'tabs', send: (chunk) => { sent.push(chunk); } } : { kind: virtual },
  });
  // The real element is created first, then the virtual one (Electron).
  const [real, virtualSink] = sinks;
  const destinationOf = (sink: FakeSink): FakeNode => ctx.destinations.find((d) => d.stream === sink.srcObject)!;
  /** Plays a clip into a feed; returns its source node. */
  const clip = (feed: 'speaker' | 'participant' | 'replay' | 'passthrough'): FakeBufferSource => {
    graph.timeline(feed).play(new Int16Array(2400), 0, () => {});
    return ctx.sources[ctx.sources.length - 1];
  };
  return { ctx, graph, sinks, real, virtualSink, taps, sent, destinationOf, clip };
}

describe('createAudioGraph — routes', () => {
  it("sends the speaker's translation only where the edges say", async () => {
    const { graph, real, virtualSink, destinationOf, clip } = await setup();
    graph.route([{ from: 'speaker', to: 'virtual', gain: 1 }]);
    const source = clip('speaker');
    expect(reaches(source, destinationOf(virtualSink))).toBe(true);
    expect(reaches(source, destinationOf(real))).toBe(false);
    graph.route([{ from: 'speaker', to: 'real', gain: 1 }]);
    expect(reaches(source, destinationOf(virtualSink))).toBe(false);
    expect(reaches(source, destinationOf(real))).toBe(true);
  });

  it('applies a diff: a changed gain is updated in place, a missing edge is disconnected', async () => {
    const { graph, clip } = await setup();
    const feed = [...clip('passthrough').outputs][0];
    const edge = () => [...feed.outputs][0] as FakeGain;
    graph.route([{ from: 'passthrough', to: 'virtual', gain: 0.2 }]);
    const first = edge();
    expect(first.gain.value).toBe(0.2);
    graph.route([{ from: 'passthrough', to: 'virtual', gain: 0.4 }]);
    expect(edge()).toBe(first);
    expect(first.gain.value).toBe(0.4);
    graph.route([]);
    expect(feed.outputs.size).toBe(0);
  });

  it('ignores an edge to a bus this platform lacks (the web build has no virtual device)', async () => {
    const { graph, sinks, real, destinationOf, clip } = await setup('none');
    expect(sinks).toHaveLength(1);
    graph.route([{ from: 'speaker', to: 'virtual', gain: 1 }]);
    expect(reaches(clip('speaker'), destinationOf(real))).toBe(false);
  });

  it("sends the extension's virtual bus to the tabs", async () => {
    const { graph, taps, sent, clip } = await setup('tabs');
    // The tts tap is created first, then the virtual bus's.
    const virtualTap = taps[1];
    graph.route([{ from: 'speaker', to: 'virtual', gain: 1 }]);
    expect(reaches(clip('speaker'), virtualTap)).toBe(true);
    virtualTap.emit(Float32Array.of(0.5));
    expect(sent).toEqual([Float32Array.of(0.5)]);
  });

  it('routes the passthrough feed into the meeting at its ratio', async () => {
    const { graph, virtualSink, destinationOf, clip } = await setup();
    graph.route([{ from: 'passthrough', to: 'virtual', gain: 0.3 }]);
    expect(reaches(clip('passthrough'), destinationOf(virtualSink))).toBe(true);
  });
});

describe('createAudioGraph — outputs', () => {
  it('plays the real element from the start, on the monitor device once one is set', async () => {
    const { graph, real } = await setup();
    expect(real.paused).toBe(false);
    await graph.setSinks({ real: 'monitor-1' });
    expect(real.sinkId).toBe('monitor-1');
  });

  it('retries a monitor device whose switch failed once it is asked for again', async () => {
    const { graph, real } = await setup();
    let fail = true;
    real.setSinkId = async (id: string) => {
      if (fail) throw new Error('NotFoundError');
      real.sinkId = id;
    };
    await graph.setSinks({ real: 'monitor-1' });
    expect(real.sinkId).toBe('');
    expect(real.paused).toBe(false);
    fail = false;
    await graph.setSinks({ real: 'monitor-1' });
    expect(real.sinkId).toBe('monitor-1');
  });

  it('keeps the virtual element silent until it points at a virtual device, and silent again without one', async () => {
    const { graph, virtualSink } = await setup();
    expect(virtualSink.paused).toBe(true);
    await graph.setSinks({ virtual: 'cable-1' });
    expect(virtualSink.sinkId).toBe('cable-1');
    expect(virtualSink.paused).toBe(false);
    await graph.setSinks({ virtual: undefined });
    expect(virtualSink.paused).toBe(true);
  });

  it('keeps the virtual element silent when pointing it at its device fails', async () => {
    const { graph, virtualSink } = await setup();
    virtualSink.setSinkId = async () => { throw new Error('NotFoundError'); };
    await graph.setSinks({ virtual: 'cable-1' });
    expect(virtualSink.paused).toBe(true);
  });

  it('the virtual element does not start while its device switch is pending, even when resumed', async () => {
    const { graph, virtualSink } = await setup();
    let resolveSwitch!: () => void;
    virtualSink.setSinkId = (id: string) => new Promise<void>((resolve) => {
      resolveSwitch = () => { virtualSink.sinkId = id; resolve(); };
    });
    const switching = graph.setSinks({ virtual: 'cable-1' });
    await graph.resume();
    expect(virtualSink.paused).toBe(true);
    resolveSwitch();
    await switching;
    expect(virtualSink.paused).toBe(false);
    expect(virtualSink.sinkId).toBe('cable-1');
  });

  it('a virtual element that cannot choose its device never plays', async () => {
    const { graph, virtualSink } = await setup();
    (virtualSink as { setSinkId?: unknown }).setSinkId = undefined;
    await graph.setSinks({ virtual: 'cable-1' });
    await graph.resume();
    expect(virtualSink.paused).toBe(true);
  });

  it('ignores an interrupted play() (AbortError), but reports any other failure to start', async () => {
    const { graph, real } = await setup();
    reportWarningSpy.mockClear();
    real.pause();
    real.play = async () => { throw new DOMException('interrupted', 'AbortError'); };
    await graph.resume();
    expect(reportWarningSpy.mock.calls.some(([, message]) => String(message).includes('did not start'))).toBe(false);
    real.pause();
    real.play = async () => { throw new Error('NotAllowedError'); };
    await graph.resume();
    expect(reportWarningSpy.mock.calls.some(([, message]) => String(message).includes('did not start'))).toBe(true);
  });

  it('resume() resumes a suspended context and restarts a paused real element', async () => {
    const { ctx, graph, real, virtualSink } = await setup();
    ctx.state = 'suspended';
    real.pause();
    await graph.resume();
    expect(ctx.resumed).toBe(1);
    expect(real.paused).toBe(false);
    expect(virtualSink.paused).toBe(true);
  });

  it('resume() reports a context that will not resume instead of rejecting', async () => {
    const { ctx, graph } = await setup();
    ctx.state = 'suspended';
    ctx.resume = async () => { throw new Error('InvalidStateError'); };
    await expect(graph.resume()).resolves.toBeUndefined();
  });

  it('close() pauses the outputs and closes the context', async () => {
    const { ctx, graph, real } = await setup();
    await graph.close();
    expect(real.paused).toBe(true);
    expect(real.srcObject).toBeNull();
    expect(ctx.closed).toBe(1);
  });

  it('closes once, however often it is asked', async () => {
    const { ctx, graph } = await setup();
    await Promise.all([graph.close(), graph.close()]);
    expect(ctx.closed).toBe(1);
  });

  it('suspend() pauses a running context, and does nothing to one already suspended', async () => {
    const { ctx, graph } = await setup();
    await graph.suspend();
    expect(ctx.state).toBe('suspended');
    expect(ctx.suspended).toBe(1);
    await graph.suspend();
    expect(ctx.suspended).toBe(1);
  });

  it('a resume while a suspend is still in flight leaves the context running', async () => {
    const { ctx, graph } = await setup();
    const suspending = graph.suspend();
    const resuming = graph.resume();
    await Promise.all([suspending, resuming]);
    expect(ctx.state).toBe('running');
    expect(ctx.resumed).toBe(1);
  });

  it('suspend() reports a context that will not suspend instead of rejecting', async () => {
    const { ctx, graph } = await setup();
    ctx.suspend = async () => { throw new Error('InvalidStateError'); };
    await expect(graph.suspend()).resolves.toBeUndefined();
  });

  it('reports an output that will not start once per failing streak, not per chunk', async () => {
    const { graph, real } = await setup();
    reportWarningSpy.mockClear();
    real.pause();
    real.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    await graph.resume();
    await graph.resume();
    await graph.resume();
    expect(reportWarningSpy.mock.calls.filter(([, message]) => String(message).includes('did not start'))).toHaveLength(1);
  });
});

describe('createAudioGraph — the tts tap', () => {
  it('hears the translated speech whatever the routes, and not the preview or passthrough', async () => {
    const { ctx, graph, taps, clip } = await setup();
    const ttsTap = taps[0];
    expect(reaches(clip('speaker'), ttsTap)).toBe(true);
    expect(reaches(clip('participant'), ttsTap)).toBe(true);
    expect(reaches(clip('replay'), ttsTap)).toBe(true);
    graph.playOnce(new Float32Array(10), 48000);
    expect(reaches(ctx.sources[ctx.sources.length - 1], ttsTap)).toBe(false);
    expect(reaches(clip('passthrough'), ttsTap)).toBe(false);
  });

  it('hands the reader what the worklet posts', async () => {
    const { graph, taps } = await setup();
    taps[0].emit(Float32Array.of(0.5, 0.25));
    taps[0].emit(Float32Array.of(0.125));
    expect([...graph.ttsTap.read()]).toEqual([0.5, 0.25, 0.125]);
  });

  it('asks the worklet for 100 ms chunks, and pulls both taps through a muted path', async () => {
    const { ctx, taps } = await setup('tabs');
    expect(taps.map((t) => t.chunk)).toEqual([2400, 2400]);
    for (const tap of taps) expect(reaches(tap, ctx.destination)).toBe(true);
  });
});

describe('createAudioGraph — clips', () => {
  it('writes a clip at 24 kHz, and ends it once: on its end, or on stop', async () => {
    const { ctx, graph } = await setup();
    let ended = 0;
    graph.timeline('speaker').play(Int16Array.of(16384, -16384), 0, () => { ended += 1; });
    const source = ctx.sources[0];
    expect(source.buffer!.sampleRate).toBe(24000);
    expect([...source.buffer!.getChannelData(0)]).toEqual([0.5, -0.5]);
    ctx.advance(1);
    expect(ended).toBe(1);
    const stop = graph.timeline('speaker').play(new Int16Array(24000), 5, () => { ended += 1; });
    stop();
    stop();
    ctx.advance(10);
    expect(ended).toBe(2);
    expect(ctx.sources[1].stopped).toBe(true);
  });

  it('plays a one-shot at its own rate and resolves when it ends', async () => {
    const { ctx, graph } = await setup();
    const shot = graph.playOnce(new Float32Array(4800), 48000);
    expect(ctx.sources[0].buffer!.sampleRate).toBe(48000);
    ctx.advance(0.2);
    await expect(shot.ended).resolves.toBeUndefined();
  });

  it('an empty one-shot has ended already and plays nothing', async () => {
    const { ctx, graph } = await setup();
    await expect(graph.playOnce(new Float32Array(0), 48000).ended).resolves.toBeUndefined();
    expect(ctx.sources).toHaveLength(0);
  });
});

/** A virtual clock that also counts its timers still pending: neither fired nor cancelled. */
function countingClock() {
  const clock = createVirtualClock(0);
  let pending = 0;
  return {
    now: clock.now,
    advance: clock.advance,
    setTimeout(fn: () => void, ms: number): () => void {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        pending -= 1;
      };
      pending += 1;
      const cancel = clock.setTimeout(() => { settle(); fn(); }, ms);
      return () => { settle(); cancel(); };
    },
    get pending() { return pending; },
  };
}

async function setupRecovering({ replace = true, virtual = 'device' }: { replace?: boolean; virtual?: 'device' | 'tabs' } = {}) {
  const first = new FakeAudioContext();
  const contexts = [first];
  const clock = countingClock();
  const sinks: FakeSink[] = [];
  /** Every tap node with the context it was made on: per context, the tts tap first, then the tabs bus's. */
  const taps: Array<{ ctx: AudioContext; node: FakeWorkletNode }> = [];
  const sent: Float32Array[] = [];
  /** How the next replacement goes: its construction throws, its module load rejects or waits for `release()`, or `onNew` alters it. */
  const control = {
    failReplace: false,
    failModule: false,
    hold: false,
    release: () => {},
    onNew: undefined as ((ctx: FakeAudioContext) => void) | undefined,
  };
  const graph = await createAudioGraph({
    context: first.asContext(),
    addTapModule: async () => {
      if (control.failModule) throw new Error('module not found');
      if (control.hold) await new Promise<void>((resolve) => { control.release = resolve; });
    },
    createTapNode: (ctx, chunk) => {
      const node = new FakeWorkletNode('pcm-tap-processor', chunk);
      taps.push({ ctx, node });
      return node as unknown as AudioWorkletNode;
    },
    createSink: (stream) => {
      const sink = new FakeSink(stream);
      sinks.push(sink);
      return sink;
    },
    virtual: virtual === 'tabs' ? { kind: 'tabs', send: (chunk) => { sent.push(chunk); } } : { kind: 'device' },
    clock,
    ...(replace
      ? {
          replaceContext: () => {
            if (control.failReplace) throw new Error('no output device');
            const next = new FakeAudioContext();
            control.onNew?.(next);
            contexts.push(next);
            return next.asContext();
          },
        }
      : {}),
  });
  const [real, virtualSink] = sinks;
  /** The stream destination a sink plays, on the given context (undefined when it plays another context's). */
  const destinationOn = (ctx: FakeAudioContext, sink: FakeSink): FakeNode | undefined =>
    ctx.destinations.find((d) => d.stream === sink.srcObject);
  const tapsOn = (ctx: FakeAudioContext) => taps.filter((t) => t.ctx === ctx.asContext()).map((t) => t.node);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { first, contexts, clock, graph, sinks, real, virtualSink, sent, control, destinationOn, tapsOn, flush };
}

/** Wedges a context (the newest by default) so that resuming it never lands, and lets the watch run its course. */
async function wedgeFor(
  { contexts, clock, flush }: Pick<Awaited<ReturnType<typeof setupRecovering>>, 'contexts' | 'clock' | 'flush'>,
  ctx: FakeAudioContext = contexts[contexts.length - 1],
) {
  ctx.stuck = true;
  ctx.wedge();
  clock.advance(1_750);
  await flush();
}

const withKey = (spy: typeof reportWarningSpy, key: string) =>
  spy.mock.calls.filter(([, , options]) => (options as { dedupeKey?: string } | undefined)?.dedupeKey === key);
const rebuildWarnings = () => withKey(reportWarningSpy, 'graph:rebuild');
const rebuildFailures = () => withKey(reportErrorSpy, 'graph:rebuild-failed');

describe('createAudioGraph — a wedged context (#246)', () => {
  it('rebuilds a context left suspended by something else', async () => {
    const { first, contexts, clock, graph, real, destinationOn, flush } = await setupRecovering();
    first.stuck = true;
    first.wedge();
    clock.advance(249);
    expect(first.resumed).toBe(0);
    clock.advance(1);
    expect(first.resumed).toBe(1);
    clock.advance(1_500);
    await flush();
    expect(first.closed).toBe(1);
    expect(contexts).toHaveLength(2);
    expect(destinationOn(contexts[1], real)).toBeDefined();
    expect(destinationOn(first, real)).toBeUndefined();
    graph.timeline('speaker').play(new Int16Array(2400), 0, () => {});
    expect(contexts[1].sources).toHaveLength(1);
    expect(first.sources).toHaveLength(0);
  });

  it('keeps the routes across a rebuild', async () => {
    const setup = await setupRecovering();
    const { contexts, graph, real, virtualSink, destinationOn } = setup;
    graph.route([{ from: 'speaker', to: 'real', gain: 1 }]);
    await wedgeFor(setup);
    expect(contexts).toHaveLength(2);
    graph.timeline('speaker').play(new Int16Array(2400), 0, () => {});
    const source = contexts[1].sources[contexts[1].sources.length - 1];
    expect(reaches(source, destinationOn(contexts[1], real)!)).toBe(true);
    expect(reaches(source, destinationOn(contexts[1], virtualSink)!)).toBe(false);
  });

  it('leaves its own rest alone', async () => {
    const { first, contexts, clock, graph } = await setupRecovering();
    await graph.suspend();
    expect(first.state).toBe('suspended');
    // A real context dispatches statechange as a task, once the suspend has
    // landed: the event of the graph's own rest arrives after it, as here.
    first.wedge();
    clock.advance(10_000);
    expect(first.resumed).toBe(0);
    expect(contexts).toHaveLength(1);
  });

  it('leaves alone a wedge that clears inside the grace', async () => {
    const { first, contexts, clock, flush } = await setupRecovering();
    first.wedge();
    clock.advance(100);
    first.recover();
    clock.advance(5_000);
    await flush();
    expect(first.resumed).toBe(0);
    expect(contexts).toHaveLength(1);
  });

  it('cancels the rebuild when its resume lands in time', async () => {
    const { first, contexts, clock, flush } = await setupRecovering();
    first.wedge();
    clock.advance(250);
    expect(first.resumed).toBe(1);
    expect(first.state).toBe('running');
    clock.advance(1_500);
    await flush();
    expect(contexts).toHaveLength(1);
  });

  it('tells its listeners once the new context is in, before the old one goes', async () => {
    const setup = await setupRecovering();
    const { first, contexts, graph } = setup;
    first.currentTime = 1_000;
    const order: string[] = [];
    const off = graph.onReset(() => {
      order.push(`reset:${first.closed}:${contexts.length}:${graph.timeline('speaker').now() === contexts[1].currentTime}`);
    });
    await wedgeFor(setup);
    expect(order).toEqual(['reset:0:2:true']);
    expect(first.closed).toBe(1);
    off();
    await wedgeFor(setup);
    expect(contexts).toHaveLength(3);
    expect(order).toHaveLength(1);
  });

  it('treats a resume of its own that never lands as a wedge, and does not hang on it', async () => {
    const { first, contexts, clock, graph, flush } = await setupRecovering();
    await graph.suspend();
    first.stuck = true;
    const resumed = graph.resume();
    clock.advance(1_500);
    await resumed;
    await flush();
    expect(contexts).toHaveLength(2);
  });

  it(`gives up after ${MAX_REBUILDS} rebuilds until a context runs again`, async () => {
    const setup = await setupRecovering();
    const { contexts } = setup;
    reportWarningSpy.mockClear();
    for (let round = 0; round < 3; round++) await wedgeFor(setup);
    expect(contexts).toHaveLength(4);
    expect(rebuildWarnings()).toHaveLength(3);
    await wedgeFor(setup);
    expect(contexts).toHaveLength(4);
    contexts[3].recover();
    expect(contexts[3].state).toBe('running');
    await wedgeFor(setup);
    expect(contexts).toHaveLength(5);
  });

  it('watches nothing without replaceContext', async () => {
    const { first, contexts, clock, flush } = await setupRecovering({ replace: false });
    first.wedge();
    clock.advance(10_000);
    await flush();
    expect(first.resumed).toBe(0);
    expect(contexts).toHaveLength(1);
  });

  it('close() during the grace cancels the watch', async () => {
    const { first, contexts, clock, graph, flush } = await setupRecovering();
    first.stuck = true;
    first.wedge();
    clock.advance(100);
    await graph.close();
    expect(clock.pending).toBe(0);
    clock.advance(10_000);
    await flush();
    expect(first.resumed).toBe(0);
    expect(contexts).toHaveLength(1);
  });

  it('close() during the deadline cancels the watch', async () => {
    const { first, contexts, clock, graph, flush } = await setupRecovering();
    first.stuck = true;
    first.wedge();
    clock.advance(1_000);
    expect(first.resumed).toBe(1);
    await graph.close();
    expect(clock.pending).toBe(0);
    clock.advance(10_000);
    await flush();
    expect(contexts).toHaveLength(1);
  });

  it('stops listening to its context once closed', async () => {
    const { first, clock, graph, flush } = await setupRecovering();
    await graph.close();
    first.wedge();
    clock.advance(10_000);
    await flush();
    expect(first.resumed).toBe(0);
    expect(clock.pending).toBe(0);
  });

  it('close() does not hang on a context whose close never settles', async () => {
    const { first, clock, graph, real } = await setupRecovering();
    first.close = () => new Promise<void>(() => {});
    const closed = graph.close();
    clock.advance(CLOSE_WAIT_MS);
    await expect(closed).resolves.toBeUndefined();
    expect(real.srcObject).toBeNull();
  });

  it('starts on the new clock what was scheduled while the rebuild ran', async () => {
    const { first, contexts, clock, graph, flush } = await setupRecovering();
    // Speaker clips reach the real bus, passthrough the virtual one.
    const routing: RoutingSource = {
      get: () => ({ meeting: false, monitor: true, participantSpeech: false, passthrough: { on: true, ratio: 1 }, sinks: {} }),
      subscribe: () => () => {},
    };
    const playback = createPlayback(graph, routing, clock);
    const pcm = new Int16Array(2400);
    // The dead context ran a while; passthrough plays only during a run.
    first.currentTime = 1_000;
    playback.live(true);
    first.stuck = true;
    first.wedge();
    clock.advance(1_750);
    // The rebuild now awaits the tap module: both of these land on the dead context.
    playback.audio('speaker', 1, pcm);
    playback.passthrough(pcm);
    expect(first.sources).toHaveLength(2);
    await flush();
    expect(contexts).toHaveLength(2);
    playback.audio('speaker', 2, pcm);
    const clip = contexts[1].sources[contexts[1].sources.length - 1];
    expect(clip.startedAt).toBeLessThan(contexts[1].currentTime + LEAD_S + 0.01);
    const before = contexts[1].sources.length;
    playback.passthrough(pcm);
    expect(contexts[1].sources).toHaveLength(before + 1);
  });

  it('finishes a rebuild whose dead context never settles its close()', async () => {
    const setup = await setupRecovering();
    const { first, contexts } = setup;
    first.close = () => new Promise<void>(() => {});
    await wedgeFor(setup);
    expect(contexts).toHaveLength(2);
    await wedgeFor(setup);
    expect(contexts).toHaveLength(3);
  });

  it('keeps both outputs on their devices and playing across a rebuild', async () => {
    const setup = await setupRecovering();
    const { contexts, graph, real, virtualSink, destinationOn } = setup;
    await graph.setSinks({ real: 'monitor-1', virtual: 'cable-1' });
    const before = { real: real.plays, virtual: virtualSink.plays };
    await wedgeFor(setup);
    expect(destinationOn(contexts[1], real)).toBeDefined();
    expect(destinationOn(contexts[1], virtualSink)).toBeDefined();
    // A new source pauses an element, as a browser's load algorithm does: the rebuild plays both again.
    expect(real.paused).toBe(false);
    expect(virtualSink.paused).toBe(false);
    expect(real.plays).toBe(before.real + 1);
    expect(virtualSink.plays).toBe(before.virtual + 1);
    expect(real.sinkId).toBe('monitor-1');
    expect(virtualSink.sinkId).toBe('cable-1');
  });

  it('moves the tts tap and the tabs bus to the new context', async () => {
    const setup = await setupRecovering({ virtual: 'tabs' });
    const { first, contexts, graph, sent, tapsOn } = setup;
    graph.route([{ from: 'speaker', to: 'virtual', gain: 1 }]);
    await wedgeFor(setup);
    const [tts, tabs] = tapsOn(contexts[1]);
    graph.timeline('speaker').play(new Int16Array(2400), 0, () => {});
    const clip = contexts[1].sources[contexts[1].sources.length - 1];
    expect(reaches(clip, tts)).toBe(true);
    expect(reaches(clip, tabs)).toBe(true);
    // The new taps deliver; the dead context's no longer do.
    const [oldTts, oldTabs] = tapsOn(first);
    oldTts.emit(Float32Array.of(0.25));
    oldTabs.emit(Float32Array.of(0.25));
    tts.emit(Float32Array.of(0.5));
    tabs.emit(Float32Array.of(0.5));
    expect([...graph.ttsTap.read()]).toEqual([0.5]);
    expect(sent).toEqual([Float32Array.of(0.5)]);
  });

  it('a rebuild whose module fails to load leaves the context it keeps as it was, still watched', async () => {
    const setup = await setupRecovering();
    const { first, contexts, graph, control, tapsOn } = setup;
    control.failModule = true;
    reportErrorSpy.mockClear();
    await wedgeFor(setup);
    expect(contexts).toHaveLength(2);
    expect(contexts[1].closed).toBe(1);
    expect(rebuildFailures()).toHaveLength(1);
    // Its taps still deliver...
    tapsOn(first)[0].emit(Float32Array.of(0.5));
    expect([...graph.ttsTap.read()]).toEqual([0.5]);
    // ...and its listener still hears it: it runs again, wedges again, and this rebuild lands.
    control.failModule = false;
    first.stuck = false;
    first.recover();
    await wedgeFor(setup, first);
    expect(contexts).toHaveLength(3);
    expect(graph.timeline('speaker').now()).toBe(contexts[2].currentTime);
  });

  it('a replacement that cannot be made is reported once, not thrown, and the context it keeps stays watched', async () => {
    const setup = await setupRecovering();
    const { first, contexts, control, flush } = setup;
    control.failReplace = true;
    reportErrorSpy.mockClear();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await wedgeFor(setup);
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(contexts).toHaveLength(1);
    expect(rebuildFailures()).toHaveLength(1);
    control.failReplace = false;
    first.stuck = false;
    first.recover();
    await wedgeFor(setup, first);
    expect(contexts).toHaveLength(2);
  });

  it('a build that throws leaves every output on the context it keeps', async () => {
    const setup = await setupRecovering();
    const { first, contexts, real, virtualSink, control, destinationOn, flush } = setup;
    // The replacement's second stream destination (the virtual bus's) fails, after the real one was made.
    control.onNew = (ctx) => {
      let made = 0;
      const create = ctx.createMediaStreamDestination.bind(ctx);
      ctx.createMediaStreamDestination = () => {
        made += 1;
        if (made === 2) throw new Error('out of resources');
        return create();
      };
    };
    reportErrorSpy.mockClear();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await wedgeFor(setup);
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(contexts[1].closed).toBe(1);
    expect(rebuildFailures()).toHaveLength(1);
    expect(destinationOn(first, real)).toBeDefined();
    expect(destinationOn(first, virtualSink)).toBeDefined();
  });

  it('does not carry a rest of the old context over to the new one', async () => {
    const setup = await setupRecovering();
    const { first, contexts, clock, graph, control, flush } = setup;
    control.hold = true;
    first.stuck = true;
    first.wedge();
    clock.advance(1_750);
    // While the module loads, the old context runs again by itself, and the graph rests it.
    first.stuck = false;
    first.recover();
    await graph.suspend();
    control.hold = false;
    control.release();
    await flush();
    expect(contexts).toHaveLength(2);
    await wedgeFor(setup);
    expect(contexts).toHaveLength(3);
  });

  it('does not count a resume that timed out as one that landed', async () => {
    const { first, clock, graph } = await setupRecovering();
    const resumeWarnings = () => withKey(reportWarningSpy, 'graph:resume');
    reportWarningSpy.mockClear();
    await graph.suspend();
    first.resume = () => Promise.reject(new Error('InvalidStateError'));
    await graph.resume();
    expect(resumeWarnings()).toHaveLength(1);
    // A resume that never settles while the context runs again by itself: the race's timer wins.
    first.resume = () => new Promise<void>(() => {});
    const timingOut = graph.resume();
    first.recover();
    clock.advance(1_500);
    await timingOut;
    // The failing streak goes on: not reported again.
    first.wedge();
    first.resume = () => Promise.reject(new Error('InvalidStateError'));
    await graph.resume();
    expect(resumeWarnings()).toHaveLength(1);
  });
});
