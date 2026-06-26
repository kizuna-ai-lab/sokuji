import type { ServerMsg } from './nativeProtocol';

export interface NativeAsrResult { text: string; startSample?: number; durationMs: number; recognitionTimeMs: number; }

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export class NativeAsrClient {
  onResult: ((r: NativeAsrResult) => void) | null = null;
  onPartialResult: ((text: string) => void) | null = null;
  onSpeechStart: (() => void) | null = null;
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (m: ServerMsg) => void; reject: (e: Error) => void }>();

  private async connect(): Promise<void> {
    if (this.ws) return;
    const r = await electron().invoke('native-host:start');
    if (!r?.ok) throw new Error(r?.error || 'failed to start native host');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => { this.onError?.('native host WS error'); reject(new Error('WS error')); };
      ws.onclose = () => this.rejectAllPending(new Error('native host disconnected'));
      ws.onmessage = (e) => this.onMessage(e.data);
    });
  }

  private rejectAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  private onMessage(data: any) {
    const msg = JSON.parse(data) as any;
    if (msg.type === 'speech_start') { this.onSpeechStart?.(); return; }
    if (msg.type === 'partial') { this.onPartialResult?.(msg.text); return; }
    // ASR results are pushed without an id; TTS results (Phase 1) carry an id.
    if (msg.type === 'result' && msg.id === undefined) {
      this.onResult?.({ text: msg.text, startSample: msg.startSample, durationMs: msg.durationMs, recognitionTimeMs: msg.recognitionTimeMs });
      return;
    }
    if (msg.type === 'error') {
      this.onError?.(msg.message);
      if (typeof msg.id === 'number') {
        this.pending.get(msg.id)?.reject(new Error(msg.message));
        this.pending.delete(msg.id);
      }
      return;
    }
    if (typeof msg.id === 'number') { this.pending.get(msg.id)?.resolve(msg); this.pending.delete(msg.id); }
  }

  private send(payload: object): Promise<ServerMsg> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws!.send(JSON.stringify({ ...payload, id })); });
  }

  async init(
    language = '', modelId?: string, sampleRate = 24000,
    vad?: { threshold?: number; minSilence?: number; minSpeech?: number },
    device?: string,
  ): Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string }> {
    await this.connect();
    this.onStatus?.('[native-asr] init…');
    const msg = await this.send({
      type: 'asr_init', language, model: modelId, sampleRate, device,
      vadThreshold: vad?.threshold, vadMinSilenceDuration: vad?.minSilence, vadMinSpeechDuration: vad?.minSpeech,
    });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason };
  }

  feedAudio(samples: Int16Array, _sampleRate: number): void {
    this.ws?.send(samples.buffer);   // server is in asr binary mode after init
  }

  async flush(): Promise<void> { await this.send({ type: 'asr_flush' }); }

  dispose(): void { this.rejectAllPending(new Error('native host disconnected')); try { this.ws?.close(); } catch (_) {} this.ws = null; }
}
