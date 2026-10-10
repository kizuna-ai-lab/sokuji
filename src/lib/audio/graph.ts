/**
 * One Web Audio graph for everything the app plays (spec: "Playback"): five
 * feeds, one bus per outlet and one for the meeting, the route table applied
 * as a diff of gain edges, each outlet's pan on its own path, and a
 * tap of the translated speech for the echo monitor. Output leaves through
 * `<audio>` elements, as the old `ModernAudioPlayer`'s did (deleted in plan
 * 1e-3c), so the browser's echo canceller sees it; the context runs at
 * 24 kHz, the system rate. A
 * context the renderer wedges is rebuilt on a fresh one (#246), behind the
 * same graph object.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import { realClock, type Clock } from '../contract/clock';
import { describeCause, reportError, reportWarning } from '../diagnostics/report';
import type { AudioTimeline } from './clipQueue';
import { createPcmTap, TAP_CHUNK_SAMPLES, type PcmTap } from './pcmTap';
import { OUTLET_NAMES, type OutletName, type OutletSink } from './outlets';
import type { Edge, Feed, Outlet } from './routes';

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
  /** Builds a fresh context when the current one wedges (#246); absent: no watch. */
  replaceContext?(): AudioContext;
  /** Loads `pcm-tap-processor` into the context; its URL differs by platform. */
  addTapModule(context: AudioContext): Promise<void>;
  createTapNode(context: AudioContext, chunk: number): AudioWorkletNode;
  createSink(stream: MediaStream): SinkElement;
  /** Electron: a virtual speaker device. Extension: the tabs' virtual microphone. Web: none. */
  virtual: VirtualOutput;
  /** Times the wedge watch; `realClock` by default. */
  clock?: Pick<Clock, 'setTimeout'>;
}

export interface OneShot {
  /** Resolves when it has played out or been stopped. */
  readonly ended: Promise<void>;
  stop(): void;
}

/** A bus's `AnalyserNode`, read as 0–1 levels (spec: "Meters"). */
export interface BusMeter {
  read(): Float32Array;
}

export interface AudioGraph {
  /** A timeline playing into a feed: the clip queues' and the passthrough stream's. */
  timeline(feed: 'speaker' | 'participant' | 'replay' | 'passthrough'): AudioTimeline;
  /** Plays a clip at its own rate on the preview feed; the outlet it is routed to pans it. */
  playOnce(audio: Float32Array, sampleRate: number): OneShot;
  /** Makes the edges exactly these; an edge to a bus this platform lacks is ignored. */
  route(edges: readonly Edge[]): void;
  /** Points each element at its device and gives each outlet its pan; the virtual one stays silent until it has a device. A bus switches one device at a time and ends on the last one asked for; the promise settles once this call's switches have run, and never for a switch that never settles. */
  setSinks(sinks: { virtual?: string } & Record<OutletName, OutletSink>): Promise<void>;
  /** The translated speech the graph plays (speaker, participant, replay), before any route: the echo monitor's reference. */
  readonly ttsTap: PcmTap;
  /**
   * An `AnalyserNode` on `bus`, pulled through the muted path like a tap;
   * null where this platform lacks the bus. The same object every time it is
   * asked for, and it keeps reading across a rebuild (#246).
   */
  meter(bus: Outlet): BusMeter | null;
  /** Resumes a suspended context (once any suspend still in flight has landed) and restarts an output the browser paused (autoplay). */
  resume(): Promise<void>;
  /** Pauses rendering while nothing plays; `resume()` undoes it. */
  suspend(): Promise<void>;
  /**
   * Called once a wedged context has been replaced, before it is closed:
   * whatever was scheduled on it is lost, and the timelines already read the
   * new context's clock. Returns the unsubscribe.
   */
  onReset(listener: () => void): () => void;
  close(): Promise<void>;
}

