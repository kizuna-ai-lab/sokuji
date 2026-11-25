/**
 * The TTS backend (port of tts_backend.NativeTtsBackend) over the addon's Tts: one class for every audio.cpp family.
 * What differs between families — streaming or offline, cloning or not, the sample rate — is read off the loaded
 * model's capabilities at load and kept per instance, so one `native_tts` name serves them all.
 *
 * - Load stages the GGUF (and a card's preset assets) for audio.cpp's loader (see staging.ts), gives pocket_tts its
 *   first preset as the default voice, and on a GPU runs one discarded warm-up synth so the first utterance does not
 *   pay the one-time pipeline compile.
 * - qwen3_tts, omnivoice and index_tts2 have no usable default voice: synthesizing before a voice is set is refused
 *   here with a clear, family-named error rather than a native one.
 * - Every synth — one-shot or streaming, warm-up included — has its own AbortController joined to the caller's signal.
 *   cancel() aborts the newest; unload() aborts them all and waits for them (the library checks between chunks) before
 *   freeing the model, within one shared deadline.
 */
import { seams } from '../accel/seams';
import { BackendLoadError, registerBackend } from '../backends';
import { VOICE_REQUIRED_FAMILIES, splitArtifact } from '../catalog';
import { LOAD_MS, guarded, ttsMs } from '../deadline';
import { snapshotPath } from '../models/hfCache';
import * as native from '../native';
import type { PlanConfig } from '../planner';
import { stageForNative } from './staging';

type Tts = Awaited<ReturnType<native.NativeModule['ttsLoad']>>;
export type TtsConfig = Partial<Pick<PlanConfig, 'ttsFamily' | 'ttsLanguage' | 'ttsExtraFiles'>>;
export type OnChunk = (pcm: Float32Array, sampleRate: number, channels: number) => void;

/** How long unload() waits, in total, for the synths it aborted (tests shrink it). */
export const ttsTimings = { unloadDeadlineMs: 10_000 };
const WARM_UP_TEXT = 'Warm-up.';
/** Families with no working bare synth whose first preset becomes the default voice at load. */
const DEFAULT_PRESET_FAMILIES = new Set(['pocket_tts']);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function within(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([p.then(() => {}, () => {}), new Promise<void>((r) => { timer = setTimeout(r, ms); })]);
  clearTimeout(timer);
}

interface Call {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

export class NativeTtsBackend {
  static readonly NAME = 'native_tts';
  STREAMING = false;
  CLONES = false;
  sampleRate = 24000;
  private model: Tts | null = null;
  private language: string | null = null;
  private family: string | null = null;
  voiceSet = false;
  private readonly calls: Call[] = [];
  /** Bumped by unload(): a load still awaiting the library sees it was unloaded meanwhile. */
  private epoch = 0;

  private ensureVoiceReady(): void {
    if (this.family !== null && VOICE_REQUIRED_FAMILIES.has(this.family) && !this.voiceSet) {
      throw new BackendLoadError(`${this.family} requires a voice clip before synthesis`);
    }
  }

  async load(modelRef: string, device: string, _computeType: string, config?: TtsConfig): Promise<void> {
    await this.unload();
    const epoch = this.epoch;
    try {
      const family = config?.ttsFamily || null;
      if (!family) throw new BackendLoadError(`native_tts needs config.ttsFamily, got ${JSON.stringify(config ?? null)}`);
      const [repo, fname] = splitArtifact(modelRef);
      if (!fname) throw new BackendLoadError(`native_tts needs an 'org/repo/dir/file.gguf' artifact, got '${modelRef}'`);
      const snap = snapshotPath(repo);
      if (snap === null) throw new BackendLoadError(`${modelRef} is not in the model cache`);
      const rev = snap.split(/[\\/]/).pop()!;
      const slash = fname.lastIndexOf('/');
      const modelDir = slash === -1 ? '' : fname.slice(0, slash);
      const path = await stageForNative(repo, rev, fname, `${snap}/${fname}`);
      for (const [extraName] of config?.ttsExtraFiles ?? []) {
        const rel = modelDir ? `${modelDir}/${extraName}` : extraName;
        await stageForNative(repo, rev, rel, `${snap}/${rel}`);
      }
      const dev = native.deviceFor(device);
      const model = await guarded(native.module().ttsLoad(path, dev.index, { family, language: config?.ttsLanguage || null }), LOAD_MS, 'tts_load');
      if (epoch !== this.epoch) {                         // unloaded while the library was loading it
        await model.unload().catch(() => {});
        return;
      }
      this.model = model;
      const caps = model.capabilities;
      this.STREAMING = Boolean(caps.streaming);
      this.CLONES = Boolean(caps.clones);
      this.sampleRate = Math.trunc(caps.sampleRate);
      this.family = family;
      this.voiceSet = false;
      if (DEFAULT_PRESET_FAMILIES.has(family)) {
        const presets = await model.presets();
        if (presets.length > 0) await this.setBuiltinVoice(presets[0]);
        else seams.log('warn', `native_tts: family='${family}' has no preset to use as its default voice; a bare synth will fail until a voice is set`);
      }
      if (device !== 'cpu' && !VOICE_REQUIRED_FAMILIES.has(family)) await this.warmUp();
    } catch (e) {
      await this.unload();
      throw e instanceof BackendLoadError ? e : new BackendLoadError(message(e));
    }
  }

