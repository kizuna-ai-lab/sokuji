/**
 * The native ASR backends (port of asr_backend.py): `native_asr` wraps the addon's AsrModel (one run per client-marked
 * segment); `native_asr_stream` adds the stream adapter the engine's streaming loop drives. The model ref is an
 * "org/repo/file.gguf" artifact already in the hub cache (the model manager downloads it first).
 */
import { AsrResult, BackendLoadError, registerBackend } from '../backends';
import { splitArtifact } from '../catalog';
import { FEED_MS, LOAD_MS, asrRunMs, guarded } from '../deadline';
import { cachedFilePath } from '../models/hfCache';
import * as native from '../native';

type AsrModel = Awaited<ReturnType<native.NativeModule['asrLoad']>>;
type RawStream = ReturnType<AsrModel['openStream']>;

/** Plan device → the addon's device kind (no cuda/dml tier ever existed for ASR). */
const DEVICE_KIND: Readonly<Record<string, string>> = { cpu: 'cpu', vulkan: 'vulkan', metal: 'metal' };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The engine's stream contract: feed audio, drain committed deltas, end for the full final text, or abort. */
export interface AsrStreamLike {
  feed(samples: Float32Array): Promise<void> | void;
  drain(): string[];
  end(): Promise<string> | string;
  abort(): void;
  /** Set once the stream died under the engine (a feed the library refused): the engine salvages and reopens. */
  readonly aborted?: boolean;
}

export class NativeAsrBackend {
  static readonly NAME: string = 'native_asr';
  readonly STREAMING: boolean = false;
  protected model: AsrModel | null = null;

  async load(modelRef: string, device: string, _computeType: string, _config?: unknown): Promise<void> {
    await this.unload();
    try {
      const [repo, fname] = splitArtifact(modelRef);
      if (!fname) throw new BackendLoadError(`native_asr needs an 'org/repo/file.gguf' artifact, got '${modelRef}'`);
      const path = cachedFilePath(repo, fname);
      if (path === null) throw new BackendLoadError(`${modelRef} is not in the model cache`);
      const kind = DEVICE_KIND[device];
      if (kind === undefined) throw new BackendLoadError(`unknown device for native_asr: '${device}'`);
      this.model = await guarded(native.module().asrLoad(path, native.deviceFor(kind).index), LOAD_MS, 'asr_load');
    } catch (e) {
      // A missing addon or file, no such device, a NativeError: the resolver falls back to the next plan.
      await this.unload();
      throw e instanceof BackendLoadError ? e : new BackendLoadError(message(e));
    }
  }

  /**
   * The app's language code on the loaded model's own tag set: an exact match, then a primary-subtag match
   * ('zh' → 'zh-CN'); a tag the model does not know becomes null (autodetect) rather than a failed run.
   */
  protected matchLanguage(language: string | null | undefined): string | null {
    if (!language) return null;
    const tags = this.model?.capabilities.languages ?? [];
    if (tags.length === 0) return language;
    const want = language.toLowerCase().replace(/_/g, '-');
    const exact = tags.find((t) => t.toLowerCase() === want);
    if (exact !== undefined) return exact;
    const primary = want.split('-')[0];
    return tags.find((t) => t.toLowerCase().split('-')[0] === primary) ?? null;
  }

  async transcribe(samples: Float32Array, language: string | null): Promise<AsrResult> {
    if (this.model === null) throw new BackendLoadError('native_asr not loaded');
    if (samples.length === 0) return new AsrResult('', language);
    let text: string;
    try {
      text = await guarded(this.model.run(samples, this.matchLanguage(language)), asrRunMs(samples.length / 16000), 'asr_run');
    } catch (e) {
      throw new BackendLoadError(message(e));
    }
    return new AsrResult((text ?? '').trim(), language);
  }

  async unload(): Promise<void> {
    const model = this.model;
    this.model = null;
    if (model !== null) {
      try {
        await model.unload();
      } catch {
        // already gone
      }
    }
  }

  get isLoaded(): boolean {
    return this.model !== null;
  }
}

/**
 * One addon AsrStream behind the engine's contract. `drain()` hands out committed-prefix deltas only (tentative text
 * can still change); `end()` finalizes and returns the full final hypothesis. A feed the library refuses — including a
 * refused open, which the addon reports on the first feed — marks the stream aborted and closes it, freeing the
 * model's one stream slot so the engine can open a new one.
 */
export class NativeStream implements AsrStreamLike {
  private committed = '';
  private emitted = 0;
  private done = false;
  aborted = false;
  /** Why the stream aborted. */
  error: unknown = null;

  constructor(private readonly raw: RawStream) {}

  async feed(samples: Float32Array): Promise<void> {
    if (samples.length === 0 || this.done) return;
    try {
      this.committed = (await guarded(this.raw.feed(samples), FEED_MS, 'asr_feed')).committed || '';
    } catch (e) {
      this.error = e;
      this.aborted = true;
      this.close();
    }
  }

  drain(): string[] {
    if (this.committed.length > this.emitted) {
      const delta = this.committed.slice(this.emitted);
      this.emitted = this.committed.length;
      return [delta];
    }
    return [];
  }

  async end(): Promise<string> {
    if (this.done) return this.committed.trim();
    let final: string;
    try {
      final = (await this.raw.finalize()) || '';
    } finally {
      this.close();
    }
    return final.trim();
  }

  abort(): void {
    this.close();
  }

  private close(): void {
    if (this.done) return;
    this.done = true;
    try {
      this.raw.close();
    } catch {
      // best effort: the handle is unusable either way
    }
  }
}

export class NativeAsrStreamBackend extends NativeAsrBackend {
  static readonly NAME: string = 'native_asr_stream';
  readonly STREAMING: boolean = true;

  async load(modelRef: string, device: string, computeType: string, config?: unknown): Promise<void> {
    await super.load(modelRef, device, computeType, config);
    if (!this.model?.capabilities.supportsStreaming) {
      await this.unload();
      throw new BackendLoadError(`${modelRef} does not support streaming`);
    }
  }

  /** `language` is the user's source-language hint, mapped onto the model's tags; empty = autodetect. */
  openStream(language: string | null = null): NativeStream {
    if (this.model === null) throw new BackendLoadError('native_asr_stream not loaded');
    try {
      return new NativeStream(this.model.openStream(this.matchLanguage(language)));
    } catch (e) {
      throw e instanceof BackendLoadError ? e : new BackendLoadError(message(e));
    }
  }
}

registerBackend(NativeAsrBackend);
registerBackend(NativeAsrStreamBackend);
