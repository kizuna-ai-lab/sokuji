import type { ServerMsg } from './nativeProtocol';
import { SidecarConnection, INIT_REQUEST_TIMEOUT_MS, type ISidecarConnection } from './SidecarConnection';

export interface NativeAsrResult { text: string; startSample?: number; durationMs: number; recognitionTimeMs: number; }

export class NativeAsrClient {
  onResult: ((r: NativeAsrResult) => void) | null = null;
  onPartialResult: ((text: string) => void) | null = null;
  onSpeechStart: (() => void) | null = null;
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private conn: ISidecarConnection;

  constructor(conn: ISidecarConnection = new SidecarConnection()) {
    this.conn = conn;
    this.conn.onMessage((msg) => this.onPush(msg));
  }

  private onPush(msg: ServerMsg): void {
    if (msg.type === 'speech_start') { this.onSpeechStart?.(); return; }
    if (msg.type === 'partial') { this.onPartialResult?.(msg.text); return; }
    // ASR results are pushed without an id; TTS results carry an id and are matched
    // as request replies on the (separate) TTS connection — they never reach here.
    if (msg.type === 'result') {
      const r = msg as Extract<ServerMsg, { type: 'result' }> & { text?: string; startSample?: number; durationMs?: number; recognitionTimeMs?: number };
      this.onResult?.({ text: r.text as string, startSample: r.startSample, durationMs: r.durationMs as number, recognitionTimeMs: r.recognitionTimeMs as number });
      return;
    }
    // Feeder errors during streaming arrive id-less (see sidecar server.py on_binary).
    if (msg.type === 'error') this.onError?.(msg.message);
  }

  async init(
    language = '', modelId?: string, sampleRate = 24000,
    vad?: { threshold?: number; minSilence?: number; minSpeech?: number },
    device?: string, variant?: string,
  ): Promise<{ loadTimeMs: number; backend?: string; device?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string }> {
    this.onStatus?.('[native-asr] init…');
    const msg = await this.conn.request({
      type: 'asr_init', language, model: modelId, sampleRate, device, variant,
      vadThreshold: vad?.threshold, vadMinSilenceDuration: vad?.minSilence, vadMinSpeechDuration: vad?.minSpeech,
    }, { timeoutMs: INIT_REQUEST_TIMEOUT_MS });
    const r = msg as Extract<ServerMsg, { type: 'ready' }>;
    return { loadTimeMs: r.loadTimeMs, backend: r.backend, device: r.device, computeType: r.computeType, rtf: r.rtf, memoryBytes: r.memoryBytes, fallbackReason: r.fallbackReason };
  }

  feedAudio(samples: Int16Array, _sampleRate: number): void {
    this.conn.sendBinary(samples.buffer);   // server is in asr binary mode after init
  }

  async flush(): Promise<void> { await this.conn.request({ type: 'asr_flush' }); }

  dispose(): void { this.conn.dispose(); }
}
