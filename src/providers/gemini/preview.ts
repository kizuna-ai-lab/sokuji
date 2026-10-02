/**
 * A Gemini voice's audition (decision 2026-10-03): Google's
 * own samples carry no CORS header, so a page cannot fetch them; instead
 * Gemini's TTS model reads one sentence in the voice, on the user's own key —
 * free on the free tier, a fraction of a cent on a paid one. The sentence is
 * the target's from the shared table; every Gemini voice speaks every
 * language, and the model detects it from the text. A clip heard once is
 * replayed from the shared cache for the rest of the app session. The voice
 * library swallows a rejected preview, so a failure is reported here, once;
 * a preview the user stopped is no failure.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { boundedFetch } from '../../lib/provider/boundedFetch';
import { decodeClip, type PreviewAudio } from '../../lib/tts/clip';
import { getCachedPreview, previewCacheKey, setCachedPreview } from '../../lib/tts/previewCache';
import { previewSampleFor } from '../../lib/tts/previewSample';
import { GEMINI_MODELS_URL } from './check';

/** The cheapest GA TTS model (2026-10-03); it answers a unary request with a whole WAV. */
export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
export const GEMINI_TTS_URL = `${GEMINI_MODELS_URL}/${GEMINI_TTS_MODEL}:generateContent`;
/** A one-sentence synthesis is seconds; past this the spinner would only spin. */
export const PREVIEW_TIMEOUT_MS = 20_000;

export interface GeminiPreviewDeps {
  fetch: typeof fetch;
  decode(bytes: ArrayBuffer): Promise<PreviewAudio>;
  clock: Pick<Clock, 'setTimeout'>;
}

const live: GeminiPreviewDeps = {
  fetch: (input, init) => fetch(input, init),
  decode: decodeClip,
  clock: realClock,
};

interface Answer {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: unknown; data?: unknown } }> } }>;
  error?: { message?: unknown };
}

function bytesOf(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** `audio/L16;codec=pcm;rate=24000`: little-endian 16-bit mono, no header. */
function pcm16(bytes: ArrayBuffer, mimeType: string): PreviewAudio {
  const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
  const view = new DataView(bytes);
  const audio = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < audio.length; i++) audio[i] = view.getInt16(i * 2, true) / 32768;
  return { audio, sampleRate: rate };
}

export interface GeminiPreviewRequest {
  voice: string;
  /** The pair's target, an app language code: its sentence is read. */
  target: string;
  apiKey: string;
}

export async function previewGeminiVoice(
  { voice, target, apiKey }: GeminiPreviewRequest,
  signal?: AbortSignal,
  deps: GeminiPreviewDeps = live,
): Promise<PreviewAudio | null> {
  // The table is keyed by bare language: `pt-BR` reads Portuguese's sentence.
  const sample = previewSampleFor(target.split('-')[0]);
  const key = previewCacheKey('gemini', voice, sample.language, 1);
  const cached = getCachedPreview(key);
  if (cached) return cached;
  const late = `Gemini did not synthesize the sample within ${PREVIEW_TIMEOUT_MS / 1000} s.`;
  try {
    const clip = await boundedFetch({ clock: deps.clock, ms: PREVIEW_TIMEOUT_MS, signal, late }, async (bounded) => {
      const response = await deps.fetch(GEMINI_TTS_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: sample.text }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } },
        }),
        signal: bounded,
      });
      const body = (await response.json().catch(() => ({}))) as Answer;
      if (!response.ok) {
        const words = typeof body.error?.message === 'string' ? `: ${body.error.message}` : '';
        throw new Error(`HTTP ${response.status}${words}`);
      }
      const audio = body.candidates?.[0]?.content?.parts?.find((p) => typeof p.inlineData?.data === 'string')?.inlineData;
      if (!audio) throw new Error('the answer carried no audio');
      const bytes = bytesOf(audio.data as string);
      const mimeType = typeof audio.mimeType === 'string' ? audio.mimeType : '';
      return /^audio\/l16/i.test(mimeType) ? pcm16(bytes, mimeType) : deps.decode(bytes);
    });
    setCachedPreview(key, clip);
    return clip;
  } catch (error) {
    if (signal?.aborted) return null;
    reportError('GeminiPreview', `Could not synthesize a sample of ${voice}: ${describeCause(error)}`, { cause: error });
    return null;
  }
}
