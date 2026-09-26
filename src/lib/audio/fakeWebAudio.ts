/**
 * Just enough of Web Audio for the graph's tests under jsdom, which has none:
 * nodes record their connections, buffer sources end on a clock the test
 * advances, and sinks record the device they point at. Test support only —
 * nothing in the app imports it.
 */
let nextStream = 0;

export class FakeNode {
  readonly outputs = new Set<FakeNode>();

  connect<T extends FakeNode>(to: T): T {
    this.outputs.add(to);
    return to;
  }

  disconnect(to?: FakeNode): void {
    if (to) this.outputs.delete(to);
    else this.outputs.clear();
  }
}

export class FakeGain extends FakeNode {
  readonly gain = {
    value: 1,
    setValueAtTime(value: number): void {
      this.value = value;
    },
  };
}

export class FakeBuffer {
  private readonly data: Float32Array;

  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(_channel: number): Float32Array {
    return this.data;
  }
}

export class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;

  constructor(private readonly context: FakeAudioContext) {
    super();
  }

  start(at = 0): void {
    this.startedAt = Math.max(at, this.context.currentTime);
  }

  stop(): void {
    this.stopped = true;
  }
}

export class FakeStreamDestination extends FakeNode {
  readonly stream = { id: `stream${++nextStream}` } as unknown as MediaStream;
}

export class FakeStreamSource extends FakeNode {
  constructor(readonly mediaStream: MediaStream) {
    super();
  }
}

export class FakeWorkletNode extends FakeNode {
  readonly port: { onmessage: ((event: { data: Float32Array }) => void) | null; postMessage(): void } = {
    onmessage: null,
    postMessage() {},
  };

  constructor(readonly name: string, readonly chunk: number) {
    super();
  }

  /** Delivers a chunk as the worklet would. */
  emit(chunk: Float32Array): void {
    this.port.onmessage?.({ data: chunk });
  }
}

export class FakeAnalyser extends FakeNode {
  frequencyBinCount = 16;
  fftSize = 32;
  smoothingTimeConstant = 0;
  /** Set by a test to control what the next read returns. */
  level = 0;

  getByteFrequencyData(out: Uint8Array): void {
    out.fill(Math.round(this.level * 255));
  }
}

export class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  readonly sampleRate = 24000;
  readonly destination = new FakeNode();
  readonly sources: FakeBufferSource[] = [];
  readonly destinations: FakeStreamDestination[] = [];
  readonly streamSources: FakeStreamSource[] = [];
  readonly analysers: FakeAnalyser[] = [];
  resumed = 0;
  suspended = 0;
  /** How many times `close()` has actually closed the context (never more than one, as a real context refuses a second). */
  closed = 0;
  /** A wedged renderer (#246): while true, `resume()` is counted but never settles and leaves `state` alone. */
  stuck = false;
  private readonly stateListeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.stateListeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.stateListeners.delete(listener);
  }

  /** Something outside the graph suspends the context — a sink that vanished. */
  wedge(): void {
    this.state = 'suspended';
    this.fireStateChange();
  }

  /** The context runs again by itself. */
  recover(): void {
    this.state = 'running';
    this.fireStateChange();
  }

  private setState(next: AudioContextState): void {
    if (this.state === next) return;
    this.state = next;
    this.fireStateChange();
  }

  private fireStateChange(): void {
    for (const listener of [...this.stateListeners]) listener();
  }

  createGain(): FakeGain {
    return new FakeGain();
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource(this);
    this.sources.push(source);
    return source;
  }

  createMediaStreamDestination(): FakeStreamDestination {
    const destination = new FakeStreamDestination();
    this.destinations.push(destination);
    return destination;
  }

  createMediaStreamSource(stream: MediaStream): FakeStreamSource {
    const source = new FakeStreamSource(stream);
    this.streamSources.push(source);
    return source;
  }

  createAnalyser(): FakeAnalyser {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);
    return analyser;
  }

  /** As a real context: `state` changes only once the returned promise settles, not when it is asked. */
  async suspend(): Promise<void> {
    this.suspended += 1;
    await Promise.resolve();
    this.setState('suspended');
  }

  resume(): Promise<void> {
    this.resumed += 1;
    if (this.stuck) return new Promise<void>(() => {});
    this.setState('running');
    return Promise.resolve();
  }

  async close(): Promise<void> {
    // A real context rejects a second close() with InvalidStateError.
    if (this.state === 'closed') throw new DOMException('the context is already closed', 'InvalidStateError');
    this.closed += 1;
    this.state = 'closed';
  }

  /** Moves the audio clock, ending every started source that has played out or been stopped. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const source of this.sources) {
      const { buffer, onended, startedAt } = source;
      if (!onended || !buffer || startedAt === null) continue;
      if (source.stopped || startedAt + buffer.duration <= this.currentTime) {
        source.onended = null;
        onended();
      }
    }
  }

  /** As the graph's code sees it. */
  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

export class FakeSink {
  sinkId = '';
  paused = true;
  plays = 0;
  private source: MediaProvider | null;

  constructor(srcObject: MediaProvider | null) {
    this.source = srcObject;
  }

  get srcObject(): MediaProvider | null {
    return this.source;
  }

  /** As a browser's media element: a new source runs the load algorithm, which pauses it. */
  set srcObject(next: MediaProvider | null) {
    this.source = next;
    this.paused = true;
  }

  async setSinkId(sinkId: string): Promise<void> {
    this.sinkId = sinkId;
  }

  async play(): Promise<void> {
    this.plays += 1;
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }
}

/** Whether audio can flow from `from` to `to` through the recorded connections. */
export function reaches(from: FakeNode, to: FakeNode): boolean {
  const seen = new Set<FakeNode>();
  const walk = (node: FakeNode): boolean => {
    if (node === to) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    for (const next of node.outputs) if (walk(next)) return true;
    return false;
  };
  return walk(from);
}
