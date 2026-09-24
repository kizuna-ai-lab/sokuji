/**
 * One Web Audio graph for everything the app plays (spec: "Playback"): five
 * feeds, two buses, the route table applied as a diff of gain edges, and a
 * tap of the translated speech for the echo monitor. Output leaves through
 * `<audio>` elements, as `ModernAudioPlayer`'s does today, so the browser's
 * echo canceller sees it; the context runs at 24 kHz, the system rate.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import { describeCause, reportWarning } from '../diagnostics/report';
import type { AudioTimeline } from './clipQueue';
import { createPcmTap, TAP_CHUNK_SAMPLES, type PcmTap } from './pcmTap';
import type { Bus, Edge, Feed } from './routes';

/** An output element: an `HTMLAudioElement` in the app. */
export interface SinkElement {
  srcObject: MediaProvider | null;
  readonly paused: boolean;
  setSinkId?(sinkId: string): Promise<void>;
  play(): Promise<void>;
  pause(): void;
}

/** Where the virtual bus goes on this platform. */
export type VirtualOutput =
  | { kind: 'device' }
  | { kind: 'tabs'; send(chunk: Float32Array): void }
  | { kind: 'none' };

export interface GraphDeps {
  context: AudioContext;
  /** Loads `pcm-tap-processor` into the context; its URL differs by platform. */
  addTapModule(context: AudioContext): Promise<void>;
  createTapNode(context: AudioContext, chunk: number): AudioWorkletNode;
  createSink(stream: MediaStream): SinkElement;
  /** Electron: a virtual speaker device. Extension: the tabs' virtual microphone. Web: none. */
  virtual: VirtualOutput;
}

export interface OneShot {
  /** Resolves when it has played out or been stopped. */
  readonly ended: Promise<void>;
  stop(): void;
}

export interface AudioGraph {
  timeline(feed: 'speaker' | 'participant' | 'replay'): AudioTimeline;
  /** Plays a clip at its own rate on the preview feed. */
  playOnce(audio: Float32Array, sampleRate: number): OneShot;
  /** Makes the edges exactly these; an edge to a bus this platform lacks is ignored. */
  route(edges: readonly Edge[]): void;
  /** Points each bus's element at a device; the virtual one stays silent until it has one. */
  setSinks(sinks: { real?: string; virtual?: string }): Promise<void>;
  /** Feeds a capture into the passthrough feed; returns the detach. */
  attachPassthrough(stream: MediaStream): () => void;
  /** The translated speech the graph plays (speaker, participant, replay), before any route: the echo monitor's reference. */
  readonly ttsTap: PcmTap;
  /** Resumes a suspended context and restarts an output the browser paused (autoplay). */
  resume(): Promise<void>;
  close(): Promise<void>;
}

