import type { ServerMsg, NativeModelState, ModelProgressMsg } from './nativeProtocol';

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

/** Manages native-model download/status against the sidecar (not session-bound). */
export class NativeModelClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, (m: ServerMsg) => void>();
  private progressCb: ((p: ModelProgressMsg) => void) | null = null;

  private async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const r = await electron().invoke('native-host:start');
    if (!r?.ok) throw new Error(r?.error || 'failed to start native host');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => reject(new Error('native host WS error'));
      ws.onmessage = (e) => this.onMessage(e.data);
    });
  }

  private onMessage(data: any): void {
    const msg = JSON.parse(data) as ServerMsg;
    if (msg.type === 'model_progress') { this.progressCb?.(msg); return; }
    const id = (msg as any).id as number;
    if (typeof id === 'number') { this.pending.get(id)?.(msg); this.pending.delete(id); }
  }

  private send(payload: object): Promise<ServerMsg> {
    const id = this.nextId++;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.ws!.send(JSON.stringify({ ...payload, id })); });
  }

  async status(models: string[]): Promise<Record<string, NativeModelState>> {
    await this.connect();
    const msg = await this.send({ type: 'model_status', models });
    return (msg as Extract<ServerMsg, { type: 'model_status_result' }>).statuses;
  }

  async sizes(models: string[]): Promise<Record<string, number>> {
    await this.connect();
    const msg = await this.send({ type: 'model_sizes', models });
    return (msg as Extract<ServerMsg, { type: 'model_sizes_result' }>).sizes;
  }

  /** Remove a model from the sidecar's cache; resolves to the bytes freed. */
  async delete(model: string): Promise<number> {
    await this.connect();
    const msg = await this.send({ type: 'model_delete', model });
    if (msg.type === 'error') throw new Error(msg.message);
    return (msg as Extract<ServerMsg, { type: 'model_delete_result' }>).freed;
  }

  async download(model: string, onProgress?: (p: ModelProgressMsg) => void): Promise<void> {
    await this.connect();
    this.progressCb = onProgress ?? null;
    try {
      const msg = await this.send({ type: 'model_download', model });
      if (msg.type === 'error') throw new Error(msg.message);
    } finally {
      this.progressCb = null;
    }
  }

  dispose(): void { try { this.ws?.close(); } catch (_) {} this.ws = null; this.pending.clear(); }
}
