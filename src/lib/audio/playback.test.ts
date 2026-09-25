import { describe, it, expect } from 'vitest';
import { SAMPLE_RATE } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import { EMPTY_PCM, type Segment } from '../conversation/types';
import { LEAD_S } from './clipQueue';
import type { AudioGraph } from './graph';
import { createPcmTap } from './pcmTap';
import { clipKey, createPlayback, parseClipKey, QUIET_MS, type RoutingSource } from './playback';
import { routesFor, type Edge, type RoutingSettings } from './routes';

/** A graph whose timelines the test moves by hand, and which records routes, sinks, one-shots, and how often it was suspended or closed. */
function fakeGraph() {
  let now = 0;
  let resumed = 0;
  let suspendedCount = 0;
  let closedCount = 0;
  const plays: Array<{ feed: string; pcm: Int16Array; at: number; onEnded: () => void; done: boolean }> = [];
  const routes: Edge[][] = [];
  const sinks: Array<{ real?: string; virtual?: string }> = [];
  const shots: Array<{ audio: Float32Array; sampleRate: number; stopped: boolean; end: () => void }> = [];
  const resets = new Set<() => void>();
  const graph: AudioGraph & { readonly suspended: number; readonly closed: number } = {
    timeline: (feed) => ({
      now: () => now,
      play(pcm, at, onEnded) {
        const play = { feed, pcm, at, onEnded, done: false };
        plays.push(play);
        return () => {
          if (play.done) return;
          play.done = true;
          onEnded();
        };
      },
    }),
    playOnce(audio, sampleRate) {
      let end!: () => void;
      const ended = new Promise<void>((resolve) => { end = resolve; });
      const shot = { audio, sampleRate, stopped: false, end };
      shots.push(shot);
      return { ended, stop: () => { shot.stopped = true; end(); } };
    },
    route: (edges) => { routes.push([...edges]); },
    setSinks: async (s) => { sinks.push(s); },
    ttsTap: createPcmTap(),
    resume: async () => { resumed += 1; },
    suspend: async () => { suspendedCount += 1; },
    close: async () => { closedCount += 1; },
    onReset(listener) {
      resets.add(listener);
      return () => resets.delete(listener);
    },
    get suspended() { return suspendedCount; },
    get closed() { return closedCount; },
  };
  /** As the graph does once it has replaced a wedged context. */
  const reset = () => { for (const listener of [...resets]) listener(); };
  const advance = (seconds: number) => {
    now += seconds;
    for (const play of plays) {
      if (!play.done && play.at + play.pcm.length / SAMPLE_RATE <= now) {
        play.done = true;
        play.onEnded();
      }
    }
  };
  return { graph, plays, routes, sinks, shots, advance, reset, resumed: () => resumed };
}

/** As `fakeGraph`, but wired through `createPlayback` with a virtual clock the test drives by hand. */
function build(routingSettings: RoutingSettings = ROUTING) {
  const { graph, plays, advance, resumed } = fakeGraph();
  const clock = createVirtualClock(0);
  const playback = createPlayback(graph, routing(routingSettings).source, clock);
  const passthroughPlayed = () => plays.filter((p) => p.feed === 'passthrough').length;
  return { playback, graph, clock, plays, advance, resumed, passthroughPlayed };
}

const ROUTING: RoutingSettings = {
  meeting: true,
  monitor: false,
  participantSpeech: false,
  passthrough: { on: true, ratio: 0.2 },
  sinks: { real: 'monitor-1' },
};

