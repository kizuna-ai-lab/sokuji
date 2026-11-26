/**
 * The TTS engine (port of tts_engine.TtsEngine): loads the resolved plan, owns the connection that loaded it, and turns
 * every family's output into 24 kHz mono int16 — one-shot, or streamed as tts_chunk messages each carrying its PCM,
 * then tts_done. `generation` counts inits (a teardown from an older init leaves a newer model alone); the handler
 * takes the next one with nextGeneration() before it starts loading.
 */
import { measureRtfTts } from '../accel/bench';
import { ledgerRelease } from '../accel/ledger';
import { loadMeasured } from '../accel/loader';
import { probe } from '../accel/probe';
import { resolveTts } from '../accel/resolve';
import type { Conn } from '../conn';
import type { Plan } from '../planner';
import './backend';
import type { OnChunk } from './backend';
import { TARGET_RATE, toInt16_24kMono } from './dsp';

export interface TtsBackendLike {
  readonly STREAMING?: boolean;
  readonly CLONES?: boolean;
  generate(text: string, speed?: number, signal?: AbortSignal): Promise<[Float32Array, number, number, number?]>;
  generateStream?(text: string, speed: number, signal: AbortSignal | undefined, onChunk: OnChunk): Promise<void>;
  setVoice?(audio: Float32Array, sampleRate: number, refText?: string): Promise<void> | void;
  setBuiltinVoice?(name: string): Promise<void> | void;
  setLanguage?(lang: string): void;
  listBuiltinVoices?(): Promise<string[]> | string[];
  cancel?(): void;
  unload?(): Promise<void> | void;
}

export type Send = (msg: Record<string, unknown>, binary?: Uint8Array | null) => Promise<void>;

/** What init reads, patched by tests (Python's monkeypatching of accel). */
const DEFAULTS = {
  resolveTts: (modelId: string, override: string, pin: string | null): Promise<Plan[]> => resolveTts(modelId, override, null, pin),
  loadMeasured: (plans: readonly Plan[], stage: string) => loadMeasured(plans, stage) as Promise<[unknown, Plan, string | null, number | null]>,
  measureRtfTts: (backend: unknown, plan: Plan, modelId: string) => measureRtfTts(backend, plan, modelId, probe()),
  now: (): number => performance.now(),
};
export const engineSeams = { ...DEFAULTS };
export function restoreEngineSeams(): void {
  Object.assign(engineSeams, DEFAULTS);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class TtsEngine {
  backend: TtsBackendLike | null = null;
  /** What every generation is sent at. */
  readonly sampleRate = TARGET_RATE;
  streaming = false;
  clones = false;
  modelId: string | null = null;
  resolved: Record<string, unknown> | null = null;
  /** The connection whose tts_init loaded the model: only it may generate or cancel. */
  ownerConn: Conn | null = null;
  private gen = 0;

  get isLoaded(): boolean {
    return this.backend !== null;
  }

  get generation(): number {
    return this.gen;
  }

  nextGeneration(): number {
    this.gen += 1;
    return this.gen;
  }

  async init(modelId: string | null = null, device = 'auto', language = '', pin: string | null = null, generation?: number): Promise<number> {
    const t0 = engineSeams.now();
    if (generation === undefined) this.gen += 1;
    await this.close();
    const mid = modelId || 'moss-tts-nano';
    const plans = await engineSeams.resolveTts(mid, device || 'auto', pin);
    const [backend, plan, notice, mem] = await engineSeams.loadMeasured(plans, 'tts');
    this.backend = backend as TtsBackendLike;
    this.backend.setLanguage?.(language || '');
    this.streaming = Boolean(this.backend.STREAMING);
    this.clones = Boolean(this.backend.CLONES);
    this.modelId = mid;
    this.resolved = { backend: plan.backend, device: plan.device, computeType: plan.computeType, streaming: this.streaming, clones: this.clones };
    if (plan.config?.ttsFamily) this.resolved.family = plan.config.ttsFamily;
    const rtf = await engineSeams.measureRtfTts(this.backend, plan, mid);
    if (rtf !== null) this.resolved.rtf = Math.round(rtf * 1000) / 1000;
    if (mem !== null) this.resolved.memoryBytes = mem;
    if (notice) this.resolved.fallbackReason = notice;
    return Math.trunc(engineSeams.now() - t0);
  }

  async setVoice(audio: Float32Array, sampleRate: number, refText: string | null = null): Promise<void> {
    await this.backend!.setVoice!(audio, Math.trunc(sampleRate), refText || '');
  }

  async setBuiltinVoice(name: string): Promise<void> {
    await this.backend!.setBuiltinVoice!(name);
  }

  async listBuiltinVoices(): Promise<string[]> {
    return this.backend?.listBuiltinVoices ? [...(await this.backend.listBuiltinVoices())] : [];
  }

  /** Aborts the backend's newest synth (teardown runs this before close()). */
  cancelActive(): void {
    try {
      this.backend?.cancel?.();
    } catch {
      // best effort
    }
  }

  /** One-shot: [24 kHz mono int16 PCM, generation milliseconds]. */
  async generate(text: string, speed = 1.0, signal?: AbortSignal): Promise<[Uint8Array, number]> {
    const [samples, rate, genMs, channels = 1] = await this.backend!.generate(text, speed, signal);
    return [toInt16_24kMono(samples, channels, rate), genMs];
  }

  /**
   * Streams tts_chunk {id, seq} + PCM per chunk, each resampled at its own rate, then tts_done {id, totalSamples,
   * generationTimeMs}; a synthesis failure sends error {id, message} instead of tts_done. An abort stops the chunks;
   * tts_done still closes the stream.
   */
  async generateStream(text: string, speed: number, send: Send, signal: AbortSignal | undefined, msgId: unknown): Promise<void> {
    const t0 = engineSeams.now();
    let seq = 0;
    let total = 0;
    let sends: Promise<void> = Promise.resolve();
    try {
      await this.backend!.generateStream!(text, speed, signal, (pcm, rate, channels) => {
        if (signal?.aborted) return;
        const bytes = toInt16_24kMono(pcm, channels, rate);
        // Counted and numbered when its turn to send comes, so a chunk dropped by an abort is in neither.
        sends = sends.then(() => {
          if (signal?.aborted) return undefined;
          total += bytes.length / 2;
          return send({ type: 'tts_chunk', id: msgId, seq: seq++ }, bytes);
        });
      });
      await sends;
    } catch (e) {
      await sends.catch(() => {});
      await send({ type: 'error', id: msgId, message: errorText(e) });
      return;
    }
    await send({ type: 'tts_done', id: msgId, totalSamples: total, generationTimeMs: Math.trunc(engineSeams.now() - t0) });
  }

  async close(): Promise<void> {
    ledgerRelease('tts');
    const backend = this.backend;
    this.backend = null;
    this.modelId = null;
    this.ownerConn = null;
    if (backend !== null) {
      try {
        await backend.unload?.();
      } catch {
        // best effort
      }
    }
  }
}
