/**
 * The translation backend (port of translate_backend.py) over the addon's Translator: one GGUF chat model per handle,
 * the prompt shaped by the card's prompt family. Tokens arrive as raw UTF-8 bytes; a character split across pieces is
 * reassembled here (the addon does no decoding).
 *
 * Python tracked each call's thread so unload() never freed the model under a running call. Here each call has its own
 * AbortController (joined to the caller's signal): unload() aborts every call in flight, waits for them to return —
 * within one token, as the library checks the signal per token — and only then unloads, bounded by one shared
 * deadline so a wedged call cannot hold the engine forever.
 */
import fs from 'node:fs';
import { BackendLoadError, registerBackend } from '../backends';
import { splitArtifact } from '../catalog';
import { LOAD_MS, guarded, translateMs } from '../deadline';
import { cachedFilePath } from '../models/hfCache';
import * as native from '../native';
import type { PlanConfig } from '../planner';
import { STRATEGIES, chatmlFallback, cleanOutput, type PromptConfig, type Strategy } from './strategies';

type Translator = Awaited<ReturnType<native.NativeModule['translateLoad']>>;

export interface TranslateOptions {
  /** Wrap the text in <transcript> tags (the renderer's prompt explains them). */
  wrap?: boolean;
  /** Abort the generation: the call then answers with what it had so far. */
  signal?: AbortSignal;
  /** Every complete piece: the cleaned text so far. */
  onPartial?: (text: string) => void;
}

const DEFAULT_CONFIG: PromptConfig & Pick<PlanConfig, 'promptFamily'> = { disableThinking: false, appendNoThink: false, promptFamily: '' };

/** How long unload() waits, in total, for the calls it aborted to return before it unloads regardless (tests shrink it). */
export const backendTimings = { unloadDeadlineMs: 10_000 };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Waits for `p` to settle, or `ms` to pass — whichever is first — leaving no timer behind. */
async function within(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([p.then(() => {}, () => {}), new Promise<void>((r) => { timer = setTimeout(r, ms); })]);
  clearTimeout(timer);
}

interface Call {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

export class NativeTranslateBackend {
  static readonly NAME = 'native_translate';
  private t: Translator | null = null;
  private config: PromptConfig & Pick<PlanConfig, 'promptFamily'> = DEFAULT_CONFIG;
  private strategy: Strategy = STRATEGIES.qwen;
  /** The calls in flight, oldest first. */
  private readonly calls: Call[] = [];

  async load(modelRef: string, device: string, _computeType: string, config?: PromptConfig & Pick<PlanConfig, 'promptFamily'>): Promise<void> {
    await this.unload();
    try {
      let path: string;
      if (fs.existsSync(modelRef)) {
        path = modelRef;                                  // a local file passes through (tests, a local catalog entry)
      } else {
        const [repo, fname] = splitArtifact(modelRef);
        if (!fname) throw new BackendLoadError(`native_translate needs an 'org/repo/file.gguf' artifact, got '${modelRef}'`);
        const cached = cachedFilePath(repo, fname);
        if (cached === null) throw new BackendLoadError(`${modelRef} is not in the model cache`);
        path = cached;
      }
      // Always an explicit device, CPU included: no device would leave llama.cpp offloading everything to the GPU,
      // breaking the resolver's GPU → CPU fallback and the memory ledger (a CPU plan claims nothing).
      const dev = native.deviceFor(device);
      this.config = config ?? DEFAULT_CONFIG;
      // An unknown or missing family takes the qwen shape: plain system + user messages.
      this.strategy = STRATEGIES[this.config.promptFamily || 'qwen'] ?? STRATEGIES.qwen;
      this.t = await guarded(native.module().translateLoad(path, dev.index), LOAD_MS, 'translate_load');
    } catch (e) {
      await this.unload();
      throw e instanceof BackendLoadError ? e : new BackendLoadError(message(e));
    }
  }

  /**
   * Translates `text`: [cleaned text, pieces delivered]. A generation failure is thrown as it is (not a load failure);
   * an aborted one — the caller's signal, cancel() or unload() — answers with what was collected before the abort.
   */
  async translate(text: string, systemPrompt: string, src: string, tgt: string, opts: TranslateOptions = {}): Promise<[string, number]> {
    const t = this.t;
    if (t === null) throw new BackendLoadError('native_translate not loaded');
    const built = this.strategy.build(text, systemPrompt, src, tgt, opts.wrap ?? false, this.config);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (opts.signal?.aborted) controller.abort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
    let finish!: () => void;
    const call: Call = { controller, done: new Promise<void>((r) => { finish = r; }) };
    this.calls.push(call);

    let decoder = new TextDecoder('utf-8');
    let acc = '';
    let n = 0;
    const onToken = (bytes: Uint8Array) => {
      if (controller.signal.aborted) return;
      const piece = decoder.decode(bytes, { stream: true });
      if (piece === '') return;                           // mid-character: completed by the next piece
      acc += piece;
      n += 1;                                             // complete-character deliveries, as the Python binding counts
      if (opts.onPartial) {
        try {
          opts.onPartial(cleanOutput(acc));
        } catch {
          // a broken partial consumer costs one partial, never the translation
        }
      }
    };
    const run = { signal: controller.signal, onToken };
    try {
      try {
        if (built.mode === 'chat') {
          try {
            await guarded(t.chat(built.payload, { maxTokens: this.strategy.maxTokens, ...(built.prefill !== null ? { assistantPrefill: built.prefill } : {}) }, run), translateMs(this.strategy.maxTokens), 'translate');
          } catch (e) {
            if (controller.signal.aborted || !message(e).includes('chat template not supported')) throw e;
            // The library checks the template before the first token, so nothing was streamed yet.
            decoder = new TextDecoder('utf-8');
            acc = '';
            n = 0;
            await guarded(t.complete(chatmlFallback(built.payload, built.prefill), { maxTokens: this.strategy.maxTokens }, run), translateMs(this.strategy.maxTokens), 'translate');
          }
        } else {
          await guarded(t.complete(built.payload, { maxTokens: this.strategy.maxTokens }, run), translateMs(this.strategy.maxTokens), 'translate');
        }
      } catch (e) {
        if (controller.signal.aborted) return [cleanOutput(acc), n];
        throw e;
      }
      acc += decoder.decode();
      return [cleanOutput(acc), n];
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
      const i = this.calls.indexOf(call);
      if (i !== -1) this.calls.splice(i, 1);
      finish();
    }
  }

  /** Aborts the most recently started call, if any (TranslateEngine.cancelActive). */
  cancel(): void {
    this.calls.at(-1)?.controller.abort();
  }

  /** Aborts every call in flight, waits for them to return (one shared deadline), then frees the model. */
  async unload(): Promise<void> {
    const t = this.t;
    this.t = null;
    const calls = this.calls.splice(0);
    for (const c of calls) c.controller.abort();
    const deadline = Date.now() + backendTimings.unloadDeadlineMs;
    await within(Promise.all(calls.map((c) => c.done)), backendTimings.unloadDeadlineMs);
    if (t !== null) await within(t.unload(), Math.max(0, deadline - Date.now()));
  }

  get isLoaded(): boolean {
    return this.t !== null;
  }

  /** The calls in flight (tests). */
  get inFlight(): number {
    return this.calls.length;
  }
}

registerBackend(NativeTranslateBackend);