function routing(initial: RoutingSettings = ROUTING) {
  let settings = initial;
  const listeners = new Set<() => void>();
  const source: RoutingSource = {
    get: () => settings,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const set = (patch: Partial<RoutingSettings>) => {
    settings = { ...settings, ...patch };
    for (const listener of listeners) listener();
  };
  return { source, set };
}

/** `ms` milliseconds of pcm. */
const pcm = (ms: number) => new Int16Array((SAMPLE_RATE * ms) / 1000);

function translation(ref: number, speech: Segment['speech']): Segment {
  return { id: `s:speaker:${ref}`, ref, side: 'translation', text: 'こんにちは', final: true, openedAt: 0, marks: [], speech };
}

describe('createPlayback — live audio', () => {
  it("queues each leg's audio as its own clip, keyed by leg, segment and speech entry", () => {
    const { graph, plays, advance } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.audio('speaker', 2, pcm(100));
    playback.audio('speaker', 2, pcm(100));
    playback.audio('participant', 5, pcm(100));
    expect(plays.map((p) => p.feed)).toEqual(['speaker', 'speaker', 'participant']);
    advance(LEAD_S + 0.01);
    expect(playback.queues.speaker.position()?.key).toBe('speaker:2:0');
    expect(playback.queues.participant.position()?.key).toBe('participant:5:0');
    advance(0.1);
    expect(playback.queues.speaker.position()?.key).toBe('speaker:2:1');
  });

  it('keys audio that names no segment with none', () => {
    const { graph, advance } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.audio('speaker', undefined, pcm(100));
    advance(LEAD_S + 0.01);
    expect(playback.queues.speaker.position()?.key).toBe('speaker:none:0');
  });

  it('resumes the graph before it plays (autoplay)', () => {
    const { graph, resumed } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.audio('speaker', 2, pcm(100));
    expect(resumed()).toBeGreaterThan(0);
  });

  it('clear stops both legs and the replay, and restarts the speech entry count', () => {
    const { graph, plays, advance } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.audio('speaker', 2, pcm(100));
    playback.audio('participant', 5, pcm(100));
    playback.replay('speaker', translation(4, [{ pcm: pcm(100) }]));
    playback.clear();
    expect(plays.every((p) => p.done)).toBe(true);
    playback.audio('speaker', 2, pcm(100));
    advance(LEAD_S + 0.01);
    expect(playback.queues.speaker.position()?.key).toBe('speaker:2:0');
  });

  it('a context reset drops what was queued but not the clip indices', () => {
    const { graph, plays, advance, reset } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.audio('speaker', 1, pcm(100));
    expect(plays).toHaveLength(1);
    const clears = playback.queues.speaker.clears;
    reset();
    expect(plays[0].done).toBe(true);
    expect(playback.queues.speaker.pending).toBe(0);
    expect(playback.queues.speaker.clears).toBe(clears + 1);
    playback.audio('speaker', 1, pcm(100));
    advance(LEAD_S);
    expect(parseClipKey(playback.queues.speaker.position()!.key).index).toBe(1);
  });
});

describe('createPlayback — routes', () => {
  it('applies the route table and the sinks at once, and again whenever the routing changes', () => {
    const { graph, routes, sinks } = fakeGraph();
    const r = routing();
    createPlayback(graph, r.source);
    expect(routes).toEqual([routesFor(ROUTING, false)]);
    expect(sinks).toEqual([{ real: 'monitor-1' }]);
    r.set({ monitor: true });
    expect(routes[1]).toContainEqual({ from: 'speaker', to: 'real', gain: 1 });
  });

  it("closes passthrough while push-to-translate's key is held", () => {
    const { graph, routes } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.held(true);
    expect(routes[routes.length - 1].some((e: Edge) => e.from === 'passthrough')).toBe(false);
    playback.held(false);
    expect(routes[routes.length - 1]).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 0.2 });
    const count = routes.length;
    playback.held(false);
    expect(routes).toHaveLength(count);
  });

  it('stops listening to the routing once disposed', async () => {
    const { graph, routes } = fakeGraph();
    const r = routing();
    const playback = createPlayback(graph, r.source);
    await playback.dispose();
    r.set({ monitor: true });
    expect(routes.length).toBe(1);
  });
});