  private async warmUp(): Promise<void> {
    const t0 = performance.now();
    try {
      await this.generate(WARM_UP_TEXT);
    } catch (e) {
      seams.log('warn', `native_tts: warm-up synth failed for family='${this.family}', continuing without it: ${message(e)}`);
      return;
    }
    seams.log('info', `native_tts: warm-up synth for family='${this.family}' took ${((performance.now() - t0) / 1000).toFixed(2)}s (hides the first-synth GPU pipeline compile)`);
  }

  /** Registers a synth: its controller follows `signal`; `finish` removes it. */
  private begin(signal?: AbortSignal): { controller: AbortController; finish: () => void } {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    let settle!: () => void;
    const call: Call = { controller, done: new Promise<void>((r) => { settle = r; }) };
    this.calls.push(call);
    return {
      controller,
      finish: () => {
        signal?.removeEventListener('abort', onAbort);
        const i = this.calls.indexOf(call);
        if (i !== -1) this.calls.splice(i, 1);
        settle();
      },
    };
  }

  /** One-shot synthesis: [samples (interleaved), the rate the synth actually returned, milliseconds, channels]. */
  async generate(text: string, speed = 1.0, signal?: AbortSignal): Promise<[Float32Array, number, number, number]> {
    const model = this.model;
    if (model === null) throw new BackendLoadError('native_tts not loaded');
    this.ensureVoiceReady();
    const { controller, finish } = this.begin(signal);
    const parts: Float32Array[] = [];
    let rate = this.sampleRate;
    let channels = 1;
    try {
      const t0 = performance.now();
      await guarded(model.synth(text, this.language, speed, {
        signal: controller.signal,
        onAudio: (pcm, sr, ch) => { parts.push(pcm); rate = sr; channels = ch; },
      }), ttsMs(text.length), 'tts_synth');
      const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        samples.set(p, at);
        at += p.length;
      }
      return [samples, Math.trunc(rate), Math.trunc(performance.now() - t0), channels];
    } finally {
      finish();
    }
  }

  /**
   * Streaming synthesis: `onChunk` gets each chunk with its own rate. An abort (the signal, cancel(), unload()) ends
   * it quietly before the next chunk; a real synthesis failure is thrown.
   */
  async generateStream(text: string, speed: number, signal: AbortSignal | undefined, onChunk: OnChunk): Promise<void> {
    const model = this.model;
    if (model === null) throw new BackendLoadError('native_tts not loaded');
    this.ensureVoiceReady();
    const { controller, finish } = this.begin(signal);
    try {
      await guarded(model.synth(text, this.language, speed, {
        signal: controller.signal,
        onAudio: (pcm, sr, ch) => {
          if (!controller.signal.aborted) onChunk(pcm, Math.trunc(sr), ch);
        },
      }), ttsMs(text.length), 'tts_synth');
    } catch (e) {
      if (!controller.signal.aborted) throw e;
    } finally {
      finish();
    }
  }

  /** Aborts the newest synth, if any. */
  cancel(): void {
    this.calls.at(-1)?.controller.abort();
  }

  async setVoice(audio: Float32Array, sampleRate: number, refText = ''): Promise<void> {
    if (this.model === null) throw new BackendLoadError('native_tts not loaded');
    await this.model.setVoice(audio, Math.trunc(sampleRate), refText || null);
    this.voiceSet = true;
  }

  async setBuiltinVoice(name: string): Promise<void> {
    if (this.model === null) throw new BackendLoadError('native_tts not loaded');
    await this.model.setPreset(name);
    this.voiceSet = true;
  }

  setLanguage(lang: string): void {
    this.language = lang || null;
  }

  async listBuiltinVoices(): Promise<string[]> {
    if (this.model === null) throw new BackendLoadError('native_tts not loaded');
    return [...(await this.model.presets())];
  }

  /** Aborts every synth, waits for them (one shared deadline), then frees the model. */
  async unload(): Promise<void> {
    this.epoch += 1;
    const model = this.model;
    this.model = null;
    const calls = this.calls.splice(0);
    for (const c of calls) c.controller.abort();
    const deadline = Date.now() + ttsTimings.unloadDeadlineMs;
    await within(Promise.all(calls.map((c) => c.done)), ttsTimings.unloadDeadlineMs);
    if (model !== null) await within(model.unload(), Math.max(0, deadline - Date.now()));
  }

  get isLoaded(): boolean {
    return this.model !== null;
  }

  /** The synths in flight (tests). */
  get inFlight(): number {
    return this.calls.length;
  }
}

registerBackend(NativeTtsBackend);
