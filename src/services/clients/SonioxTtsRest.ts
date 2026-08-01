/**
 * Soniox one-shot TTS REST component (`POST https://tts-rt.soniox.com/tts`).
 *
 * Separate from SonioxVoicesClient on purpose: that client wraps
 * `api.soniox.com/v1/voices`, whose invariant is "permanent project key only"
 * (temporary keys are live-probed 401 there). TTS lives on a different host
 * and accepts temporary keys too, so merging the two would blur that rule.
 *
 * Separate from SonioxTtsStream too: that is the session-time WebSocket wire
 * (incremental text in, streamed audio out, stream serialization, keepalive).
 * This is a single request/response call for one short utterance.
 *
 * Facts honored here (OpenAPI `CreateTTSPayload` + live probes, 2026-08-01):
 * - required: model, language, voice, audio_format, text
 * - `voice` accepts a built-in name OR a cloned-voice UUID (docs verbatim)
 * - `speed` is 0.7..1.3 with server default 1.0 — omitted at 1.0, the same
 *   rule SonioxTtsStream.openStream applies
 * - the response body is RAW audio bytes for the requested audio_format
 * - CORS is open (`access-control-allow-origin: *`), so the browser calls this
 *   directly — but the extension CSP must list `https://tts-rt.soniox.com`
 *   (it already listed only the `wss://` origin, which does NOT cover https)
 */
import { SonioxVoicesError, throwApiError } from './SonioxVoicesClient';

const TTS_REST_URL = 'https://tts-rt.soniox.com/tts';
const TTS_MODEL = 'tts-rt-v1';
const SAMPLE_RATE = 24000;
// A preview is one short sentence; anything past this is a stall, not slowness.
const REQUEST_TIMEOUT_MS = 20_000;

export interface SonioxTtsRestOptions {
  apiKey: string;
  voice: string;
  /** ISO-639-1 code; MUST match the language `text` is written in. */
  language: string;
  text: string;
  /** 0.7..1.3; 1.0 (the server default) is omitted from the wire. */
  speed?: number;
  /** Caller cancellation (e.g. the user switched to another voice). */
  signal?: AbortSignal;
}

/**
 * Synthesize one utterance and return it as mono Float32 PCM.
 *
 * Every rejection is a SonioxVoicesError so callers map ONE error shape.
 * `errorType === 'aborted'` marks a user-initiated cancel, which callers
 * should treat as a non-event rather than surfacing as a failure.
 */
export async function synthesizeOnce(
  opts: SonioxTtsRestOptions
): Promise<{ audio: Float32Array; sampleRate: number }> {
  // An already-cancelled request must not be paid for: the user's tokens are
  // spent the moment the request lands, so check before dialing out.
  if (opts.signal?.aborted) {
    throw new SonioxVoicesError('aborted', 'Preview cancelled', 0);
  }

  // An explicit controller rather than AbortSignal.any(): the deadline and the
  // caller's cancel must stay distinguishable at the catch site, and the abort
  // reason's `name` is what carries that distinction.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Soniox TTS request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS
  );
  const forwardAbort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener('abort', forwardAbort, { once: true });

  let res: Response;
  try {
    res = await fetch(TTS_REST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: opts.voice,
        language: opts.language,
        text: opts.text,
        audio_format: 'pcm_s16le',
        sample_rate: SAMPLE_RATE,
        ...(opts.speed != null && opts.speed !== 1.0 ? { speed: opts.speed } : {}),
      }),
      signal: controller.signal,
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'TimeoutError') {
      throw new SonioxVoicesError('timeout', `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`, 408);
    }
    if (name === 'AbortError') {
      throw new SonioxVoicesError('aborted', 'Preview cancelled', 0);
    }
    throw new SonioxVoicesError('network', e instanceof Error ? e.message : String(e), 0);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', forwardAbort);
  }

  if (!res.ok) await throwApiError(res);

  const bytes = await res.arrayBuffer();
  // A zero-byte 200 would decode to silence and read to the user as "the
  // button does nothing" — fail loudly instead.
  if (bytes.byteLength === 0) {
    throw new SonioxVoicesError('empty_audio', 'Soniox returned no audio', res.status);
  }
  // Int16Array requires an even byte length; a truncated tail is dropped
  // rather than throwing on an otherwise usable clip.
  const evenLength = bytes.byteLength - (bytes.byteLength % 2);
  const pcm = new Int16Array(bytes.slice(0, evenLength));
  const audio = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) audio[i] = pcm[i] / 32768;
  return { audio, sampleRate: SAMPLE_RATE };
}
