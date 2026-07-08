/**
 * Zoom AI Services REST wrappers: WAV encoding + Scribe (ASR) + Translator (MT).
 * All calls are signed with an HS256 JWT (see ZoomJwtSigner) passed as `token`.
 */
const API_BASE = 'https://api.zoom.us/v2/aiservices';

export class ZoomApiError extends Error {
  status: number;
  reason?: string;
  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = 'ZoomApiError';
    this.status = status;
    this.reason = reason;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Encode Float32 [-1,1] mono samples as a 16-bit PCM WAV data URI. */
export function encodeWavDataUri(samples: Float32Array, sampleRate: number): string {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits/sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return `data:audio/wav;base64,${bytesToBase64(new Uint8Array(buffer))}`;
}

async function post(path: string, token: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    let reason: string | undefined;
    let message = raw;
    try {
      const j = JSON.parse(raw);
      reason = j.reason;
      message = j.message || raw;
    } catch { /* keep raw */ }
    throw new ZoomApiError(res.status, message, reason);
  }
  return JSON.parse(raw);
}

export async function transcribe(token: string, wavDataUri: string, language: string): Promise<string> {
  const json = await post('/scribe/transcribe', token, {
    file: wavDataUri,
    config: { language, word_time_offsets: true },
  });
  return json?.result?.text_display ?? '';
}

export async function translate(
  token: string,
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string> {
  const json = await post('/translator/translate', token, {
    text,
    config: { source_language: sourceLanguage, target_languages: [targetLanguage] },
  });
  return json?.result?.translations?.[targetLanguage] ?? '';
}
