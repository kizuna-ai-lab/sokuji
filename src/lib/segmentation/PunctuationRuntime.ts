/**
 * PunctuationRuntime — the `SegmentationRuntime` implementation.
 *
 * Owns one lazily-created Worker shared by all three punctuation models
 * (the worker's own `installPunctuationWorker` core keeps a
 * `Map<PunctuationModelId, PunctuationAdapter>`, so one worker can hold
 * FireRedPunc and Edge-Punct-en loaded at the same time — both legs of a
 * zh<->en session need a model simultaneously). Routes a language to a
 * model, drives that model's download and load through `ModelManager`, and
 * tracks per-model health (consecutive failures, latency, idle unload) plus
 * whole-worker health (crash restart, WebGPU -> WASM fallback).
 *
 * Imports no store and no report.ts: failures are surfaced only through
 * `PunctuationRuntimeOptions`'s callbacks, which the app layer (slice 2)
 * forwards to the store and to diagnostics.
 */
import { WorkerSession } from '../local-inference/engine/WorkerSession';
import { RequestRegistry } from '../local-inference/engine/RequestRegistry';
import { ModelManager } from '../local-inference/ModelManager';
import { checkWebGPU } from '../../utils/webgpu';
import { baseLang } from './sentenceEnd';
import { createPunctuationWorker } from './createPunctuationWorker';
import type {
  PunctuationInitMessage,
  PunctuationRunMessage,
  PunctuationUnloadMessage,
  PunctuationWorkerOutbound,
} from '../local-inference/workers/_shared/punctuation-core';
import type {
  PunctuationModelId,
  PunctuationResult,
  SegmentationRuntime,
} from './SegmentationRuntime';

/** Manifest ids, keyed by the model each adapter implements. */
export const MODEL_IDS: Record<PunctuationModelId, string> = {
  'fireredpunc': 'punct-zh-fireredpunc',
  'edge-punct-en': 'punct-en-edge',
  'sat-3l-sm': 'punct-multi-sat',
};

const MODEL_KEYS = Object.keys(MODEL_IDS) as PunctuationModelId[];

export type PunctuationStatus =
  | 'not-downloaded' | 'downloading' | 'downloaded'
  | 'loading' | 'ready' | 'error' | 'disabled';

/**
 * Which model serves a language. Everything not Chinese or English goes to
 * SaT, which covers 85 languages; so does `auto` with nothing detected yet.
 *
 * Cantonese has two spellings in play and both must route to FireRedPunc.
 * `'cantonese'` is the app's own settings vocabulary (src/utils/languages.ts,
 * and what `sourceLanguage` actually holds); `'yue'` is the BCP-47 tag a
 * provider's `detectedLanguage` can carry. `baseLang` normalises neither into
 * the other, so matching only one sends half the Cantonese traffic to SaT.
 */
export function modelForLanguage(lang: string): PunctuationModelId {
  const base = baseLang(lang);
  if (base === 'zh' || base === 'yue' || base === 'cantonese') return 'fireredpunc';
  if (base === 'en') return 'edge-punct-en';
  return 'sat-3l-sm';
}

const INFERENCE_TIMEOUT_MS = 3_000;
const IDLE_UNLOAD_MS = 2 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_WORKER_CRASHES = 2;
const MIN_DEVICE_MEMORY_GB = 4;
const LATENCY_BUDGET_MS = 500;
/** Engineering defaults, not spec constants: how many recent successful calls
 *  the median is taken over, and the minimum sample size before it is trusted
 *  enough to disable a model. The spec only fixes the 500ms budget itself. */
const LATENCY_WINDOW = 5;
const LATENCY_MIN_SAMPLES = 3;

export interface PunctuationRuntimeOptions {
  /** The user setting. A disabled runtime never downloads and never loads. */
  isEnabled(): boolean;
  /** Status, progress and failure events for the app layer to forward to the
   *  store and to diagnostics. The runtime itself imports neither. */
  onStatus?(model: PunctuationModelId, status: PunctuationStatus, detail?: string): void;
  onDownloadProgress?(model: PunctuationModelId, percent: number): void;
  /** Reported once per model load, for the segmentation_model_load event. */
  onLoaded?(model: PunctuationModelId, backend: 'webgpu' | 'wasm', loadMs: number): void;
}

/** Debug override lets a tester simulate a small machine the same way
 *  `localParticipantConfig.ts` does for the local-participant budget check. */
