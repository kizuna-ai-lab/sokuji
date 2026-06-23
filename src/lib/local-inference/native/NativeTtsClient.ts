import type { TtsResult } from '../engine/TtsEngine';
import type { ServerMsg } from './nativeProtocol';

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export class NativeTtsClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pendingJson = new Map<number, (m: ServerMsg) => void>();
  private pendingBinary = new Map<number, (b: ArrayBuffer) => void>();
  private lastBinary: ArrayBuffer | null = null;

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
    if (msg.type === 'error') { this.onError?.(msg.message); if (msg.id) this.reject(msg.id, msg.message); return; }
    const id = (msg as any).id as number;
    if (msg.type === 'result') {
      const binResolve = this.pendingBinary.get(id);
      if (binResolve && this.lastBinary) { binResolve(this.lastBinary); this.lastBinary = null; this.pendingBinary.delete(id); }
    }
    this.pendingJson.get(id)?.(msg);
    this.pendingJson.delete(id);
  }

  private reject(id: number, message: string) {
    this.pendingJson.delete(id); this.pendingBinary.delete(id);
    this.onError?.(message);
  }

  private send(payload: object, expectBinary = false): Promise<{ msg: ServerMsg; binary?: ArrayBuffer }> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let binary: ArrayBuffer | undefined;
      if (expectBinary) this.pendingBinary.set(id, (b) => { binary = b; });
      this.pendingJson.set(id, (msg) => {
        if (msg.type === 'error') return reject(new Error(msg.message));
        resolve({ msg, binary });
      });
      this.ws!.send(JSON.stringify({ ...payload, id }));
    });
  }

  async init(model?: string): Promise<{ sampleRate: number; loadTimeMs: number }> {
    await this.connect();
    this.onStatus?.('[native-tts] init…');
    const { msg } = await this.send({ type: 'init', model });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { sampleRate: r.sampleRate, loadTimeMs: r.loadTimeMs };
  }

  async setReferenceVoice(audio: Float32Array, sampleRate: number): Promise<void> {
    this.ws!.send(audio.buffer);                         // binary frame precedes the control message
    await this.send({ type: 'set_voice', sampleRate });
  }

  async generate(text: string, speed = 1.0): Promise<TtsResult> {
    const { msg, binary } = await this.send({ type: 'generate', text, speed }, true);
    const r = msg as Extract<ServerMsg, { type: 'result' }>;
    return { samples: new Float32Array(binary!), sampleRate: r.sampleRate, generationTimeMs: r.generationTimeMs };
  }

  dispose(): void {
    try { this.ws?.close(); } catch (_) {}
    this.ws = null; this.pendingJson.clear(); this.pendingBinary.clear();
  }
}
