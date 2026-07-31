/**
 * Soniox voice-cloning REST component (`/v1/voices`) — BYOK only: voice
 * MANAGEMENT requires the permanent project key (temporary keys are
 * live-verified 401 on these endpoints; their usage_type enum has no REST
 * scope). USING a cloned voice needs no changes anywhere: `voice` is an
 * opaque string on the TTS wire and tts_rt temporary keys synthesize with
 * cloned UUIDs (live-verified 2026-07-31).
 *
 * Facts honored here (docs + live probes):
 * - create is multipart with exactly `name` (unique per project) + `file`
 *   (reference clip <= 20 s / 10 MB); there are no metadata/owner fields.
 * - readiness is per model: models[].status in
 *   not_computed | processing | ready | failed; `failed` is TERMINAL despite
 *   the API using a 503 for it — recreate, never retry.
 * - The organization-wide quota is 20 voices (all projects combined).
 */

const VOICES_URL = 'https://api.soniox.com/v1/voices';
const TTS_MODEL = 'tts-rt-v1';

export type SonioxVoiceModelStatus = 'not_computed' | 'processing' | 'ready' | 'failed';

export interface SonioxVoice {
  id: string;
  name: string;
  filename?: string;
  created_at?: string;
  models?: Array<{
    model: string;
    status: SonioxVoiceModelStatus;
    error_type?: string | null;
    error_message?: string | null;
  }>;
}

export class SonioxVoicesError extends Error {
  constructor(
    readonly errorType: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'SonioxVoicesError';
  }
}

async function throwApiError(res: Response): Promise<never> {
  let errorType = 'http_error';
  let message = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    errorType = body.error_type ?? errorType;
    message = body.message ?? body.error_message ?? message;
  } catch {
    // non-JSON error body — keep the HTTP fallback
  }
  throw new SonioxVoicesError(errorType, message, res.status);
}

export class SonioxVoicesClient {
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /** All voices in the project (auto-paginates; page size 1000). */
  async list(): Promise<SonioxVoice[]> {
    const voices: SonioxVoice[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL(VOICES_URL);
      url.searchParams.set('limit', '1000');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) await throwApiError(res);
      const body = await res.json();
      voices.push(...(body.voices ?? []));
      cursor = body.next_page_cursor ?? null;
    } while (cursor);
    return voices;
  }

  async get(id: string): Promise<SonioxVoice> {
    const res = await fetch(`${VOICES_URL}/${id}`, { headers: this.headers() });
    if (!res.ok) await throwApiError(res);
    return res.json();
  }

  async create(name: string, file: Blob, filename = 'reference.wav'): Promise<SonioxVoice> {
    const form = new FormData();
    form.set('name', name);
    form.set('file', file, filename);
    const res = await fetch(VOICES_URL, { method: 'POST', headers: this.headers(), body: form });
    if (!res.ok) await throwApiError(res);
    return res.json();
  }

  /** Deleting an already-gone voice is a success (idempotent cleanup). */
  async delete(id: string): Promise<void> {
    const res = await fetch(`${VOICES_URL}/${id}`, { method: 'DELETE', headers: this.headers() });
    if (!res.ok && res.status !== 404) await throwApiError(res);
  }

  /** Poll until the voice is ready for `model`; `failed` rejects terminally. */
  async waitUntilReady(
    id: string,
    opts: { model?: string; timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<SonioxVoice> {
    const { model = TTS_MODEL, timeoutMs = 60_000, intervalMs = 1500 } = opts;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const voice = await this.get(id);
      const entry = voice.models?.find((m) => m.model === model);
      if (entry?.status === 'ready') return voice;
      if (entry?.status === 'failed') {
        throw new SonioxVoicesError('voice_failed', entry.error_message ?? 'Voice processing failed', 503);
      }
      if (Date.now() >= deadline) {
        throw new SonioxVoicesError('timeout', 'Voice processing timed out', 408);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/** Mono 16-bit PCM WAV from a Float32Array capture (VoiceLibrarySection's
 *  recorder output). Small and local on purpose — zoomApi's encoder emits a
 *  16 kHz data URI for a different wire; sharing would couple the two. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);  // PCM
  dv.setUint16(22, 1, true);  // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeAscii(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : Math.round(s * 0x7fff), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