/** How long a context may sit in a 'suspended' the graph did not ask for before it is resumed. */
export const WEDGE_GRACE_MS = 250;
/** How long a resume may take to land before the context is rebuilt. */
export const RESUME_DEADLINE_MS = 1_500;
/** Rebuilds allowed until a context reaches 'running' again. */
export const MAX_REBUILDS = 3;
/** How long `close()` waits for the context's own close: a wedged one may never settle it (#246). */
export const CLOSE_WAIT_MS = 1_000;
/** How long a bus's device switch holds the next one: a wedged sink may never settle `setSinkId` (#246). */
export const SINK_SWITCH_DEADLINE_MS = 1_500;

interface Built {
  ctx: AudioContext;
  /** Where every tap (and meter) ends so the render graph pulls it; the user never hears it. */
  muted: GainNode;
  feeds: Record<Feed, GainNode>;
  buses: Partial<Record<Outlet, GainNode>>;
  /** The stream each output element plays, per bus that has an element. */
  outs: Partial<Record<Outlet, MediaStreamAudioDestinationNode>>;
  taps: AudioWorkletNode[];
  /** One per bus a meter has been asked for (`metered`); a rebuild recreates them. */
  analysers: Partial<Record<Outlet, AnalyserNode>>;
  /** One per outlet, in the path only while the outlet has a channel. */
  panners: Record<OutletName, StereoPannerNode>;
  /** What each outlet's path is wired for right now. */
  wired: Partial<Record<OutletName, -1 | 1>>;
}

function gainOn(ctx: AudioContext, value = 1): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

