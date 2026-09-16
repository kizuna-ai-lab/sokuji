/**
 * The half of the punctuation worker that does not know which onnxruntime-web
 * bundle it is running in.
 *
 * Two entries exist because the two bundles are not interchangeable: only
 * `onnxruntime-web/webgpu` really runs a session on the GPU (the default entry
 * silently returns garbage for executionProviders: ['webgpu']), and only the
 * default entry's WASM EP registers GatherBlockQuantized, which SaT's
 * 8-bit embedding needs. A WebGPU failure therefore has to recreate the
 * worker with the other entry rather than fall back inside one.
 */
import type { PunctuationModelId, PunctuationResult } from '../../../segmentation/SegmentationRuntime';

export interface PunctuationInitMessage {
  type: 'load';
  id: string;
  model: PunctuationModelId;
  /** filename -> blob URL, straight from ModelManager.getModelBlobUrls(). */
  fileUrls: Record<string, string>;
  /** Absolute URL of /wasm/ort/ for ort.env.wasm.wasmPaths. */
  ortWasmBaseUrl: string;
  /** Pinned deliberately: Edge-Punct's int8 logits are not bit-identical
   *  across thread counts, and a flipped word is a visible wrong capital. */
  numThreads: number;
}

export interface PunctuationRunMessage {
  type: 'run';
  id: string;
  model: PunctuationModelId;
  text: string;
}

export interface PunctuationUnloadMessage { type: 'unload'; id: string; model: PunctuationModelId }
export interface PunctuationDisposeMessage { type: 'dispose' }

export type PunctuationWorkerInbound =
  | PunctuationInitMessage
  | PunctuationRunMessage
  | PunctuationUnloadMessage
  | PunctuationDisposeMessage;

export type PunctuationWorkerOutbound =
  | { type: 'ready'; loadTimeMs: number; device: 'webgpu' | 'wasm' }
  | { type: 'loaded'; id: string; model: PunctuationModelId; loadTimeMs: number; device: 'webgpu' | 'wasm' }
  | { type: 'result'; id: string; result: PunctuationResult; inferenceMs: number }
  | { type: 'unloaded'; id: string }
  | { type: 'error'; id?: string; error: string }
  | { type: 'disposed' };

/** What the core hands an adapter at load time. */
export interface PunctuationAdapterDeps {
  /** Either bundle's InferenceSession, whichever entry imported the core. */
  InferenceSession: any;
  Tensor: any;
  /** Read one of the model's files by manifest filename. */
  readFile(filename: string): Promise<Uint8Array>;
  /** 'webgpu' only when this entry can really run on the GPU AND the model
   *  supports it; every adapter is free to ignore it. */
  executionProviders: string[];
}

export interface PunctuationAdapter {
  readonly model: PunctuationModelId;
  /** True when this adapter may run on the WebGPU EP. Edge-Punct returns false:
   *  its graph is DynamicQuantizeLSTM / ConvInteger / MatMulInteger / NonZero /
   *  TopK, none of which have WebGPU kernels, so it would fall back to CPU
   *  op by op and be slower than plain WASM. */
  readonly supportsWebGpu: boolean;
  load(deps: PunctuationAdapterDeps): Promise<void>;
  run(text: string): Promise<PunctuationResult>;
  release(): Promise<void>;
}

export interface PunctuationCoreDeps {
  InferenceSession: any;
  Tensor: any;
  env: any;
  /** Whether this entry's sessions can really use the GPU. */
  canUseWebGpu(): Promise<boolean>;
  adapters: Record<PunctuationModelId, () => PunctuationAdapter>;
}

/**
 * Wire `self.onmessage` to the load/run/unload/dispose protocol.
 *
 * Messages are serialized through one promise chain: ORT sessions are not
 * re-entrant, and two runs overlapping inside one wasm instance is the hang
 * qwen3-asr-webgpu.worker.ts documents at its VAD import.
 */
export function installPunctuationWorker(deps: PunctuationCoreDeps): void {
  const loaded = new Map<PunctuationModelId, PunctuationAdapter>();
  const blobs = new Map<PunctuationModelId, Record<string, string>>();
  let chain: Promise<void> = Promise.resolve();

  const post = (msg: PunctuationWorkerOutbound) => (self as any).postMessage(msg);

  async function handleLoad(msg: PunctuationInitMessage): Promise<void> {
    const started = performance.now();
    if (deps.env?.wasm) {
      deps.env.wasm.wasmPaths = msg.ortWasmBaseUrl;
      deps.env.wasm.numThreads = msg.numThreads;
    }
    const adapter = deps.adapters[msg.model]();
    const gpu = adapter.supportsWebGpu && (await deps.canUseWebGpu());
    const device: 'webgpu' | 'wasm' = gpu ? 'webgpu' : 'wasm';
    await adapter.load({
      InferenceSession: deps.InferenceSession,
      Tensor: deps.Tensor,
      readFile: async (filename: string) => {
        const url = msg.fileUrls[filename];
        if (!url) throw new Error(`punctuation: ${msg.model} is missing ${filename}`);
        const res = await fetch(url);
        return new Uint8Array(await res.arrayBuffer());
      },
      executionProviders: [device],
    });
    loaded.set(msg.model, adapter);
    blobs.set(msg.model, msg.fileUrls);
    post({ type: 'loaded', id: msg.id, model: msg.model, loadTimeMs: Math.round(performance.now() - started), device });
  }

  async function handleRun(msg: PunctuationRunMessage): Promise<void> {
    const adapter = loaded.get(msg.model);
    if (!adapter) throw new Error(`punctuation: ${msg.model} is not loaded`);
    const started = performance.now();
    const result = await adapter.run(msg.text);
    post({ type: 'result', id: msg.id, result, inferenceMs: Math.round(performance.now() - started) });
  }

  async function handleUnload(msg: PunctuationUnloadMessage): Promise<void> {
    const adapter = loaded.get(msg.model);
    if (adapter) await adapter.release();
    loaded.delete(msg.model);
    blobs.delete(msg.model);
    post({ type: 'unloaded', id: msg.id });
  }

  self.onmessage = (event: MessageEvent<PunctuationWorkerInbound>) => {
    const msg = event.data;
    chain = chain.then(async () => {
      try {
        if (msg.type === 'load') await handleLoad(msg);
        else if (msg.type === 'run') await handleRun(msg);
        else if (msg.type === 'unload') await handleUnload(msg);
        else if (msg.type === 'dispose') {
          for (const adapter of loaded.values()) await adapter.release();
          loaded.clear();
          post({ type: 'disposed' });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        post({ type: 'error', id: (msg as { id?: string }).id, error });
      }
    });
  };

  post({ type: 'ready', loadTimeMs: 0, device: 'wasm' });
}
