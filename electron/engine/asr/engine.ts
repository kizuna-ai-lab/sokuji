/**
 * Mark-driven ASR (port of asr_engine.AsrEngine). The client's VAD owns segmentation and sends start/end/cancel marks;
 * the engine buffers audio between them and transcribes (offline), or feeds a stream continuously or per utterance
 * (streaming). Python ran every step on its one event loop, so audio and marks were handled strictly in arrival order;
 * here the same order is kept by doing every buffer update synchronously when the frame or mark arrives:
 *
 * - offline: a cut snapshots its segment at once and queues the transcription on a serial chain, so frames keep
 *   arriving (and landing in the right segment) while an earlier segment is still being transcribed; results come
 *   out in cut order;
 * - streaming: frames and marks go into one queue that a single loop drains in order, as Python's run_stream did.
 */
import { makeBackend, type AsrResult } from '../backends';
import { measureRtf } from '../accel/bench';
import { ledgerRelease } from '../accel/ledger';
import { loadMeasured } from '../accel/loader';
import { probe } from '../accel/probe';
import { resolve } from '../accel/resolve';
import { seams } from '../accel/seams';
import type { Plan } from '../planner';
import type { AsrStreamLike } from './backend';
import './backend';
import { SRC_RATE, downsampleInt16ToF32_16k } from './dsp';

export const TARGET_RATE = 16000;
/** Gated-streaming pre-roll: the client's VAD confirms speech 0.3–0.6 s after the onset; replay this much. */
export const PREROLL_SAMPLES = Math.trunc(0.7 * TARGET_RATE);
/** The offline pre-roll (absorbs start-mark skew). */
export const RING_SAMPLES = Math.trunc(0.7 * TARGET_RATE);
/** Backstop against a lost end mark (the client cuts at 20 s). */
export const OFFLINE_CAP_SAMPLES = 30 * TARGET_RATE;

export type AsrEvent = Record<string, unknown>;
export type Send = (msg: AsrEvent) => Promise<void>;
type Mode = 'always_stream' | 'per_utterance';
type QueueItem = Uint8Array | { mark: string } | null;

/** What the engine needs of a backend: the batch half, and the stream half for a streaming one. */
export interface AsrBackendLike {
  readonly STREAMING?: boolean;
  transcribe(samples: Float32Array, language: string | null): Promise<AsrResult>;
  openStream?(language: string | null): AsrStreamLike;
  unload?(): Promise<void> | void;
}

/** What init reads, patched by tests (Python's monkeypatching of accel). */
const DEFAULTS = {
  resolve: (modelId: string, override: string, pin: string | null): Promise<Plan[]> => resolve(modelId, override, null, pin),
  loadMeasured: (plans: readonly Plan[], stage: string) => loadMeasured(plans, stage) as Promise<[unknown, Plan, string | null, number | null]>,
  measureRtf: (backend: unknown, plan: Plan, modelId: string) => measureRtf(backend, plan, modelId, probe()),
  makeBackend: (name: string): unknown => makeBackend(name),
  now: (): number => performance.now(),
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string): void => seams.log(level, message),
};
export const engineSeams = { ...DEFAULTS };
export function restoreEngineSeams(): void {
  Object.assign(engineSeams, DEFAULTS);
}

/** Python's queue.Queue for the streaming loop: put never blocks; get waits for the next item. */
export class AudioQueue {
  private readonly items: QueueItem[] = [];
  private readonly waiters: Array<(item: QueueItem) => void> = [];
  put(item: QueueItem): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }
  get(): Promise<QueueItem> {
    if (this.items.length > 0) return Promise.resolve(this.items.shift() as QueueItem);
    return new Promise((resolveItem) => this.waiters.push(resolveItem));
  }
  getNowait(): QueueItem | undefined {
    return this.items.shift();
  }
  size(): number {
    return this.items.length;
  }
  empty(): boolean {
    return this.items.length === 0;
  }
}