describe('createPlayback — replay', () => {
  it("plays a segment's kept speech entry by entry, skipping dropped pcm, under the live keys", () => {
    const { graph, plays, advance } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.replay('speaker', translation(4, [{ pcm: pcm(100) }, { pcm: EMPTY_PCM }, { pcm: pcm(100) }]));
    expect(plays.map((p) => p.feed)).toEqual(['replay', 'replay']);
    advance(LEAD_S + 0.01);
    expect(playback.queues.replay.position()?.key).toBe('speaker:4:0');
    advance(0.1);
    expect(playback.queues.replay.position()?.key).toBe('speaker:4:2');
  });

  it('replaces a replay in progress, and stops on request', () => {
    const { graph, plays } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.replay('speaker', translation(4, [{ pcm: pcm(100) }]));
    playback.replay('speaker', translation(6, [{ pcm: pcm(100) }]));
    expect(plays[0].done).toBe(true);
    expect(plays[1].done).toBe(false);
    playback.stopReplay();
    expect(plays[1].done).toBe(true);
  });
});

describe('createPlayback — preview', () => {
  it('plays one clip at a time and resolves when it ends', async () => {
    const { graph, shots } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    const first = playback.preview({ audio: new Float32Array(10), sampleRate: 44100 });
    const second = playback.preview({ audio: new Float32Array(10), sampleRate: 44100 });
    expect(shots[0].stopped).toBe(true);
    await first;
    shots[1].end();
    await second;
    expect(shots.map((s) => s.sampleRate)).toEqual([44100, 44100]);
  });

  it('an empty clip resolves at once and plays nothing', async () => {
    const { graph, shots } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    await playback.preview({ audio: new Float32Array(0), sampleRate: 44100 });
    expect(shots).toHaveLength(0);
  });

  it('rejects rather than throwing when the graph refuses to play the clip', async () => {
    const { graph } = fakeGraph();
    graph.playOnce = () => { throw new Error('sample rate out of range'); };
    const playback = createPlayback(graph, routing().source);
    await expect(playback.preview({ audio: new Float32Array(10), sampleRate: 1 })).rejects.toThrow();
  });
});

describe('parseClipKey', () => {
  it('reads back what clipKey wrote', () => {
    expect(parseClipKey(clipKey('participant', 7, 2))).toEqual({ leg: 'participant', ref: 7, index: 2 });
    expect(parseClipKey(clipKey('speaker', undefined, 0))).toEqual({ leg: 'speaker', ref: undefined, index: 0 });
  });
});

describe('createPlayback — passthrough', () => {
  it("plays the microphone's chunks back to back on the passthrough feed, while live", () => {
    const { graph, plays } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.live(true);
    playback.passthrough(pcm(85));
    playback.passthrough(pcm(85));
    expect(plays.map((p) => p.feed)).toEqual(['passthrough', 'passthrough']);
    expect(plays[1].at).toBeCloseTo(plays[0].at + 0.085, 9);
  });

  it('resumes the graph before it plays (autoplay)', () => {
    const { graph, resumed } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.live(true);
    playback.passthrough(pcm(85));
    expect(resumed()).toBeGreaterThan(0);
  });

  it('forwards the original voice only while the run is live', () => {
    const { playback, passthroughPlayed } = build();
    playback.passthrough(pcm(85));
    playback.live(true);
    playback.passthrough(pcm(85));
    playback.live(false);
    playback.passthrough(pcm(85));
    expect(passthroughPlayed()).toBe(1);
  });
});

describe('createPlayback — resting', () => {
  it('suspends the graph once quiet for QUIET_MS, never while live or while something is queued', async () => {
    const { playback, graph, clock } = build();
    playback.live(true);
    clock.advance(QUIET_MS);
    expect(graph.suspended).toBe(0);
    playback.live(false);
    playback.audio('speaker', 1, pcm(1000));
    clock.advance(QUIET_MS);
    expect(graph.suspended).toBe(0);
    playback.clear();
    clock.advance(QUIET_MS);
    expect(graph.suspended).toBe(1);
  });

  it('disposes once', async () => {
    const { playback, graph } = build();
    await Promise.all([playback.dispose(), playback.dispose()]);
    expect(graph.closed).toBe(1);
  });
});
