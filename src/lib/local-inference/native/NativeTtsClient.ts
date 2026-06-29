import type { TtsResult } from '../engine/TtsEngine';
import type { ServerMsg } from './nativeProtocol';

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export interface TtsReady {
  sampleRate: number; loadTimeMs: number;
  backend?: string; device?: string; computeType?: string; rtf?: number;
  streaming: boolean; clones: boolean; memoryBytes?: number; fallbackReason?: string;
}

export class NativeTtsClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pendingJson = new Map<number, (m: ServerMsg) => void>();
  private pendingBinary = new Map<number, (b: ArrayBuffer) => void>();
  private streamHandlers = new Map<number, (pcm: Float32Array, seq: number) => void>();
  private lastBinary: ArrayBuffer | null = null;
  private streaming = false;          // cached from the last init()
  private inFlightId = 0;             // id of the current generate (for cancel())

  private async connect(): Promise<void> {
    if (this.ws) return;
    const r = await electron().invoke('native-host:start');
    if (!r?.ok) throw new Error(r?.error || 'failed to start native host');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => { this.onError?.('native host WS error'); reject(new Error('WS error')); };
      ws.onmessage = (e) => this.onMessage(e.data);
    });
  }

  private onMessage(data: any) {
    if (data instanceof ArrayBuffer) { this.lastBinary = data; return; }
    const msg = JSON.parse(data) as ServerMsg;
    if (msg.type === 'error') { this.onError?.(msg.message); if (msg.id) this.reject(msg.id); return; }
    const id = (msg as any).id as number;
    if (msg.type === 'tts_chunk') {                       // binary frame precedes this chunk meta
      const onChunk = this.streamHandlers.get(id);
      if (onChunk && this.lastBinary) { onChunk(new Float32Array(this.lastBinary), msg.seq); this.lastBinary = null; }
      return;                                             // do NOT resolve pendingJson; wait for tts_done
    }
    if (msg.type === 'tts_done') {
      this.streamHandlers.delete(id);
      this.pendingJson.get(id)?.(msg); this.pendingJson.delete(id);
      return;
    }
    if (msg.type === 'result') {                          // one-shot: pair the buffered binary
      const binResolve = this.pendingBinary.get(id);
      if (binResolve && this.lastBinary) { binResolve(this.lastBinary); this.lastBinary = null; this.pendingBinary.delete(id); }
    }
    this.pendingJson.get(id)?.(msg);
    this.pendingJson.delete(id);
  }

  private reject(id: number) {
    this.pendingJson.delete(id); this.pendingBinary.delete(id); this.streamHandlers.delete(id);
  }

  private send(payload: object, expectBinary = false): Promise<{ msg: ServerMsg; binary?: ArrayBuffer; id: number }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let binary: ArrayBuffer | undefined;
      if (expectBinary) this.pendingBinary.set(id, (b) => { binary = b; });
      this.pendingJson.set(id, (msg) => {
        if (msg.type === 'error') return reject(new Error(msg.message));
        resolve({ msg, binary, id });
      });
      this.ws!.send(JSON.stringify({ ...payload, id }));
    });
  }

  async init(model?: string): Promise<TtsReady> {
    await this.connect();
    this.onStatus?.('[native-tts] init…');
    const { msg } = await this.send({ type: 'tts_init', model });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    this.streaming = !!r.streaming;
    return {
      sampleRate: r.sampleRate ?? 24000, loadTimeMs: r.loadTimeMs,
      backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf,
      streaming: !!r.streaming, clones: !!r.clones, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason,
    };
  }

  async setReferenceVoice(audio: Float32Array, sampleRate: number): Promise<void> {
    this.ws!.send(audio.buffer);                          // binary frame precedes the control message
    await this.send({ type: 'set_voice', sampleRate });
  }

  async generate(text: string, speed = 1.0, onChunk?: (pcm: Float32Array, seq: number) => void): Promise<TtsResult> {
    if (this.streaming && onChunk) {
      const id = this.nextId++;
      this.inFlightId = id;
      this.streamHandlers.set(id, onChunk);
      const done = await new Promise<ServerMsg>((resolve, reject) => {
        this.pendingJson.set(id, (m) => { if (m.type === 'error') return reject(new Error(m.message)); resolve(m); });
        this.ws!.send(JSON.stringify({ type: 'tts_generate', text, speed, id }));
      });
      const d = done as Extract<ServerMsg, { type: 'tts_done' }>;
      return { samples: new Float32Array(0), sampleRate: 24000, generationTimeMs: d.generationTimeMs };
    }
    const { msg, binary, id } = await this.send({ type: 'tts_generate', text, speed }, true);
    this.inFlightId = id;
    const r = msg as Extract<ServerMsg, { type: 'result' }>;
    return { samples: new Float32Array(binary!), sampleRate: r.sampleRate, generationTimeMs: r.generationTimeMs };
  }

  cancel(): void {
    if (this.inFlightId && this.ws) {
      try { this.ws.send(JSON.stringify({ type: 'tts_cancel', id: this.inFlightId })); } catch (_) {}
    }
  }

  dispose(): void {
    try { this.ws?.close(); } catch (_) {}
    this.ws = null; this.pendingJson.clear(); this.pendingBinary.clear(); this.streamHandlers.clear();
  }
}
