import type { TranslationResult } from '../engine/TranslationEngine';
import type { ServerMsg } from './nativeProtocol';

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export class NativeTranslateClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (m: ServerMsg) => void; reject: (e: Error) => void }>();

  private rejectAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

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
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMsg;
        if (msg.type === 'error') {
          this.onError?.(msg.message);
          const id = typeof (msg as any).id === 'number' ? (msg as any).id as number : undefined;
          if (id !== undefined) {
            this.pending.get(id)?.reject(new Error(msg.message));
            this.pending.delete(id);
          }
          return;
        }
        const id = (msg as any).id as number;
        this.pending.get(id)?.resolve(msg);
        this.pending.delete(id);
      };
    });
  }

  private send(payload: object): Promise<ServerMsg> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws!.send(JSON.stringify({ ...payload, id })); });
  }

  async init(sourceLang: string, targetLang: string, modelId?: string, device?: string):
      Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string }> {
    await this.connect();
    this.onStatus?.('[native-translate] init…');
    const msg = await this.send({ type: 'translate_init', sourceLang, targetLang, model: modelId, device });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType, tokensPerSec: r.tokensPerSec, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason };
  }

  async translate(text: string, systemPrompt = '', wrapTranscript = false): Promise<TranslationResult> {
    const msg = await this.send({ type: 'translate', text, systemPrompt, wrapTranscript }) as Extract<ServerMsg, { type: 'translation' }>;
    return { sourceText: msg.sourceText, translatedText: msg.translatedText, inferenceTimeMs: msg.inferenceTimeMs };
  }

  dispose(): void { this.rejectAllPending(new Error('native host disconnected')); try { this.ws?.close(); } catch (_) {} this.ws = null; }
}
