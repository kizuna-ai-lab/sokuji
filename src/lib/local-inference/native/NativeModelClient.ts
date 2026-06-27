import type { ServerMsg, NativeModelState, ModelProgressMsg, ModelDownloadStatus, NativeModelInfo, VariantInfo } from './nativeProtocol';

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
  private connecting: Promise<void> | null = null;   // single-flight guard: concurrent connect() calls share one connection
  private nextId = 1;
  private pending = new Map<number, { resolve: (m: ServerMsg) => void; reject: (e: Error) => void }>();
  // In-flight downloads keyed by model — completion/progress is pushed (not
  // id-matched) so cancel can arrive on the same socket while a download runs.
  private downloads = new Map<string, DownloadHandle>();

  private rejectAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
    for (const h of this.downloads.values()) h.reject(err);
    this.downloads.clear();
  }

  private async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    // Single-flight: while a connection is being established (the sidecar can take
    // seconds to boot on first use), concurrent callers must await the SAME attempt
    // rather than each opening their own socket — otherwise the duplicates race and
    // an orphaned socket's onclose() rejects everyone's in-flight requests.
    if (this.connecting) return this.connecting;
    this.connecting = this._connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async _connect(): Promise<void> {
    const r = await electron().invoke('native-host:start');
    if (!r?.ok) throw new Error(r?.error || 'failed to start native host');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => reject(new Error('native host WS error'));
      ws.onclose = () => this.rejectAllPending(new Error('native host disconnected'));
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
    if (typeof id === 'number') {
      if (msg.type === 'error') {
        this.pending.get(id)?.reject(new Error(msg.message));
      } else {
        this.pending.get(id)?.resolve(msg);
      }
      this.pending.delete(id);
    }
  }

  private send(payload: object): Promise<ServerMsg> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws!.send(JSON.stringify({ ...payload, id })); });
  }

  async status(models: string[], repos?: Record<string, string>): Promise<Record<string, NativeModelState>> {
    await this.connect();
    const msg = await this.send({ type: 'model_status', models, repos });
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

  /** Query the per-machine model catalog (languages, recommended, tier availability).
   *  `kind` selects the ASR catalog (default) or the translation catalog — they are
   *  separate model lists sidecar-side, so callers fetch each independently. */
  async modelsCatalog(models?: string[], kind?: 'asr' | 'translate'): Promise<NativeModelInfo[]> {
    await this.connect();
    const payload: { type: 'models_catalog'; models?: string[]; kind?: 'asr' | 'translate' } = { type: 'models_catalog' };
    if (models) payload.models = models;
    if (kind) payload.kind = kind;
    const msg = await this.send(payload);
    return (msg as Extract<ServerMsg, { type: 'models_catalog_result' }>).models;
  }

  /** Query available variants (quant levels) for a model, with hardware feasibility info.
   *  `asrId`/`ttsId` tell the sidecar what is already loaded so it can compute the
   *  remaining VRAM reserve when evaluating each variant. `pin` pins a specific variant. */
  async listVariants(model: string, asrId: string | null, ttsId: string | null, pin?: string)
    : Promise<{ variants: VariantInfo[]; recommended: string }> {
    await this.connect();
    const payload: { type: 'list_variants'; model: string; asrId?: string; ttsId?: string; pin?: string } = { type: 'list_variants', model };
    if (asrId) payload.asrId = asrId;
    if (ttsId) payload.ttsId = ttsId;
    if (pin) payload.pin = pin;
    const msg = await this.send(payload);
    const r = msg as Extract<ServerMsg, { type: 'list_variants_result' }>;
    return { variants: r.variants, recommended: r.recommended };
  }

  /** Remove a model from the sidecar's cache; resolves to the bytes freed. */
  async delete(model: string): Promise<number> {
    await this.connect();
    const msg = await this.send({ type: 'model_delete', model });
    if (msg.type === 'error') throw new Error(msg.message);
    return (msg as Extract<ServerMsg, { type: 'model_delete_result' }>).freed;
  }

  /** Start a download; resolves 'ready' on completion or 'cancelled' if cancel()
   *  stopped it. Rejects on a sidecar error tagged with this model. `repo` selects
   *  a chosen variant's repo (the sidecar fetches that repo instead of the model's
   *  default — keeps download in lock-step with the deterministic variant load). */
  async download(model: string, onProgress?: (p: ModelProgressMsg) => void, repo?: string): Promise<ModelDownloadStatus> {
    await this.connect();
    return new Promise<ModelDownloadStatus>((resolve, reject) => {
      this.downloads.set(model, { onProgress, resolve, reject });
      const payload: { type: 'model_download'; model: string; id: number; repo?: string } =
        { type: 'model_download', model, id: this.nextId++ };
      if (repo) payload.repo = repo;
      this.ws!.send(JSON.stringify(payload));
    });
  }

  /** Signal an in-flight download to stop at the next file boundary. */
  async cancel(model: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'model_cancel', model, id: this.nextId++ }));
  }

  dispose(): void {
    this.rejectAllPending(new Error('native host disconnected'));
    try { this.ws?.close(); } catch (_) {}
    this.ws = null;
  }
}
