import type { Adapter, AdapterEvents, AdapterSession, SessionContext } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import type { FakeScript, ScriptBlock, ScriptStep } from './script';
import { msForText, synthPcm } from './synth';

export interface FakeFaults {
  /** `start()` rejects with this message. */
  startThrows?: string;
  /** `start()` waits this long, on the request's clock, before the session opens. */
  startDelayMs?: number;
  /** Emit `failed` this long after start, then stay silent. */
  failAfterMs?: number;
  failMessage?: string;
}

export interface FakeConfig {
  script: FakeScript;
  faults?: FakeFaults;
}

export type FakeCredentials = Record<string, never>;

/** Refs minted for `appendText` start here, above any script ref. */
const TEXT_REF_BASE = 1000;

export function createFakeAdapter(): Adapter<FakeConfig, FakeCredentials> {
  return {
    async start(request, events): Promise<AdapterSession> {
      if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
      const { script, faults } = request.config;
      if (faults?.startThrows) throw new Error(faults.startThrows);
      if (faults?.startDelayMs) await waitOnClock(request.clock, faults.startDelayMs, request.signal);
      return new FakeSession(request.clock, script, faults ?? {}, request.context, events);
    },
  };
}

/** Resolves after `ms` on `clock`, or rejects (and cancels the timer) if `signal` aborts first. */
function waitOnClock(clock: Clock, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cancel = clock.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      cancel();
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

class FakeSession implements AdapterSession {
  readonly info = { transport: 'fake' };
  private ended = false;
  private cancels: Array<() => void> = [];
  private pendingBlocks: ScriptBlock[];
  private nextTextRef = TEXT_REF_BASE;

  constructor(
    private readonly clock: Clock,
    private readonly script: FakeScript,
    faults: FakeFaults,
    private readonly context: SessionContext,
    private readonly events: AdapterEvents,
  ) {
    this.pendingBlocks = [...script.blocks];
    if (context.turns === 'auto') {
      for (const block of this.pendingBlocks) this.schedule(block, block.startAt);
      this.pendingBlocks = [];
    }
    if (faults.failAfterMs !== undefined) {
      const message = faults.failMessage ?? 'fake failure';
      this.cancels.push(clock.setTimeout(() => {
        this.emit('failed', { message });
        this.ended = true;
      }, faults.failAfterMs));
    }
  }

  appendAudio(): void {
    // The fake listens to nothing; audio in is accepted and dropped.
  }

  appendText(text: string): void {
    if (this.ended) return;
    const src = this.nextTextRef++;
    const tr = this.nextTextRef++;
    const origin = `text-${src}`;
    const translate = this.script.translate ?? ((t: string) => `«${t}»`);
    const translated = translate(text);
    this.emit('segmentOpened', { ref: src, side: 'source', origin });
    this.emit('segmentText', { ref: src, text });
    this.emit('segmentClosed', { ref: src, origin });
    this.emit('segmentOpened', { ref: tr, side: 'translation', origin });
    this.emit('segmentText', { ref: tr, text: translated });
    if (this.context.speech) {
      this.emit('audio', { ref: tr, range: [0, translated.length], pcm: synthPcm(msForText(translated)) });
    }
    this.emit('segmentClosed', { ref: tr, origin });
  }

  beginTurn(): void {}

  endTurn(): void {
    const block = this.pendingBlocks.shift();
    if (block) this.schedule(block, 0);
  }

  cancelTurn(): void {}

  async stop(): Promise<void> {
    this.ended = true;
    for (const cancel of this.cancels) cancel();
    this.cancels = [];
  }

  private schedule(block: ScriptBlock, delay: number): void {
    for (const step of block.steps) {
      this.cancels.push(this.clock.setTimeout(() => this.play(step), delay + step.at));
    }
  }

  private play(step: ScriptStep): void {
    if (this.ended) return;
    if ('open' in step) this.emit('segmentOpened', step.open);
    else if ('text' in step) this.emit('segmentText', step.text);
    else if ('close' in step) this.emit('segmentClosed', step.close);
    else if ('audio' in step) {
      if (!this.context.speech) return;
      this.emit('audio', { ref: step.audio.ref, range: step.audio.range, pcm: synthPcm(step.audio.ms) });
    } else if ('degraded' in step) this.emit('degraded', step.degraded);
    else if ('reconnecting' in step) this.emit('reconnecting', undefined);
    else if ('reconnected' in step) this.emit('reconnected', undefined);
    else if ('failed' in step) { this.emit('failed', step.failed); this.ended = true; }
    else if ('closed' in step) { this.emit('closed', step.closed); this.ended = true; }
    else if ('loading' in step) this.emit('loading', step.loading);
    else if ('busy' in step) this.emit('busy', step.busy);
    else if ('frame' in step) this.emit('frame', step.frame);
  }

  private emit<K extends keyof AdapterEvents>(kind: K, payload: Parameters<AdapterEvents[K]>[0]): void {
    if (this.ended) return;
    (this.events[kind] as (p: typeof payload) => void)(payload);
  }
}
