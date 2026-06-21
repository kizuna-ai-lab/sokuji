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
  private pending = new Map<number, (m: ServerMsg) => void>();

  private async connect(): Promise<void> {
    if (this.ws) return;
    const r = await electron().invoke('native-host:start');
    if (!r?.ok) throw new Error(r?.error || 'failed to start native host');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => { this.onError?.('native host WS error'); reject(new Error('WS error')); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMsg;
        if (msg.type === 'error') { this.onError?.(msg.message); if (msg.id) this.pending.delete(msg.id); return; }
        const id = (msg as any).id as number;
        this.pending.get(id)?.(msg);
        this.pending.delete(id);
      };
    });
  }

  private send(payload: object): Promise<ServerMsg> {
    const id = this.nextId++;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.ws!.send(JSON.stringify({ ...payload, id })); });
  }

  async init(sourceLang: string, targetLang: string, modelId?: string): Promise<{ loadTimeMs: number }> {
    await this.connect();
    this.onStatus?.('[native-translate] init…');
    const msg = await this.send({ type: 'translate_init', sourceLang, targetLang, model: modelId });
    return { loadTimeMs: (msg as Extract<ServerMsg, { type: 'ready' }>).loadTimeMs };
  }

  async translate(text: string, systemPrompt = '', wrapTranscript = false): Promise<TranslationResult> {
    const msg = await this.send({ type: 'translate', text, systemPrompt, wrapTranscript }) as Extract<ServerMsg, { type: 'translation' }>;
    return { sourceText: msg.sourceText, translatedText: msg.translatedText, inferenceTimeMs: msg.inferenceTimeMs };
  }

  dispose(): void { try { this.ws?.close(); } catch (_) {} this.ws = null; this.pending.clear(); }
}
