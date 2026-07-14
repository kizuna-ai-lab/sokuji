import type { ServerMsg, NativeModelState, ModelProgressMsg, ModelDownloadStatus, NativeModelInfo, NativeVoiceInfo, VariantInfo } from './nativeProtocol';
import { SidecarConnection, type ISidecarConnection } from './SidecarConnection';

interface DownloadHandle {
  onProgress?: (p: ModelProgressMsg) => void;
  resolve: (status: ModelDownloadStatus) => void;
  reject: (err: Error) => void;
}

/** Manages native-model download/status against the sidecar (not session-bound). */
export class NativeModelClient {
  private conn: ISidecarConnection;
  // In-flight downloads keyed by model — completion/progress is pushed (not
  // id-matched) so cancel can arrive on the same socket while a download runs.
  private downloads = new Map<string, DownloadHandle>();

  constructor(conn: ISidecarConnection = new SidecarConnection()) {
    this.conn = conn;
    this.conn.onMessage((msg) => this.onPush(msg));
    // Downloads are client-owned correlation state (push-routed by model), so the
    // connection can't reject them — do it here when the socket drops.
    this.conn.onClose((err) => {
      for (const h of this.downloads.values()) h.reject(err);
      this.downloads.clear();
    });
  }

  private onPush(msg: ServerMsg): void {
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
    }
  }

  async status(models: string[], repos?: Record<string, string>): Promise<Record<string, NativeModelState>> {
    const msg = await this.conn.request({ type: 'model_status', models, repos });
    return (msg as Extract<ServerMsg, { type: 'model_status_result' }>).statuses;
  }

  /** Query the sidecar for detected hardware (CPU/GPU/NPU + installed backends). */
  async hardwareInfo(): Promise<Extract<ServerMsg, { type: 'hardware_info_result' }>> {
    const msg = await this.conn.request({ type: 'hardware_info' });
    return msg as Extract<ServerMsg, { type: 'hardware_info_result' }>;
  }

  /** Query the per-machine model catalog (languages, recommended, tier availability).
   *  `kind` selects the ASR catalog (default) or the translation catalog — they are
   *  separate model lists sidecar-side, so callers fetch each independently. */
  async modelsCatalog(models?: string[], kind?: 'asr' | 'translate' | 'tts'): Promise<NativeModelInfo[]> {
    const payload: { type: 'models_catalog'; models?: string[]; kind?: 'asr' | 'translate' | 'tts' } = { type: 'models_catalog' };
    if (models) payload.models = models;
    if (kind) payload.kind = kind;
    const msg = await this.conn.request(payload);
    return (msg as Extract<ServerMsg, { type: 'models_catalog_result' }>).models;
  }

  /** Query available variants (quant levels) for a model, with hardware feasibility info. */
  async listVariants(model: string, asrId: string | null, ttsId: string | null, pin?: string)
    : Promise<{ variants: VariantInfo[]; recommended: string }> {
    const payload: { type: 'list_variants'; model: string; asrId?: string; ttsId?: string; pin?: string } = { type: 'list_variants', model };
    if (asrId) payload.asrId = asrId;
    if (ttsId) payload.ttsId = ttsId;
    if (pin) payload.pin = pin;
    const msg = await this.conn.request(payload);
    const r = msg as Extract<ServerMsg, { type: 'list_variants_result' }>;
    return { variants: r.variants, recommended: r.recommended };
  }

  /** Built-in TTS voice descriptors for a voice-capable model (empty if not downloaded). */
  async listTtsVoices(model?: string): Promise<NativeVoiceInfo[]> {
    const payload: { type: 'list_tts_voices'; model?: string } = { type: 'list_tts_voices' };
    if (model) payload.model = model;
    const msg = await this.conn.request(payload);
    return (msg as Extract<ServerMsg, { type: 'list_tts_voices_result' }>).voices;
  }

  /** Remove a model from the sidecar's cache; resolves to the bytes freed. */
  async delete(model: string, repo?: string): Promise<number> {
    const msg = await this.conn.request({ type: 'model_delete', model, repo });
    if (msg.type === 'error') throw new Error(msg.message);
    return (msg as Extract<ServerMsg, { type: 'model_delete_result' }>).freed;
  }

  /** Start a download; resolves 'ready' on completion or 'cancelled' if cancel()
   *  stopped it. Rejects on a sidecar error tagged with this model or on disconnect. */
  async download(model: string, onProgress?: (p: ModelProgressMsg) => void, repo?: string): Promise<ModelDownloadStatus> {
    await this.conn.connect();
    return new Promise<ModelDownloadStatus>((resolve, reject) => {
      this.downloads.set(model, { onProgress, resolve, reject });
      const payload: { type: 'model_download'; model: string; id: number; repo?: string } =
        { type: 'model_download', model, id: this.conn.nextId() };
      if (repo) payload.repo = repo;
      this.conn.send(payload);
    });
  }

  /** Signal an in-flight download to stop at the next file boundary. */
  async cancel(model: string): Promise<void> {
    this.conn.send({ type: 'model_cancel', model, id: this.conn.nextId() });
  }

  dispose(): void {
    for (const h of this.downloads.values()) h.reject(new Error('native host disconnected'));
    this.downloads.clear();
    this.conn.dispose();
  }
}
