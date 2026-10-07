/**
 * The half of the Smart Turn worker that does not know which onnxruntime-web
 * bundle it runs in (turn-webgpu.worker.ts, turn-wasm.worker.ts).
 */
import { logMel, type MelFilterbank } from './log-mel';
import { slaneyMelFilterbank } from './mel-filters';
import {
  SMART_TURN_FILE,
  TURN_SAMPLE_RATE,
  TURN_WINDOW_SAMPLES,
  type TurnInitMessage,
  type TurnPredictAnswer,
  type TurnPredictRequest,
  type TurnWorkerInbound,
  type TurnWorkerOutbound,
} from './turn-protocol';

const MEL_BINS = 80;
const FEATURE_FRAMES = 800;
const NORMALIZE_EPS = 1e-7;

let filters: MelFilterbank | null = null;

/** WhisperFeatureExtractor(chunk_length=8) with do_normalize over the last 8 s, zero-padded at the front: [80][800]. */
export function featurize(window: Float32Array): Float32Array {
  const w = new Float32Array(TURN_WINDOW_SAMPLES);
  const tail = window.length > TURN_WINDOW_SAMPLES ? window.subarray(window.length - TURN_WINDOW_SAMPLES) : window;
  w.set(tail, TURN_WINDOW_SAMPLES - tail.length);
  let mean = 0;
  for (let i = 0; i < w.length; i++) mean += w[i];
  mean /= w.length;
  let variance = 0;
  for (let i = 0; i < w.length; i++) {
    const d = w[i] - mean;
    variance += d * d;
  }
  const scale = 1 / Math.sqrt(variance / w.length + NORMALIZE_EPS);
  for (let i = 0; i < w.length; i++) w[i] = (w[i] - mean) * scale;
  if (!filters) {
    filters = slaneyMelFilterbank({ nMels: MEL_BINS, nFft: 400, sampleRate: TURN_SAMPLE_RATE, fMin: 0, fMax: 8000 });
  }
  return logMel(w, filters).data;
}

export interface TurnCoreDeps {
  /** Either bundle's InferenceSession, whichever entry imported this core. */
  InferenceSession: any;
  Tensor: any;
  env: any;
  device: 'webgpu' | 'wasm';
  /** Runs before the session is created; throws when this entry cannot run here. */
  prepare(): Promise<void>;
}

export interface TurnWorkerScope {
  onmessage: ((event: MessageEvent<TurnWorkerInbound>) => void) | null;
  postMessage(message: TurnWorkerOutbound): void;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function installTurnWorker(deps: TurnCoreDeps, scope: TurnWorkerScope = self as unknown as TurnWorkerScope): void {
  let session: any = null;
  const ports = new Map<number, MessagePort>();
  // ORT sessions are not re-entrant: every load and prediction waits its turn.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => { chain = chain.then(task); };

  async function init(msg: TurnInitMessage): Promise<void> {
    const started = performance.now();
    try {
      if (deps.env?.wasm) {
        deps.env.wasm.wasmPaths = msg.ortWasmBaseUrl;
        deps.env.wasm.numThreads = msg.numThreads;
      }
      await deps.prepare();
      const url = msg.fileUrls[SMART_TURN_FILE];
      if (!url) throw new Error(`Smart Turn: ${SMART_TURN_FILE} is missing`);
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      session = await deps.InferenceSession.create(bytes, {
        executionProviders: [deps.device],
        graphOptimizationLevel: 'all',
      });
      scope.postMessage({ type: 'ready', loadTimeMs: Math.round(performance.now() - started), device: deps.device });
    } catch (err) {
      scope.postMessage({ type: 'error', error: messageOf(err) });
    }
  }

  async function predict(id: number, port: MessagePort, msg: TurnPredictRequest): Promise<void> {
    if (ports.get(id) !== port) return;
    let answer: TurnPredictAnswer;
    try {
      if (!session) throw new Error('Smart Turn is not loaded');
      const input = new deps.Tensor('float32', featurize(msg.window), [1, MEL_BINS, FEATURE_FRAMES]);
      const out = await session.run({ input_features: input });
      answer = { id: msg.id, probability: Number(out.logits.data[0]) };
    } catch (err) {
      answer = { id: msg.id, error: messageOf(err) };
    }
    port.postMessage(answer);
  }

  scope.onmessage = (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        enqueue(() => init(msg));
        break;
      case 'connect': {
        const { id, port } = msg;
        ports.set(id, port);
        port.onmessage = (e: MessageEvent<TurnPredictRequest>) => enqueue(() => predict(id, port, e.data));
        break;
      }
      case 'disconnect':
        ports.get(msg.id)?.close();
        ports.delete(msg.id);
        break;
      case 'dispose':
        enqueue(async () => {
          for (const port of ports.values()) port.close();
          ports.clear();
          try {
            await session?.release?.();
          } catch {
            // a failed release must not stall the queue or withhold `disposed`
          }
          session = null;
          scope.postMessage({ type: 'disposed' });
        });
        break;
    }
  };
}