function deviceMemoryGb(): number {
  try {
    const override = localStorage.getItem('debug:device-memory');
    if (override !== null) {
      const n = Number(override);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
  } catch { /* localStorage unavailable */ }
  return (navigator as { deviceMemory?: number }).deviceMemory ?? MIN_DEVICE_MEMORY_GB;
}

/** Pinned deliberately, not inherited from ORT's default: Edge-Punct's int8
 *  logits are not bit-identical across thread counts, and a flipped word is a
 *  visible wrong capital. The extension has no COOP/COEP, so it gets one
 *  thread; everywhere else, up to 4. */
function numThreadsFor(): number {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
  if (!isolated) return 1;
  return Math.min(4, navigator.hardwareConcurrency ?? 1);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface ModelState {
  status: PunctuationStatus;
  consecutiveFailures: number;
  /** Recent successful call latencies, most recent last, capped at LATENCY_WINDOW. */
  latencies: number[];
  idleTimer: ReturnType<typeof setTimeout> | null;
}

function initialModelState(): ModelState {
  return { status: 'not-downloaded', consecutiveFailures: 0, latencies: [], idleTimer: null };
}

export class PunctuationRuntime implements SegmentationRuntime {
  private readonly models: Record<PunctuationModelId, ModelState>;
  private session: WorkerSession | null = null;
  private backend: 'webgpu' | 'wasm' | null = null;
  private webgpuDisabledForLaunch = false;
  private workerCrashCount = 0;
  /** Bumped every time the shared session is torn down out-of-band (a crash
   *  or a WebGPU fallback), so a request that was in flight at the time can
   *  tell "my own failure" apart from "the session died out from under me"
   *  and skip double-counting a failure that whole-worker handling already
   *  accounted for. */
  private epoch = 0;
  private disposed = false;
  private counter = 0;
  /** Memoizes an in-flight `createSession()` bootstrap so two `punctuate()`
   *  calls for different models -- the exact case a shared worker exists for
   *  -- cannot each create their own Worker while both are still awaiting
   *  `checkWebGPU()`, before either has set `this.session`. Cleared once the
   *  bootstrap settles (success or failure), so a fresh attempt is made next
   *  time `ensureSession()` is needed. */
  private sessionPromise: Promise<WorkerSession> | null = null;
  private readonly loadReqs = new RequestRegistry<{ loadTimeMs: number; device: 'webgpu' | 'wasm' }>();
  private readonly runReqs = new RequestRegistry<PunctuationResult>();

  constructor(private readonly opts: PunctuationRuntimeOptions) {
    this.models = {
      'fireredpunc': initialModelState(),
      'edge-punct-en': initialModelState(),
      'sat-3l-sm': initialModelState(),
    };
  }

  get enabled(): boolean {
    return this.opts.isEnabled();
  }

  async punctuate(
    lang: string,
    text: string,
    opts?: { signal?: AbortSignal },
  ): Promise<PunctuationResult | null> {
    if (this.disposed) return null;
    if (opts?.signal?.aborted) return null;
    if (!this.opts.isEnabled()) return null;
    if (deviceMemoryGb() <= MIN_DEVICE_MEMORY_GB) return null;

    const model = modelForLanguage(lang);
    const state = this.models[model];
    if (state.status === 'disabled') return null;

    const ready = await this.prepareModel(model);
    if (!ready || this.disposed || state.status !== 'ready') return null;

    return this.runInference(model, text);
  }

  /**
   * Manual retry for a model stuck in `'error'` (a download failure). A
   * no-op for any other status: `'disabled'` models are rule-only for the
   * rest of the session by design, and every other status is already moving
   * on its own.
   */
  retryDownload(model: PunctuationModelId): void {
    if (this.models[model].status !== 'error') return;
    this.startDownload(model);
  }

  /** For the app-layer owner to call on unmount. Not part of
   *  `SegmentationRuntime`: clients never see this, only whoever constructed
   *  the runtime. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of MODEL_KEYS) this.clearIdleTimer(m);
    this.loadReqs.rejectAll(new Error('PunctuationRuntime disposed'));
    this.runReqs.rejectAll(new Error('PunctuationRuntime disposed'));
    this.session?.dispose();
    this.session = null;
    this.backend = null;
  }

  // ─── Per-model state machine ────────────────────────────────────────────

  /** Advances the model one step (check readiness, start a download, start a
   *  load) and returns whether it is immediately usable. Every step that
   *  needs the network or the worker is fire-and-forget: this never blocks a
   *  `punctuate()` call on a download or a load, matching "return null
   *  meanwhile" in the spec's lifecycle section. */
  private async prepareModel(model: PunctuationModelId): Promise<boolean> {
    const state = this.models[model];
    if (state.status === 'ready') return true;
    if (state.status === 'downloading' || state.status === 'loading') return false;
    if (state.status === 'error' || state.status === 'disabled') return false;

    if (state.status === 'not-downloaded') {
      const manifestId = MODEL_IDS[model];
      const manager = ModelManager.getInstance();
      let alreadyReady = false;
      try {
        alreadyReady = await manager.isModelReady(manifestId);
      } catch {
        alreadyReady = false;
      }
      // The status may have moved on while we were awaiting (disposed, or a
      // crash/fallback -- or a concurrent call for the same language --
      // already touched it): never overwrite that. This punctuate() call
      // simply misses it; the next call picks up wherever it landed.
      if (this.disposed || state.status !== 'not-downloaded') {
        return false;
      }
      if (!alreadyReady) {
        this.startDownload(model);
        return false;
      }
      state.status = 'downloaded';
      this.opts.onStatus?.(model, 'downloaded');
    }

    if (state.status === 'downloaded') {
      this.startLoad(model);
    }
    return false;
  }

  private startDownload(model: PunctuationModelId): void {
    const state = this.models[model];
    state.status = 'downloading';
    this.opts.onStatus?.(model, 'downloading');
    const manifestId = MODEL_IDS[model];
    const manager = ModelManager.getInstance();
    manager.downloadModel(manifestId, (progress) => {
      this.opts.onDownloadProgress?.(model, progress.percent);
    }).then(() => {
      if (this.disposed || state.status !== 'downloading') return;
      state.status = 'downloaded';
      this.opts.onStatus?.(model, 'downloaded');
    }).catch(() => {
      if (this.disposed || state.status !== 'downloading') return;
      // No automatic retry in the same launch: stays 'error' until
      // retryDownload() or the next app launch.
      state.status = 'error';
      this.opts.onStatus?.(model, 'error', 'download failed');
    });
  }

  private startLoad(model: PunctuationModelId): void {
    const state = this.models[model];
    const epochAtStart = this.epoch;
    state.status = 'loading';
    this.opts.onStatus?.(model, 'loading');
    void this.performLoad(model, epochAtStart);
  }

  private async performLoad(model: PunctuationModelId, epochAtStart: number): Promise<void> {
    const state = this.models[model];
    const manifestId = MODEL_IDS[model];
    const manager = ModelManager.getInstance();
    let fileUrls: Record<string, string> = {};
    try {
      const session = await this.ensureSession();
      if (this.disposed || this.epoch !== epochAtStart) return;
      fileUrls = await manager.getModelBlobUrls(manifestId);
      const id = this.nextId();
      const p = this.loadReqs.create(id);
      const initMessage: PunctuationInitMessage = {
        type: 'load',
        id,
        model,
        fileUrls,
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        numThreads: numThreadsFor(),
      };
      session.post(initMessage);
      const loaded = await p;
      manager.revokeBlobUrls(fileUrls);
      if (this.disposed || this.epoch !== epochAtStart) return;
      state.status = 'ready';
      state.consecutiveFailures = 0;
      this.opts.onLoaded?.(model, loaded.device, loaded.loadTimeMs);
      this.opts.onStatus?.(model, 'ready');
      // Arms the idle-unload timer here too, not only from a successful
      // inference: a model that loads but is never actually queried would
      // otherwise have no idle timer at all and stay resident indefinitely.
      this.touch(model);
    } catch {
      manager.revokeBlobUrls(fileUrls);
      // A crash or an earlier fallback already tore this attempt down and
      // decided the model's fate -- do not also count it here.
      if (this.disposed || this.epoch !== epochAtStart) return;
      if (this.backend === 'webgpu' && !this.webgpuDisabledForLaunch) {
        this.webgpuDisabledForLaunch = true;
        this.teardownSession();
        // Every model the old worker held resident or was bringing up loses
        // that state along with it -- not only the one whose load just
        // failed. Reset them all before retrying, the same way a crash does,
        // or a 'ready' model is left pointing at a dead adapter and a
        // 'loading' one is stuck forever (its own performLoad() catch bails
        // out silently: teardownSession() already bumped the epoch, so its
        // `this.epoch !== epochAtStart` check is true and it returns early).
        this.resetResidentModels('webgpu load failed; retrying on wasm');
        this.startLoad(model);
        return;
      }
      this.recordFailure(model, 'downloaded');
    }
  }

  private async runInference(model: PunctuationModelId, text: string): Promise<PunctuationResult | null> {
    const state = this.models[model];
    const session = this.session;
    if (!session) return null;

    const epochAtStart = this.epoch;
    const id = this.nextId();
    const p = this.runReqs.create(id);
    const runMessage: PunctuationRunMessage = { type: 'run', id, model, text };
    session.post(runMessage);
    this.touch(model);

    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const timedOut = Symbol('timeout');
    const timeout = new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), INFERENCE_TIMEOUT_MS);
    });

    try {
      const outcome = await Promise.race([p, timeout]);
      clearTimeout(timer!);
      if (outcome === timedOut) {
        if (this.epoch === epochAtStart && !this.disposed) this.recordFailure(model, 'ready');
        return null;
      }
      state.consecutiveFailures = 0;
      this.recordLatency(model, Date.now() - startedAt);
      return outcome;
    } catch {
      clearTimeout(timer!);
      // The registry only rejects via dispose() or a crash/fallback teardown,
      // both of which already decided this model's status.
      if (this.epoch !== epochAtStart || this.disposed) return null;
      this.recordFailure(model, 'ready');
      return null;
    }
  }

  private recordFailure(model: PunctuationModelId, fallbackStatus: 'downloaded' | 'ready'): void {
    const state = this.models[model];
    state.consecutiveFailures++;
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      state.status = 'disabled';
      this.opts.onStatus?.(model, 'disabled', 'too many failures');
      this.releaseModel(model);
    } else {
      state.status = fallbackStatus;
    }
  }

  private recordLatency(model: PunctuationModelId, ms: number): void {
    const state = this.models[model];
    state.latencies.push(ms);
    if (state.latencies.length > LATENCY_WINDOW) state.latencies.shift();
    if (
      state.latencies.length >= LATENCY_MIN_SAMPLES
      && median(state.latencies) > LATENCY_BUDGET_MS
    ) {
      state.status = 'disabled';
      this.opts.onStatus?.(model, 'disabled', 'too slow');
      this.releaseModel(model);
    }
  }

  // ─── Worker lifecycle ────────────────────────────────────────────────────

  private async ensureSession(): Promise<WorkerSession> {
    if (this.session) return this.session;
    if (!this.sessionPromise) {
      this.sessionPromise = this.createSession().finally(() => {
        this.sessionPromise = null;
      });
    }
    return this.sessionPromise;
  }

  /** The actual one-time bootstrap, memoized by `ensureSession()`'s
   *  `sessionPromise`: decide the backend, create the Worker, and wait for
   *  its boot handshake. Without the memoization, two concurrent callers
   *  would each pass `ensureSession()`'s `if (this.session)` guard while both
   *  are still awaiting `checkWebGPU()` below, each create their own Worker,
   *  and silently orphan whichever one loses the `this.session` assignment
   *  race -- `runInference()` always reads the shared `this.session` field,
   *  so the loser's model would never actually be reachable. */
  private async createSession(): Promise<WorkerSession> {
    const webgpuOk = !this.webgpuDisabledForLaunch && (await checkWebGPU()).available;
    const backend: 'webgpu' | 'wasm' = webgpuOk ? 'webgpu' : 'wasm';
    this.backend = backend;
    const session = new WorkerSession({
      makeWorker: () => createPunctuationWorker(backend),
      onMessage: (msg) => this.route(msg),
      onFatalError: () => this.handleWorkerCrash(),
    });
    this.session = session;
    // The punctuation worker posts 'ready' unprompted as soon as its module
    // finishes evaluating -- this message carries no init payload, so what we
    // send here is never read by the protocol on the other end.
    await session.start({ type: 'boot' });
    return session;
  }

  private route(msg: PunctuationWorkerOutbound): void {
    if (this.disposed) return;
    switch (msg.type) {
      case 'loaded':
        this.loadReqs.resolve(msg.id, { loadTimeMs: msg.loadTimeMs, device: msg.device });
        break;
      case 'result':
        this.runReqs.resolve(msg.id, msg.result);
        break;
      case 'error':
        if (msg.id) {
          // Only one of these has a matching pending entry; resolve/reject
          // on an unknown id is a no-op in RequestRegistry.
          this.loadReqs.reject(msg.id, new Error(msg.error));
          this.runReqs.reject(msg.id, new Error(msg.error));
        }
        break;
      case 'unloaded':
      case 'disposed':
        break;
    }
  }

  /** A genuine worker-level failure (pre-ready 'error' or any onerror). The
   *  first restarts on next need; the second gives up on the whole feature
   *  for the rest of the session. */
  private handleWorkerCrash(): void {
    this.workerCrashCount++;
    const disableAll = this.workerCrashCount >= MAX_WORKER_CRASHES;
    const wasWebgpu = this.backend === 'webgpu';
    this.teardownSession();
    // A crash on the WebGPU backend is at least as suspicious as a load
    // failure there -- fall back to WASM for any restart, rather than risk
    // crashing again on the same backend.
    if (wasWebgpu) this.webgpuDisabledForLaunch = true;

    if (disableAll) {
      for (const m of MODEL_KEYS) {
        if (this.models[m].status !== 'disabled') {
          this.models[m].status = 'disabled';
          this.opts.onStatus?.(m, 'disabled', 'worker crashed');
        }
      }
    } else {
      this.resetResidentModels('worker crashed, will reload');
    }
  }

  /** Every model the shared worker was holding resident ('ready') or bringing
   *  up ('loading') at the moment the worker itself was torn down out of
   *  band -- a crash or the WebGPU->WASM fallback both replace the worker out
   *  from under whichever models were using it. Reset them to 'downloaded' so
   *  the next punctuate() call reloads them into the replacement worker,
   *  instead of leaving 'loading' stuck forever (prepareModel refuses to
   *  touch it) or 'ready' pointing at an adapter that no longer exists.
   *  Shared by handleWorkerCrash() and the WebGPU->WASM load-failure
   *  fallback, so both paths reset every affected model the same way rather
   *  than only the one each was originally handling. */
  private resetResidentModels(detail: string): void {
    for (const m of MODEL_KEYS) {
      if (this.models[m].status === 'ready' || this.models[m].status === 'loading') {
        this.models[m].status = 'downloaded';
        this.opts.onStatus?.(m, 'downloaded', detail);
      }
    }
  }

  /** Disposes the current session (if any), rejects every in-flight load/run
   *  request, and bumps the epoch so those rejections are recognised as
   *  already-handled by whichever caller reacts to them. Used by both crash
   *  handling and the WebGPU->WASM fallback. */
  private teardownSession(): void {
    this.session?.dispose();
    this.session = null;
    this.backend = null;
    this.epoch++;
    this.loadReqs.rejectAll(new Error('worker session torn down'));
    this.runReqs.rejectAll(new Error('worker session torn down'));
    for (const m of MODEL_KEYS) this.clearIdleTimer(m);
  }

  // ─── Idle unload ─────────────────────────────────────────────────────────

  private touch(model: PunctuationModelId): void {
    this.clearIdleTimer(model);
    const state = this.models[model];
    state.idleTimer = setTimeout(() => this.idleUnload(model), IDLE_UNLOAD_MS);
  }

  private clearIdleTimer(model: PunctuationModelId): void {
    const state = this.models[model];
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  }

  private idleUnload(model: PunctuationModelId): void {
    const state = this.models[model];
    state.idleTimer = null;
    if (state.status !== 'ready' || !this.session) return;

    state.status = 'downloaded';
    this.opts.onStatus?.(model, 'downloaded', 'idle unload');
    this.releaseModel(model);
  }

  /** Posts `unload` for a model no longer in use, and tears the whole shared
   *  worker down too if nothing else needs it. The caller sets `state.status`
   *  to its post-release value BEFORE calling this, so the "is anything else
   *  still held" check below naturally excludes `model` itself.
   *
   *  Shared by the idle-unload timer (status becomes 'downloaded', so a later
   *  punctuate() call can reload it) and a model that just got disabled by
   *  recordFailure()/recordLatency() (status stays 'disabled' -- it is
   *  rule-only for the rest of the session -- but the adapter it holds, 0.25-
   *  1.5 GB per Task 12's measurements, must not stay resident anyway: it is
   *  never coming back into use). */
  private releaseModel(model: PunctuationModelId): void {
    const session = this.session;
    if (!session) return;

    const unloadMessage: PunctuationUnloadMessage = { type: 'unload', id: this.nextId(), model };
    session.post(unloadMessage);

    const stillHeld = MODEL_KEYS.some(
      (m) => this.models[m].status === 'ready' || this.models[m].status === 'loading',
    );
    if (!stillHeld) {
      session.dispose();
      this.session = null;
      this.backend = null;
    }
  }

  private nextId(): string {
    return `pn_${++this.counter}`;
  }
}