export async function createAudioGraph(deps: GraphDeps): Promise<AudioGraph> {
  await deps.addTapModule(deps.context);

  const ttsTap = createPcmTap();
  const virtual = deps.virtual;
  /** Created by the first build; a rebuild's swap points them at the new streams, so they keep their devices. */
  const elements: Partial<Record<Outlet, SinkElement>> = {};
  /** Buses a meter has been asked for; a build wires an analyser for each. */
  const metered = new Set<Outlet>();
  /** Each outlet's pan as last asked for; a rebuild wires it again. */
  const pans: Partial<Record<OutletName, -1 | 1>> = {};
  /**
   * Wires an outlet's path for a pan: bus → panner → stream while it has one,
   * bus → stream otherwise. A centred clip never crosses a panner: at 0 a
   * StereoPannerNode plays a mono clip at -3 dB in each ear.
   */
  const wirePan = (built: Built, name: OutletName, pan: -1 | 1 | undefined): void => {
    const node = built.buses[name]!;
    const out = built.outs[name]!;
    const panner = built.panners[name];
    if (built.wired[name] === pan) return;
    if (built.wired[name] === undefined) node.disconnect(out);
    else { node.disconnect(panner); panner.disconnect(out); }
    if (pan === undefined) {
      node.connect(out);
    } else {
      panner.pan.value = pan;
      node.connect(panner);
      panner.connect(out);
    }
    built.wired[name] = pan;
  };
  /** Wires `bus`'s analyser once, pulled through the muted path like a tap. */
  const wireAnalyser = (built: Built, bus: Outlet): void => {
    const busNode = built.buses[bus];
    if (!busNode || built.analysers[bus]) return;
    const analyser = built.ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;
    busNode.connect(analyser);
    analyser.connect(built.muted);
    built.analysers[bus] = analyser;
  };

  /** Everything that lives on a context: the first one's, and each replacement's (#246). */
  const build = (ctx: AudioContext): Built => {
    const gain = (value = 1) => gainOn(ctx, value);

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
    tapInto(tts, (chunk) => ttsTap.push(chunk));

    const buses: Partial<Record<Outlet, GainNode>> = {};
    const outs: Partial<Record<Outlet, MediaStreamAudioDestinationNode>> = {};
    const panners = {} as Record<OutletName, StereoPannerNode>;
    const toElement = (bus: Outlet) => {
      const node = gain();
      const out = ctx.createMediaStreamDestination();
      node.connect(out);
      buses[bus] = node;
      outs[bus] = out;
      // Only the first build makes the elements. A rebuild leaves them alone
      // until its swap, so a build that throws leaves them where they were.
      elements[bus] ??= deps.createSink(out.stream);
    };
    for (const name of OUTLET_NAMES) {
      toElement(name);
      panners[name] = ctx.createStereoPanner();
    }
    if (virtual.kind === 'device') toElement('virtual');
    if (virtual.kind === 'tabs') {
      const node = gain();
      buses.virtual = node;
      tapInto(node, (chunk) => virtual.send(chunk));
    }

    const built: Built = { ctx, muted, feeds, buses, outs, taps, analysers: {}, panners, wired: {} };
    for (const name of OUTLET_NAMES) wirePan(built, name, pans[name]);
    for (const bus of metered) wireAnalyser(built, bus);
    return built;
  };
  let current = build(deps.context);

  // `requested`: what `setSinks` was last asked for, per bus. `applied`: what
  // `setSinkId` actually resolved to. The virtual element plays only once its
  // switch has *landed* on the id currently requested — not merely started —
  // so a `resume()` racing a pending switch never starts it on whatever
  // device the element happened to be on before (F1). A bus's switches run
  // one at a time (`switchBus` below), so only the latest request's switch
  // sets `applied`, or forgets `requested` when it fails.
  const requested: Partial<Record<Outlet, string>> = {};
  const applied: Partial<Record<Outlet, string>> = {};
  // An output that will not start is reported once per failing streak, not once per chunk/resume.
  const playFailing: Partial<Record<Outlet, boolean>> = {};
  const play = (bus: Outlet) => {
    const element = elements[bus];
    if (!element || !element.paused) return;
    if (bus === 'virtual' && (applied.virtual === undefined || applied.virtual !== requested.virtual)) return;
    element.play().then(
      () => { playFailing[bus] = false; },
      (error: unknown) => {
        // A pending play() that pause() interrupted (the virtual device lost,
        // close()) rejects with AbortError: not a failure to report (F6).
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!playFailing[bus]) reportWarning('AudioGraph', `The ${bus} output did not start: ${describeCause(error)}`, { dedupeKey: `graph:play:${bus}` });
        playFailing[bus] = true;
      },
    );
  };
  for (const name of OUTLET_NAMES) play(name);

  /** Starts a buffer into `into`; `onEnded` fires once, on its end or on stop. */
  const start = (ctx: AudioContext, buffer: AudioBuffer, into: AudioNode, at: number, onEnded: () => void): (() => void) => {
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
  /** What `route` was last asked for: a rebuild applies it to the new context. */
  let lastRoute: readonly Edge[] = [];
  const applyRoute = (next: readonly Edge[]) => {
    const { ctx, feeds, buses } = current;
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
      const node = gainOn(ctx, edge.gain);
      feeds[edge.from].connect(node);
      node.connect(buses[edge.to]!);
      edges.set(id, { from: edge.from, node });
    }
  };

  // A context that keeps refusing to resume is reported once per failing streak, not on every call.
  let resumeFailing = false;
  /** `close()` runs once: every call while it is in flight, or after, gets the same settled promise. */
  let closing: Promise<void> | null = null;
  /** A `suspend()` still in flight: the context reads 'running' until it lands, so a `resume()` waits for it before looking. */
  let suspending: Promise<void> | null = null;

  const clock = deps.clock ?? realClock;
  const resets = new Set<() => void>();
  /** The graph's own `suspend()` landed and no `resume()` was asked since: this 'suspended' is ours, not a wedge. */
  let resting = false;
  let cancelGrace: (() => void) | null = null;
  let cancelDeadline: (() => void) | null = null;
  let rebuilds = 0;
  let rebuilding: Promise<void> | null = null;

  /**
   * The turn each bus's next switch waits for. One `setSinkId` at a time per
   * element: two in flight could land in either order and leave the element
   * on the older device. A switch whose turn comes after a newer request, or
   * after `close()`, never reaches the element; a stale switch's outcome,
   * success or failure, leaves the newer request's records and the element
   * alone. A switch that has not settled after `SINK_SWITCH_DEADLINE_MS`
   * stops holding the next one; if it then lands after a newer switch, the
   * bus switches to the newest request again.
   */
  const switching: Partial<Record<Outlet, Promise<void>>> = {};
  const switchBus = (bus: Outlet, element: SinkElement, id: string | undefined): Promise<void> => {
    const stale = () => closing !== null || requested[bus] !== id;
    let turnOver!: () => void;
    const over = new Promise<void>((resolve) => { turnOver = resolve; });
    const run = async () => {
      if (stale()) return;
      let overran = false;
      const cancel = clock.setTimeout(() => { overran = true; turnOver(); }, SINK_SWITCH_DEADLINE_MS);
      try {
        await element.setSinkId?.(id ?? '');
      } catch (error) {
        cancel();
        if (stale()) return;
        reportWarning('AudioGraph', `Could not switch the ${bus} output: ${describeCause(error)}`, { dedupeKey: `graph:sink:${bus}` });
        // Forget the id on either bus, so a later setSinks with the same id
        // (the device coming back, or routing re-applying unchanged
        // settings) retries instead of short-circuiting.
        requested[bus] = undefined;
        if (bus === 'virtual') {
          // Never play the meeting's audio on whatever device the element was left on.
          element.pause();
          return;
        }
        // An outlet's element keeps playing wherever it was — the user still
        // hears their audio — so it plays as on success.
        play(bus);
        return;
      }
      cancel();
      if (stale()) {
        // Past its deadline the next switch ran beside this one, and may have
        // landed first: this landing moved the element back to an older device.
        // Switch to the newest request again.
        if (overran && closing === null) {
          const newest = requested[bus];
          if (bus === 'virtual') {
            // Never play the meeting's audio on a device it was not asked for (F1).
            applied.virtual = undefined;
            element.pause();
            if (newest === undefined) return;
          }
          void switchBus(bus, element, newest);
        }
        return;
      }
      applied[bus] = id;
      play(bus);
    };
    // `run` never rejects, so the chain never breaks. The next switch waits
    // for this one's turn: its end, or the deadline when it hangs.
    const done = (switching[bus] ?? Promise.resolve()).then(run).finally(turnOver);
    switching[bus] = over;
    return done;
  };

  const clearWatch = () => {
    cancelGrace?.();
    cancelDeadline?.();
    cancelGrace = cancelDeadline = null;
  };
  // #246: a context the renderer wedged — a sink that vanished (Bluetooth,
  // USB) — stays 'suspended'; resume() may never settle and setSinkId can
  // report success on it. The only way back is a new context.
  const armDeadline = () => {
    if (cancelDeadline || !deps.replaceContext) return;
    cancelDeadline = clock.setTimeout(() => {
      cancelDeadline = null;
      if (current.ctx.state !== 'running' && !resting) void rebuild();
    }, RESUME_DEADLINE_MS);
  };
  const onState = () => {
    const { ctx } = current;
    if (ctx.state === 'running') {
      clearWatch();
      rebuilds = 0;
      return;
    }
    if (ctx.state !== 'suspended' || resting || suspending || cancelGrace || cancelDeadline) return;
    cancelGrace = clock.setTimeout(() => {
      cancelGrace = null;
      if (current.ctx.state !== 'suspended' || resting) return;
      current.ctx.resume().catch((error: unknown) => reportWarning('AudioGraph', `The audio context did not resume: ${describeCause(error)}`, { dedupeKey: 'graph:resume' }));
      armDeadline();
    }, WEDGE_GRACE_MS);
  };
  const watch = (ctx: AudioContext) => { if (deps.replaceContext) ctx.addEventListener('statechange', onState); };
  watch(current.ctx);

  const rebuild = (): Promise<void> => {
    rebuilding ??= (async () => {
      if (closing || !deps.replaceContext || rebuilds >= MAX_REBUILDS) return;
      rebuilds += 1;
      clearWatch();
      // Everything that can fail comes before the old context is touched: a
      // rebuild that fails leaves it exactly as it was, watched, its taps live.
      let ctx: AudioContext | undefined;
      let next: Built;
      try {
        ctx = deps.replaceContext();
        await deps.addTapModule(ctx);
        if (closing) {
          // The graph closed while the module loaded.
          void ctx.close().catch(() => {});
          return;
        }
        next = build(ctx);
      } catch (error) {
        if (ctx) void ctx.close().catch(() => {});
        reportError('AudioGraph', `The audio output could not be rebuilt: ${describeCause(error)}`, { cause: error, dedupeKey: 'graph:rebuild-failed' });
        return;
      }
      const old = current;
      old.ctx.removeEventListener('statechange', onState);
      for (const tap of old.taps) tap.port.onmessage = null;
      // Swap first: from here every queue's clock is the new context's.
      current = next;
      for (const bus of Object.keys(elements) as Outlet[]) {
        const element = elements[bus];
        const out = next.outs[bus];
        if (element && out) element.srcObject = out.stream;
      }
      watch(next.ctx);
      // A rest of the old context's (it may have run again, and rested, while the module loaded) is not the new one's.
      resting = false;
      clearWatch(); // a resume() asked while the module loaded armed a deadline on the old context
      edges.clear();
      applyRoute(lastRoute);
      // Then the listeners: the playback clears its queues against the new
      // clock. Whatever it scheduled while the module loaded sat on the dead
      // context — its frozen currentTime became a queue's tail, which would
      // hold every later clip that long and drop every passthrough chunk.
      for (const listener of [...resets]) {
        try { listener(); } catch (error) { reportError('AudioGraph', `A reset listener threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'graph:reset-listener' }); }
      }
      reportWarning('AudioGraph', `The audio output stopped responding and was rebuilt (attempt ${rebuilds} of ${MAX_REBUILDS})`, { dedupeKey: 'graph:rebuild' });
      for (const bus of Object.keys(elements) as Outlet[]) play(bus);
      // A wedged context may never settle its close(), as it may never settle
      // resume(): it is abandoned, never awaited, so recovery cannot hang on it.
      void old.ctx.close().catch(() => {});
    })().finally(() => { rebuilding = null; });
    return rebuilding;
  };

  // One `BusMeter` per bus ever asked for; its `read()` looks up `current`
  // each time, so it keeps reading across a rebuild (`metered` above is what
  // makes `build()` recreate the analyser it reads).
  const meters = new Map<Outlet, BusMeter>();
  const readMeter = (bus: Outlet): Float32Array => {
    const analyser = current.analysers[bus];
    if (!analyser) return new Float32Array(0);
    const raw = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(raw);
    const levels = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) levels[i] = raw[i] / 255;
    return levels;
  };

  return {
    timeline: (feed) => ({
      now: () => current.ctx.currentTime,
      play(pcm, at, onEnded) {
        const { ctx, feeds } = current;
        const buffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
        return start(ctx, buffer, feeds[feed], at, onEnded);
      },
    }),

    playOnce(audio, sampleRate) {
      if (audio.length === 0) return { ended: Promise.resolve(), stop: () => {} };
      const { ctx, feeds } = current;
      const buffer = ctx.createBuffer(1, audio.length, sampleRate);
      buffer.getChannelData(0).set(audio);
      let resolve!: () => void;
      const ended = new Promise<void>((r) => { resolve = r; });
      const stop = start(ctx, buffer, feeds.preview, ctx.currentTime, resolve);
      return { ended, stop };
    },

    route(next) {
      lastRoute = next;
      applyRoute(next);
    },

    meter(bus) {
      if (!current.buses[bus]) return null;
      metered.add(bus);
      wireAnalyser(current, bus);
      let meter = meters.get(bus);
      if (!meter) {
        meter = { read: () => readMeter(bus) };
        meters.set(bus, meter);
      }
      return meter;
    },

    async setSinks(sinks) {
      const switches: Promise<void>[] = [];
      for (const bus of ['virtual', ...OUTLET_NAMES] as const) {
        const element = elements[bus];
        if (!element) continue;
        if (bus !== 'virtual') {
          const pan = sinks[bus].pan;
          if (pans[bus] !== pan) {
            pans[bus] = pan;
            wirePan(current, bus, pan);
          }
        }
        const id = bus === 'virtual' ? sinks.virtual : sinks[bus].device;
        if (id === requested[bus]) continue;
        requested[bus] = id;
        if (bus === 'virtual') {
          // Never play the meeting's audio on whatever device the element is
          // on while a switch is pending or absent (F1).
          applied.virtual = undefined;
          element.pause();
          if (!id) continue;
          if (!element.setSinkId) {
            reportWarning('AudioGraph', 'Could not switch the virtual output: it cannot choose its device', { dedupeKey: 'graph:sink:virtual' });
            requested.virtual = undefined;
            continue;
          }
        }
        switches.push(switchBus(bus, element, id));
      }
      await Promise.all(switches);
    },

    ttsTap,

    async resume() {
      // A resume never loses to a suspend in flight: let it land, then undo it.
      if (suspending) await suspending;
      resting = false;
      const { ctx } = current;
      if (ctx.state === 'suspended') {
        // A resume that never lands is a wedge too (#246); the deadline rebuilds it.
        armDeadline();
        try {
          const resumed = ctx.resume().then(() => true);
          const landed = await (deps.replaceContext
            ? Promise.race([resumed, new Promise<boolean>((resolve) => { clock.setTimeout(() => resolve(false), RESUME_DEADLINE_MS); })])
            : resumed);
          // A resume the deadline outran did not land: the failing streak, if any, goes on.
          if (landed) resumeFailing = false;
        } catch (error) {
          if (!resumeFailing) reportWarning('AudioGraph', `The audio context did not resume: ${describeCause(error)}`, { dedupeKey: 'graph:resume' });
          resumeFailing = true;
        }
      }
      for (const bus of Object.keys(elements) as Outlet[]) play(bus);
    },

    suspend() {
      // One at a time: a call while one is in flight shares it (the context still reads 'running').
      if (suspending) return suspending;
      const pending = (async () => {
        try {
          const { ctx } = current;
          if (ctx.state === 'running') {
            await ctx.suspend();
            resting = true;
          }
        } catch (error) {
          reportWarning('AudioGraph', `The audio context did not suspend: ${describeCause(error)}`, { dedupeKey: 'graph:suspend' });
        }
      })();
      suspending = pending;
      void pending.then(() => { if (suspending === pending) suspending = null; });
      return pending;
    },

    onReset(listener) {
      resets.add(listener);
      return () => { resets.delete(listener); };
    },

    close() {
      // Idempotent: a second close() while the first is still in flight (or
      // after it settled) returns the same promise instead of asking the
      // context to close twice, which a real context refuses.
      closing ??= (async () => {
        clearWatch();
        if (deps.replaceContext) current.ctx.removeEventListener('statechange', onState);
        for (const element of Object.values(elements)) {
          element.pause();
          element.srcObject = null;
        }
        for (const tap of current.taps) tap.port.onmessage = null;
        // A wedged context may never settle its close(), as the rebuild's dead
        // one may not: wait for it at most CLOSE_WAIT_MS, so it never holds a close.
        let cancelWait = () => {};
        const waited = new Promise<void>((resolve) => { cancelWait = clock.setTimeout(resolve, CLOSE_WAIT_MS); });
        try {
          await Promise.race([current.ctx.close(), waited]);
        } finally {
          cancelWait();
        }
      })();
      return closing;
    },
  };
}
