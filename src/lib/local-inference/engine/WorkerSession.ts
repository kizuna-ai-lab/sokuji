/**
 * WorkerSession — the Worker lifecycle shared by all WASM local-inference
 * engines, extracted from four verbatim copies. It owns ONLY lifecycle:
 * synchronous worker creation, the init handshake (post init → await 'ready' /
 * reject on pre-ready 'error'/onerror), revoke-blobs-once-on-first-settle, the
 * onerror path, dispose, and post(). It has zero domain knowledge — the engine
 * supplies `onMessage` for its domain messages and `revokeBlobs`/`onFatalError`.
 *
 * Creating the worker in the constructor (not inside an awaited step) is what
 * honors TtsEngine's supertonic constraint: the engine awaits its blobs, then
 * `new WorkerSession(...)` creates the worker in the same microtask.
 */
export interface WorkerSessionOptions {
  /** Create the Worker. Called synchronously in the constructor. */
  makeWorker: () => Worker;
  /** Every message except the init-handshake 'ready'/'error' (status, partial,
   *  result, audio-chunk, disposed, and POST-ready errors). */
  onMessage: (msg: any) => void;
  /** Called exactly once, on the first settle. Omit when there is nothing to
   *  revoke (e.g. edge-TTS). */
  revokeBlobs?: () => void;
  /** Worker-level failure: the pre-ready 'error' message, and any onerror
   *  event (pre- or post-ready). Mirrors each engine's `onError` callback. */
  onFatalError?: (message: string) => void;
}

export class WorkerSession {
  private readonly worker: Worker;
  private settled = false;
  private revoked = false;
  private _ready = false;
  private resolveReady: ((msg: any) => void) | null = null;
  private rejectReady: ((err: Error) => void) | null = null;

  constructor(private readonly opts: WorkerSessionOptions) {
    this.worker = opts.makeWorker();
    this.worker.onmessage = (e: MessageEvent) => this.handleMessage(e.data);
    this.worker.onerror = (e: ErrorEvent) => this.handleError(e.message || 'Worker error');
  }

  /** Post the init message and resolve when the worker reports 'ready'
   *  (reject on a pre-ready 'error' message or onerror). */
  start(initMessage: object, transfer?: Transferable[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
      this.post(initMessage, transfer);
    });
  }

  post(msg: object, transfer?: Transferable[]): void {
    if (transfer && transfer.length) this.worker.postMessage(msg, transfer);
    else this.worker.postMessage(msg);
  }

  get ready(): boolean {
    return this._ready;
  }

  dispose(): void {
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
    this._ready = false;
  }

  private handleMessage(msg: any): void {
    if (!this.settled && msg?.type === 'ready') {
      this.settled = true;
      this._ready = true;
      this.revokeOnce();
      this.resolveReady?.(msg);
      return;
    }
    if (!this.settled && msg?.type === 'error') {
      this.settled = true;
      this.revokeOnce();
      this.opts.onFatalError?.(msg.error);
      this.rejectReady?.(new Error(msg.error));
      return;
    }
    this.opts.onMessage(msg);
  }

  private handleError(message: string): void {
    this.opts.onFatalError?.(message);
    if (!this.settled) {
      this.settled = true;
      this.revokeOnce();
      this.rejectReady?.(new Error(message));
    }
  }

  private revokeOnce(): void {
    if (this.revoked) return;
    this.revoked = true;
    this.opts.revokeBlobs?.();
  }
}