const concat = (parts: readonly Float32Array[], total?: number): Float32Array => {
  const out = new Float32Array(total ?? parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const isMark = (item: QueueItem): item is { mark: string } => item !== null && !(item instanceof Uint8Array);

export class AsrEngine {
  backend: AsrBackendLike | null = null;
  language: string | null = null;
  resolved: Record<string, unknown> | null = null;
  srcRate = SRC_RATE;
  streaming = false;

  // Offline (mark-driven) segmentation.
  inSpeech = false;
  seg: Float32Array[] = [];
  segLen = 0;
  /** First sample (16 kHz, since init) of the open segment. */
  segStart = 0;
  fedTotal = 0;
  /** The pre-roll ring, fed only while not in speech. */
  ring: Float32Array[] = [];
  ringLen = 0;
  /** The transcriptions queued by cuts, one after another. */
  private transcriptions: Promise<unknown> = Promise.resolve();

  // Streaming.
  preroll: Float32Array[] = [];
  prerollLen = 0;
  mode: Mode = 'always_stream';
  stream: AsrStreamLike | null = null;
  /** Text drained since the last cut (the always-stream partial). */
  pending = '';
  /** The per-utterance partial. */
  partialAcc: string[] = [];
  uttStartSample = 0;
  sampleCursor = 0;
  /** The gated mode's per-utterance backstop counter. */
  uttFed = 0;
  /** Speech in the current stream (the 20 s run-on cap). */
  speechSamples = 0;
  stop = false;
  audioQ: AudioQueue | null = null;
  private closing = false;
  private loop: Promise<void> | null = null;

  async init(modelId: string | null = null, language = '', sampleRate = SRC_RATE, device = 'auto', pin: string | null = null): Promise<number> {
    const t0 = engineSeams.now();
    await this.close();                  // free the previous model before loading the next (one engine per process)
    this.srcRate = Math.trunc(Number(sampleRate));
    this.streaming = false;
    this.resetOffline();
    const id = modelId || 'sense-voice';
    const plans = await engineSeams.resolve(id, device || 'auto', pin);
    const [backend, plan, notice, mem] = await engineSeams.loadMeasured(plans, 'asr');
    this.backend = backend as AsrBackendLike;
    this.language = language || null;
    const rtf = await engineSeams.measureRtf(this.backend, plan, id);
    this.resolved = { backend: plan.backend, device: plan.device, computeType: plan.computeType };
    if (rtf !== null) this.resolved.rtf = Math.round(rtf * 1000) / 1000;
    if (mem !== null) this.resolved.memoryBytes = mem;
    if (notice) this.resolved.fallbackReason = notice;
    engineSeams.log('info', `[engine] ASR ready: model=${id} backend=${plan.backend} device=${plan.device} compute=${plan.computeType}`
      + (rtf ? ` rtf=${rtf.toFixed(3)} (~${Math.round(1 / rtf)}x realtime)` : '') + `  [requested device=${device || 'auto'}]`);
    return Math.trunc(engineSeams.now() - t0);
  }

  private resetOffline(): void {
    this.inSpeech = false;
    this.seg = [];
    this.segLen = 0;
    this.segStart = 0;
    this.fedTotal = 0;
    this.ring = [];
    this.ringLen = 0;
  }

  /**
   * Frees the loaded model. Idempotent; run at the start of each init and when the session's connection closes. A
   * running streaming loop is stopped first (after the item it is on), then the open stream is aborted.
   */
  async close(): Promise<void> {
    ledgerRelease('asr');
    this.stop = true;
    this.closing = true;
    this.audioQ?.put(null);
    if (this.loop !== null) await this.loop;
    this.loop = null;
    const stream = this.stream;
    this.stream = null;
    if (stream !== null) {
      try {
        stream.abort();
      } catch {
        // best effort
      }
    }
    const backend = this.backend;
    this.backend = null;
    if (backend !== null) {
      try {
        await backend.unload?.();
      } catch {
        // best effort
      }
    }
    this.resetOffline();
    this.streaming = false;
  }

  /**
   * Offline audio: rolls into the pre-roll ring while not in speech, else extends the open segment. The buffers change
   * now; the promise resolves with a backstop cut's result, if this frame triggered one.
   */
  feed(bytes: Uint8Array): Promise<AsrEvent[]> {
    const x = downsampleInt16ToF32_16k(bytes, this.srcRate);
    this.fedTotal += x.length;
    if (!this.inSpeech) {
      this.ring.push(x);
      this.ringLen += x.length;
      while (this.ring.length > 1 && this.ringLen - this.ring[0].length >= RING_SAMPLES) this.ringLen -= this.ring.shift()!.length;
      return Promise.resolve([]);
    }
    this.seg.push(x);
    this.segLen += x.length;
    if (this.segLen >= OFFLINE_CAP_SAMPLES) {
      // A lost end mark: transcribe what there is and stay in speech.
      const out = this.cut();
      this.segStart = this.fedTotal;
      return out;
    }
    return Promise.resolve([]);
  }

  /** A client VAD edge. Offline: acts now; the promise resolves with an end mark's result. Streaming: queued in order. */
  mark(event: string): Promise<AsrEvent[]> {
    if (this.streaming) {
      this.audioQ!.put({ mark: event });
      return Promise.resolve([]);
    }
    if (event === 'start') {
      this.seg = [...this.ring];
      this.segLen = this.ringLen;
      this.segStart = Math.max(0, this.fedTotal - this.ringLen);
      this.ring = [];
      this.ringLen = 0;
      this.inSpeech = true;
    } else if (event === 'end') {
      if (!this.inSpeech) return Promise.resolve([]);
      this.inSpeech = false;
      this.ring = [];                      // never re-seed with this utterance's tail
      this.ringLen = 0;
      return this.cut();
    } else if (event === 'cancel') {
      this.inSpeech = false;
      this.seg = [];
      this.segLen = 0;
      this.ring = [];
      this.ringLen = 0;
    }
    return Promise.resolve([]);
  }

  /** Takes the open segment now and queues its transcription behind any earlier one; at most one result. */
  private cut(): Promise<AsrEvent[]> {
    if (this.seg.length === 0) return Promise.resolve([]);
    const samples = concat(this.seg, this.segLen);
    const start = this.segStart;
    this.seg = [];
    this.segLen = 0;
    const backend = this.backend;
    const language = this.language;
    const job = this.transcriptions.then(async (): Promise<AsrEvent[]> => {
      if (backend === null) return [];
      const t0 = engineSeams.now();
      const text = (await backend.transcribe(samples, language)).text;
      if (!text) return [];
      return [{
        type: 'result', text, startSample: Math.trunc(start),
        durationMs: Math.trunc((samples.length / TARGET_RATE) * 1000),
        recognitionTimeMs: Math.trunc(engineSeams.now() - t0),
      }];
    });
    this.transcriptions = job.catch(() => {});
    return job;
  }

  /** Ends an open segment; resolves once every queued transcription is done, with the last cut's result. */
  async flush(): Promise<AsrEvent[]> {
    if (this.inSpeech) return this.mark('end');
    await this.transcriptions;
    return [];
  }

  // ── Streaming (STREAMING backends only) ──

  isStreaming(): boolean {
    return Boolean(this.backend?.STREAMING);
  }

  async initStreaming(modelId: string | null = null, language = '', sampleRate = SRC_RATE, device = 'auto', pin: string | null = null): Promise<void> {
    await this.close();
    this.srcRate = Math.trunc(Number(sampleRate));
    this.inSpeech = false;
    const [backend, plan, notice, mem] = await this.resolveStreamingBackend(modelId, device, pin);
    this.backend = backend as AsrBackendLike;
    this.resolved = { backend: plan.backend, device: plan.device, computeType: plan.computeType };
    if (mem !== null) this.resolved.memoryBytes = mem;
    if (notice) this.resolved.fallbackReason = notice;
    this.language = language || null;
    this.audioQ = new AudioQueue();
    this.streaming = true;               // only once the queue exists
    this.closing = false;
    this.mode = 'always_stream';
    this.stream = this.openStream();     // always-stream: one long-lived session
    this.preroll = [];
    this.prerollLen = 0;
    this.pending = '';
    this.partialAcc = [];
    this.uttStartSample = 0;
    this.sampleCursor = 0;
    this.uttFed = 0;
    this.speechSamples = 0;
    this.stop = false;
  }

  /** Every stream (re)open forwards the user's source language: init, endpoint reopen, salvage. */
  openStream(): AsrStreamLike {
    return this.backend!.openStream!(this.language);
  }

  private prerollPush(samples: Float32Array): void {
    this.preroll.push(samples);
    this.prerollLen += samples.length;
    while (this.preroll.length > 1 && this.prerollLen - this.preroll[0].length >= PREROLL_SAMPLES) this.prerollLen -= this.preroll.shift()!.length;
  }

  private prerollTake(): Float32Array | null {
    if (this.preroll.length === 0) return null;
    const out = concat(this.preroll, this.prerollLen);
    this.preroll = [];
    this.prerollLen = 0;
    return out;
  }

  /** Hands raw audio to the streaming loop; nothing to send now (the loop pushes its own events). */
  feedStream(bytes: Uint8Array | null): AsrEvent[] {
    this.audioQ!.put(bytes);
    return [];
  }

  /** The streaming loop: drains the queue in order, owns the stream's lifecycle, pushes partials and results. */
  runStream(send: Send): Promise<void> {
    const run = this.runLoop(this.audioQ!, send);
    this.loop = run.catch(() => {});
    return run;
  }

  private async runLoop(queue: AudioQueue, send: Send): Promise<void> {
    while (!this.stop) {
      const data = await queue.get();
      if (data === null) break;
      try {
        await this.dispatch(send, data);
      } catch (e) {
        // One bad item must not end the session's transcription.
        engineSeams.log('error', `[engine] ASR stream: ${e instanceof Error ? e.message : String(e)}`);
        await send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }
    // The end of the input (not a close, and only for the stream this loop drove): flush what the stream holds.
    if (this.closing || queue !== this.audioQ) return;
    if (this.mode === 'always_stream') {
      if (this.stream !== null && this.speechSamples > 0) {
        let final = '';
        try {
          final = await this.stream.end();
        } catch {
          final = '';
        }
        this.stream = null;
        if (final.trim()) await send(this.resultEvent(final));
      }
    } else if (this.stream !== null) {
      await this.finalize(send);
    }
  }

  /** One queued item: a mark goes to the mode's mark handler, audio to the mode's drive. */
  async dispatch(send: Send, data: Uint8Array | { mark: string }): Promise<void> {
    if (isMark(data)) {
      if (this.mode === 'always_stream') await this.markAlways(send, data.mark);
      else await this.markUtterance(send, data.mark);
      return;
    }
    if (this.mode === 'always_stream') await this.driveAlways(send, data);
    else await this.driveUtterance(send, data);
  }

  /** Always-stream: start/cancel toggle speech; end cuts once the stream has seen speech. */
  async markAlways(send: Send, ev: string): Promise<void> {
    if (ev === 'start') {
      this.inSpeech = true;
    } else if (ev === 'cancel') {
      this.inSpeech = false;
      this.speechSamples = 0;            // a cancelled stretch feeds neither the run-on cap nor the closing flush
    } else if (ev === 'end') {
      this.inSpeech = false;
      if (this.stream !== null && this.speechSamples > 0) await this.endAndReopen(send);
    }
  }

  /** Gated mode: marks open and close the session; a faster-than-realtime utterance returns to always-stream. */
  async markUtterance(send: Send, ev: string): Promise<void> {
    if (ev === 'start') {
      if (this.stream !== null) {        // a stale stream from any source
        try {
          this.stream.abort();
        } catch {
          // discarded either way
        }
        this.stream = null;
        this.partialAcc = [];
      }
      this.uttStartSample = Math.max(0, this.sampleCursor - this.prerollLen);
      this.stream = this.openStream();
      const pre = this.prerollTake();
      if (pre !== null) await this.stream.feed(pre);
      this.inSpeech = true;
      this.uttFed = 0;
      return;
    }
    if (ev === 'cancel') {
      if (this.stream !== null) {
        try {
          this.stream.abort();
        } catch {
          // discarded either way
        }
        this.stream = null;
        this.partialAcc = [];
      }
      this.inSpeech = false;
      this.preroll = [];
      this.prerollLen = 0;
      return;
    }
    if (ev === 'end') {
      this.inSpeech = false;
      if (this.stream === null) return;
      const [durMs, recMs] = await this.finalize(send);
      this.preroll = [];
      this.prerollLen = 0;
      if (recMs < durMs) {
        engineSeams.log('info', '[engine] streaming caught up — back to always-stream mode');
        this.mode = 'always_stream';
        this.pending = '';
        this.speechSamples = 0;
        this.stream = this.openStream();
      }
    }
  }

  /** Gated audio: feeds the open stream in speech, keeps the pre-roll warm out of it; 20 s backstop cuts in place. */
  async driveUtterance(send: Send, bytes: Uint8Array): Promise<void> {
    const samples = downsampleInt16ToF32_16k(bytes, this.srcRate);
    if (this.inSpeech && this.stream !== null) {
      await this.stream.feed(samples);
      this.uttFed += samples.length;
      const deltas = this.stream.drain();
      if (deltas.length > 0) {
        this.partialAcc.push(...deltas);
        await send({ type: 'partial', text: this.partialAcc.join('') });
      }
      if (this.uttFed >= 20 * TARGET_RATE) {          // lost end mark: cut, keep going
        await this.finalize(send);
        this.uttStartSample = this.sampleCursor;      // the next segment starts after the finalized part
        this.stream = this.openStream();
        this.uttFed = 0;
      }
    } else {
      this.prerollPush(samples);
    }
    this.sampleCursor += samples.length;
  }

  /** Ends the stream and sends its result; [durMs, recMs] tell the gated mode whether it keeps up. */
  async finalize(send: Send): Promise<[number, number]> {
    const t0 = engineSeams.now();
    const final = await this.stream!.end();
    const durMs = Math.trunc(((this.sampleCursor - this.uttStartSample) / TARGET_RATE) * 1000);
    const recMs = Math.trunc(engineSeams.now() - t0);
    if (final.trim()) {
      await send({ type: 'result', text: final.trim(), startSample: Math.trunc(this.uttStartSample), durationMs: durMs, recognitionTimeMs: recMs });
    }
    this.stream = null;
    this.partialAcc = [];
    return [durMs, recMs];
  }

  /** Test seam: dispatches exactly the items queued now, once. */
  async driveOnce(send: Send): Promise<void> {
    while (!this.audioQ!.empty()) {
      const data = this.audioQ!.getNowait();
      if (data === undefined || data === null) continue;
      await this.dispatch(send, data);
    }
  }

  /** A result envelope; startSample and durationMs are approximate in always-stream. */
  resultEvent(text: string): AsrEvent {
    return { type: 'result', text: text.trim(), startSample: Math.trunc(this.uttStartSample), durationMs: Math.trunc((this.sampleCursor / TARGET_RATE) * 1000), recognitionTimeMs: 0 };
  }

  /** Pause cut: end the stream for its complete held tail, send it, open a fresh one. */
  async endAndReopen(send: Send): Promise<void> {
    let final = '';
    try {
      final = await this.stream!.end();
    } catch {
      final = '';                                     // end() failed: drop this final, still recover
    }
    if (final.trim()) await send(this.resultEvent(final));
    this.stream = this.openStream();
    this.pending = '';
    this.speechSamples = 0;
  }

  /**
   * Always-stream audio: every buffer is fed. The client's end mark owns the endpoint; this tracks speech for that,
   * forces a cut at the 20 s run-on cap, salvages a stream that died, and degrades to per-utterance when more than
   * 3 s of audio is backed up in the queue (a model that cannot keep up).
   */
  async driveAlways(send: Send, bytes: Uint8Array): Promise<void> {
    const samples = downsampleInt16ToF32_16k(bytes, this.srcRate);
    this.sampleCursor += samples.length;
    this.prerollPush(samples);                        // the rolling onset copy a degrade replays
    await this.stream!.feed(samples);
    const hadSpeech = this.inSpeech;
    if (hadSpeech) this.speechSamples += samples.length;
    const deltas = this.stream!.drain();
    if (deltas.length > 0) {
      this.pending += deltas.join('');
      await send({ type: 'partial', text: this.pending.trim() });
    }
    if (this.stream!.aborted) {                       // the stream died: salvage what it said, reopen
      if (this.pending.trim()) await send(this.resultEvent(this.pending));
      try {
        this.stream!.abort();
      } catch {
        // discarded either way
      }
      this.stream = this.openStream();
      this.pending = '';
      this.speechSamples = 0;
      return;
    }
    if (this.speechSamples >= 20 * TARGET_RATE && this.speechSamples > 0) {
      await this.endAndReopen(send);
      return;
    }
    // Backpressure: un-processed audio waiting in the queue (silence drains at once, so it never builds).
    const lag = (this.audioQ?.size() ?? 0) * (samples.length / TARGET_RATE);
    if (this.mode === 'always_stream' && lag > 3.0) {
      engineSeams.log('warn', `[engine] streaming has ${lag.toFixed(1)}s of audio backed up — degrading to client-gated mode`);
      if (this.pending.trim()) await send(this.resultEvent(this.pending));
      try {
        this.stream!.abort();
      } catch {
        // discarded either way
      }
      this.stream = null;
      this.mode = 'per_utterance';
      this.pending = '';
      if (hadSpeech) {
        // Mid-utterance: no new start mark will come, so continue the utterance gated, replaying the ring.
        this.uttStartSample = Math.max(0, this.sampleCursor - this.prerollLen);
        this.partialAcc = [];
        this.uttFed = 0;
        this.stream = this.openStream();
        const pre = this.prerollTake();
        if (pre !== null) await this.stream.feed(pre);
      }
    }
  }

  /** Does the model resolve to a streaming backend? Reads the top plan's backend class flag, loading nothing. */
  async resolvesToStreaming(modelId: string | null, device: string | null, pin: string | null = null): Promise<boolean> {
    let plans: Plan[];
    try {
      plans = await engineSeams.resolve(modelId || 'sense-voice', device || 'auto', pin);
    } catch {
      return false;
    }
    if (plans.length === 0) return false;
    try {
      return Boolean((engineSeams.makeBackend(plans[0].backend) as { STREAMING?: boolean }).STREAMING);
    } catch {
      return false;
    }
  }

  async resolveStreamingBackend(modelId: string | null, device: string | null, pin: string | null = null): Promise<[unknown, Plan, string | null, number | null]> {
    const plans = await engineSeams.resolve(modelId || 'voxtral-mini-4b-realtime', device || 'auto', pin);
    return engineSeams.loadMeasured(plans, 'asr');
  }
}