export async function createAudioGraph(deps: GraphDeps): Promise<AudioGraph> {
  const ctx = deps.context;
  await deps.addTapModule(ctx);
  const gain = (value = 1): GainNode => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };

  // A tap is processed only when the render graph pulls it: each one ends in
  // this muted path to the destination, which the user never hears.
  const muted = gain(0);
  muted.connect(ctx.destination);
  const taps: AudioWorkletNode[] = [];
  const tapInto = (from: AudioNode, onChunk: (chunk: Float32Array) => void) => {
    const node = deps.createTapNode(ctx, TAP_CHUNK_SAMPLES);
    from.connect(node);
    node.connect(muted);
    node.port.onmessage = (event: MessageEvent<Float32Array>) => onChunk(event.data);
    taps.push(node);
  };

  const feeds: Record<Feed, GainNode> = {
    speaker: gain(), participant: gain(), replay: gain(), preview: gain(), passthrough: gain(),
  };

  // The echo reference: the translated speech, before any route (never
  // passthrough, which is the microphone itself). Built before the virtual bus.
  const tts = gain();
  feeds.speaker.connect(tts);
  feeds.participant.connect(tts);
  feeds.replay.connect(tts);
  const ttsTap = createPcmTap();
  tapInto(tts, (chunk) => ttsTap.push(chunk));

  const buses: Partial<Record<Bus, GainNode>> = {};
  const elements: Partial<Record<Bus, SinkElement>> = {};
  const toElement = (bus: Bus) => {
    const node = gain();
    const out = ctx.createMediaStreamDestination();
    node.connect(out);
    buses[bus] = node;
    elements[bus] = deps.createSink(out.stream);
  };
  toElement('real');
  const virtual = deps.virtual;
  if (virtual.kind === 'device') toElement('virtual');
  if (virtual.kind === 'tabs') {
    const node = gain();
    buses.virtual = node;
    tapInto(node, (chunk) => virtual.send(chunk));
  }

  const sinkIds: Partial<Record<Bus, string>> = {};
  const play = (bus: Bus) => {
    const element = elements[bus];
    // The virtual element plays only once it points at a virtual device:
    // otherwise the meeting's audio would play on the user's speakers.
    if (!element || !element.paused || (bus === 'virtual' && !sinkIds.virtual)) return;
    element.play().catch((error: unknown) =>
      reportWarning('AudioGraph', `The ${bus} output did not start: ${describeCause(error)}`, { dedupeKey: `graph:play:${bus}` }));
  };
  play('real');

  /** Starts a buffer into `into`; `onEnded` fires once, on its end or on stop. */
  const start = (buffer: AudioBuffer, into: AudioNode, at: number, onEnded: () => void): (() => void) => {
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(into);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      node.disconnect();
      onEnded();
    };
    node.onended = finish;
    node.start(at);
    return () => {
      if (done) return;
      node.stop();
      finish();
    };
  };

  const edges = new Map<string, { from: Feed; node: GainNode }>();

  return {
    timeline: (feed) => ({
      now: () => ctx.currentTime,
      play(pcm, at, onEnded) {
        const buffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
        return start(buffer, feeds[feed], at, onEnded);
      },
    }),

    playOnce(audio, sampleRate) {
      if (audio.length === 0) return { ended: Promise.resolve(), stop: () => {} };
      const buffer = ctx.createBuffer(1, audio.length, sampleRate);
      buffer.getChannelData(0).set(audio);
      let resolve!: () => void;
      const ended = new Promise<void>((r) => { resolve = r; });
      const stop = start(buffer, feeds.preview, ctx.currentTime, resolve);
      return { ended, stop };
    },

    route(next) {
      const wanted = new Map<string, Edge>();
      for (const edge of next) if (buses[edge.to]) wanted.set(`${edge.from}>${edge.to}`, edge);
      for (const [id, edge] of edges) {
        if (wanted.has(id)) continue;
        feeds[edge.from].disconnect(edge.node);
        edge.node.disconnect();
        edges.delete(id);
      }
      for (const [id, edge] of wanted) {
        const existing = edges.get(id);
        if (existing) {
          existing.node.gain.setValueAtTime(edge.gain, ctx.currentTime);
          continue;
        }
        const node = gain(edge.gain);
        feeds[edge.from].connect(node);
        node.connect(buses[edge.to]!);
        edges.set(id, { from: edge.from, node });
      }
    },

    async setSinks(sinks) {
      for (const bus of ['real', 'virtual'] as const) {
        const element = elements[bus];
        const id = sinks[bus];
        if (!element || id === sinkIds[bus]) continue;
        sinkIds[bus] = id;
        if (bus === 'virtual' && !id) {
          element.pause();
          continue;
        }
        try {
          await element.setSinkId?.(id ?? '');
        } catch (error) {
          reportWarning('AudioGraph', `Could not switch the ${bus} output: ${describeCause(error)}`, { dedupeKey: `graph:sink:${bus}` });
          // Forget the id on either bus, so a later setSinks with the same id
          // (the device coming back, or routing re-applying unchanged
          // settings) retries instead of short-circuiting above.
          sinkIds[bus] = undefined;
          if (bus === 'virtual') {
            // Never play the meeting's audio on whatever device the element was left on.
            element.pause();
            continue;
          }
          // The real element keeps playing wherever it was — the user still
          // hears their audio — so fall through to play() as on success.
        }
        play(bus);
      }
    },

    attachPassthrough(stream) {
      const source = ctx.createMediaStreamSource(stream);
      source.connect(feeds.passthrough);
      return () => source.disconnect();
    },

    ttsTap,

    async resume() {
      if (ctx.state === 'suspended') await ctx.resume();
      play('real');
      play('virtual');
    },

    async close() {
      for (const element of Object.values(elements)) {
        element.pause();
        element.srcObject = null;
      }
      for (const tap of taps) tap.port.onmessage = null;
      await ctx.close();
    },
  };
}
