import type { ServerMsg, NativeModelState, ModelProgressMsg, ModelDownloadStatus, NativeModelInfo } from './nativeProtocol';

interface DownloadHandle {
  onProgress?: (p: ModelProgressMsg) => void;
  resolve: (status: ModelDownloadStatus) => void;
  reject: (err: Error) => void;
}

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
  // In-flight downloads keyed by model — completion/progress is pushed (not
  // id-matched) so cancel can arrive on the same socket while a download runs.
  private downloads = new Map<string, DownloadHandle>();

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
    // Push-routed download messages (no request id — keyed by model).
    if (msg.type === 'model_progress') { this.downloads.get(msg.model)?.onProgress?.(msg); return; }
    if (msg.type === 'model_download_done') {
      const h = this.downloads.get(msg.model);
      this.downloads.delete(msg.model);
      h?.resolve(msg.status);
      return;
    }
    if (msg.type === 'error' && msg.model && this.downloads.has(msg.model)) {
      const h = this.downloads.get(msg.model)!;
      this.downloads.delete(msg.model);
      h.reject(new Error(msg.message));
      return;
    }
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

  /** Query the sidecar for detected hardware (CPU/GPU/NPU + installed backends). */
  async hardwareInfo(): Promise<Extract<ServerMsg, { type: 'hardware_info_result' }>> {
    await this.connect();
    const msg = await this.send({ type: 'hardware_info' });
    return msg as Extract<ServerMsg, { type: 'hardware_info_result' }>;
  }

  /** Query the per-machine model catalog (languages, recommended, tier availability). */
  async modelsCatalog(models?: string[]): Promise<NativeModelInfo[]> {
    await this.connect();
    const msg = await this.send(models ? { type: 'models_catalog', models } : { type: 'models_catalog' });
    return (msg as Extract<ServerMsg, { type: 'models_catalog_result' }>).models;
  }

  /** Remove a model from the sidecar's cache; resolves to the bytes freed. */
  async delete(model: string): Promise<number> {
    await this.connect();
    const msg = await this.send({ type: 'model_delete', model });
    if (msg.type === 'error') throw new Error(msg.message);
    return (msg as Extract<ServerMsg, { type: 'model_delete_result' }>).freed;
  }

  /** Start a download; resolves 'ready' on completion or 'cancelled' if cancel()
   *  stopped it. Rejects on a sidecar error tagged with this model. */
  async download(model: string, onProgress?: (p: ModelProgressMsg) => void): Promise<ModelDownloadStatus> {
    await this.connect();
    return new Promise<ModelDownloadStatus>((resolve, reject) => {
      this.downloads.set(model, { onProgress, resolve, reject });
      this.ws!.send(JSON.stringify({ type: 'model_download', model, id: this.nextId++ }));
    });
  }

  /** Signal an in-flight download to stop at the next file boundary. */
  async cancel(model: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'model_cancel', model, id: this.nextId++ }));
  }

  dispose(): void {
    try { this.ws?.close(); } catch (_) {}
    this.ws = null;
    this.pending.clear();
    this.downloads.clear();
  }
}
