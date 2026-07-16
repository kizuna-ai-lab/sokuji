import type { TranslationResult } from '../engine/TranslationEngine';
import type { ServerMsg } from './nativeProtocol';
import { SidecarConnection, INIT_REQUEST_TIMEOUT_MS, type ISidecarConnection } from './SidecarConnection';

export class NativeTranslateClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private conn: ISidecarConnection;

  constructor(conn: ISidecarConnection = new SidecarConnection()) {
    this.conn = conn;
    // Surface only genuinely id-less push errors. Translate RPCs all carry ids, so
    // callers see failures via request() reject; an id-carrying error reaching here is
    // a late reply to an already-rejected timed-out request — don't double-signal it.
    this.conn.onMessage((msg) => {
      if (msg.type === 'error' && (msg as { id?: number }).id === undefined) this.onError?.(msg.message);
    });
  }

  async init(
    sourceLang: string, targetLang: string, modelId?: string, device?: string,
    asrModel?: string | null, ttsModel?: string | null, variant?: string,
  ): Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string }> {
    this.onStatus?.('[native-translate] init…');
    const payload: Record<string, unknown> = { type: 'translate_init', sourceLang, targetLang, model: modelId, device };
    // Pass co-loaded stage IDs and the chosen variant so the sidecar can account
    // for their VRAM when reserving memory for the translation model.
    if (asrModel) payload.asrModel = asrModel;
    if (ttsModel) payload.ttsModel = ttsModel;
    if (variant) payload.variant = variant;
    const msg = await this.conn.request(payload as { type: string; [k: string]: unknown }, { timeoutMs: INIT_REQUEST_TIMEOUT_MS });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType, tokensPerSec: r.tokensPerSec, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason };
  }

  async translate(text: string, systemPrompt = '', wrapTranscript = false): Promise<TranslationResult> {
    const msg = await this.conn.request({ type: 'translate', text, systemPrompt, wrapTranscript }) as Extract<ServerMsg, { type: 'translate_result' }>;
    return { sourceText: msg.sourceText, translatedText: msg.translatedText, inferenceTimeMs: msg.inferenceTimeMs };
  }

  dispose(): void { this.conn.dispose(); }
}
