import { WorkerSession } from '../local-inference/engine/WorkerSession';
import { ModelManager } from '../local-inference/ModelManager';
import type {
  TurnConnectMessage,
  TurnDisconnectMessage,
  TurnInitMessage,
} from '../local-inference/workers/_shared/turn-protocol';
import { numThreadsFor } from '../segmentation/PunctuationRuntime';
import { describeCause, reportWarning } from '../diagnostics/report';
import { checkWebGPU } from '../../utils/webgpu';
import { createTurnWorker } from './createTurnWorker';
import { SMART_TURN_MODEL_ID } from './smartTurn';

/** One VAD worker's line to the Smart Turn worker. */
export interface TurnConnection {
  /** Goes to the VAD worker in its init message, transferred. */
  port: MessagePort;
  release(): void;
}

type Backend = 'webgpu' | 'wasm';

/** The one Smart Turn worker every leg shares, disposed with the last connection. */
export class TurnRuntime {
  private session: WorkerSession | null = null;
  private loading: Promise<WorkerSession | null> | null = null;
  private webgpuFailed = false;
  private nextId = 0;
  /** Each open connection and the session holding its port; null until delivered. */
  private readonly live = new Map<number, WorkerSession | null>();

  /** Null without the model on disk: the run is then Normal. */
  async connect(): Promise<TurnConnection | null> {
    let onDisk = false;
    try {
      onDisk = await ModelManager.getInstance().isModelReady(SMART_TURN_MODEL_ID);
    } catch {
      onDisk = false;
    }
    if (!onDisk) return null;
    const id = ++this.nextId;
    const channel = new MessageChannel();
    this.live.set(id, null);
    void this.load().then((session) => {
      if (session && this.live.has(id)) {
        this.live.set(id, session);
        const message: TurnConnectMessage = { type: 'connect', id, port: channel.port2 };
        session.post(message, [channel.port2]);
      } else {
        channel.port2.close();
      }
    });
    return { port: channel.port1, release: () => this.release(id) };
  }

  private release(id: number): void {
    if (!this.live.has(id)) return;
    const holder = this.live.get(id);
    this.live.delete(id);
    if (holder) {
      const message: TurnDisconnectMessage = { type: 'disconnect', id };
      holder.post(message);
    }
    if (this.session && ![...this.live.values()].some((s) => s === null || s === this.session)) {
      this.session.dispose();
      this.session = null;
    }
  }

  private load(): Promise<WorkerSession | null> {
    if (this.session) return Promise.resolve(this.session);
    if (!this.loading) {
      this.loading = this.open().finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  private async open(): Promise<WorkerSession | null> {
    const caps = await checkWebGPU();
    const backend: Backend = !this.webgpuFailed && caps.available && !caps.softwareOnly ? 'webgpu' : 'wasm';
    const manager = ModelManager.getInstance();
    let fileUrls: Record<string, string>;
    try {
      fileUrls = await manager.getModelBlobUrls(SMART_TURN_MODEL_ID);
    } catch (err) {
      reportWarning('SmartTurn', `Smart Turn could not load; turns end on silence: ${describeCause(err)}`, {
        cause: err,
        dedupeKey: 'smart-turn:load',
      });
      return null;
    }
    let session: WorkerSession;
    try {
      session = await this.start(backend, fileUrls);
    } catch (err) {
      if (backend === 'webgpu') {
        this.webgpuFailed = true;
        return this.open();
      }
      reportWarning('SmartTurn', `Smart Turn could not load; turns end on silence: ${describeCause(err)}`, {
        cause: err,
        dedupeKey: 'smart-turn:load',
      });
      return null;
    }
    if (this.live.size === 0) {
      session.dispose();
      return null;
    }
    this.session = session;
    return session;
  }

  private async start(backend: Backend, fileUrls: Record<string, string>): Promise<WorkerSession> {
    const manager = ModelManager.getInstance();
    const session: WorkerSession = new WorkerSession({
      makeWorker: () => createTurnWorker(backend),
      onMessage: (msg) => {
        if (msg?.type === 'run-failed') this.crashed(session, backend, String(msg.error));
      },
      revokeBlobs: () => manager.revokeBlobUrls(fileUrls),
      onFatalError: (message) => this.crashed(session, backend, message),
    });
    const init: TurnInitMessage = {
      type: 'init',
      fileUrls,
      ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
      numThreads: numThreadsFor(),
    };
    await session.start(init);
    return session;
  }

  /** A loaded worker died: its ports went with it, so this run stays Normal; the next connection reloads. */
  private crashed(session: WorkerSession, backend: Backend, message: string): void {
    if (this.session !== session) return;
    this.session = null;
    for (const [id, holder] of this.live) if (holder === session) this.live.delete(id);
    session.dispose();
    if (backend === 'webgpu') this.webgpuFailed = true;
    reportWarning('SmartTurn', `Smart Turn stopped; turns end on silence: ${message}`, { dedupeKey: 'smart-turn:crash' });
  }
}

export const turnRuntime = new TurnRuntime();
